/**
 * Cena isométrica do editor — PixiJS 8.
 *
 * ## O que mudou, e por que era um erro
 *
 * A versão anterior desenhava cada bloco com `sprite.width = tileWidth × zoom`
 * e `sprite.height = (tileHeight + zStep) × zoom`. Sobre uma textura de 48×48
 * isso é **escala não uniforme**: 1,333× na horizontal e 1,0× na vertical. O
 * losango do topo da arte deixava de ser 2:1 e parava de costurar no grid — que
 * é exatamente o "não fica em perspectiva correta" que se vê na tela, e que não
 * é culpa da arte.
 *
 * Aqui a escala é sempre UNIFORME e a âncora é declarada, não inferida do canto
 * do bounding box. Arte canônica (48×53) desenha em 1:1 vezes o zoom inteiro.
 *
 * ## Decisões de renderização (ADR 0013 + as skills de Pixi deste repo)
 *
 *   - `nearest` e mipmaps DESLIGADOS antes de qualquer textura ser usada. Sem
 *     isso, pixel art escalada borra e a arte gerada não se parece com o que
 *     foi pago.
 *   - Escala do palco INTEIRA. Zoom fracionário é meio pixel de deslocamento,
 *     e meio pixel numa costura de losango é uma linha visível.
 *   - Um `Sprite` por célula, vindo de um pool: nada é alocado por quadro.
 *   - `Application.init` é assíncrono no Pixi 8 — não existe atalho síncrono.
 *
 * ## Ordem de desenho
 *
 * Por `depthAt`, que rotaciona a coordenada (por um ângulo que pode ser
 * fracionário durante o giro) e só então soma. Um caminho, não quatro
 * expressões por vista. Empate desfeito por z, para que a coluna suba de baixo
 * para cima.
 *
 * **A oclusão continua imperfeita, e isso é declarado.** O motor isométrico de
 * referência resolve ordem por comparação par-a-par de caixas 3D e mesmo assim
 * o mantenedor descreve a melhoria como "não perfeita". Uma cena acíclica de
 * uma vista pode ser cíclica de outra. A chave escalar aqui cobre o caso de
 * célula única — que é exatamente o que o formato de mapa permite.
 *
 * ## O giro
 *
 * A posição é interpolada; o sprite NUNCA é rotacionado. Girar pixel art por um
 * ângulo que não seja múltiplo de 90° reamostra a imagem e transforma a arte
 * paga em borrão durante a transição inteira. O que troca de vista é a FACE
 * desenhada, por cross-fade — a de origem por baixo, opaca, a de destino por
 * cima, com o alfa do progresso. Somar duas semitransparentes deixaria o fundo
 * aparecer no meio do giro.
 */
import { Application, Assets, Container, Sprite, Texture, TextureSource } from 'pixi.js';
import type { MapData } from '@isometric-maker/iso-core/map';
import { rotateDirectionIndex, type Rotation } from '@isometric-maker/iso-core/rotation';
import {
  ROTATION_DURATION_MS,
  sampleTween,
  startTween,
} from '@isometric-maker/iso-core/rotation-tween';
import { CANONICAL_CUBE } from '@isometric-maker/iso-core/iso-cube';
import {
  DEFAULT_GEOMETRY,
  cellToScreen,
  centerOn,
  depthAt,
  type Camera,
  type Cell3D,
  type ProjectGeometry,
} from './camera.ts';
import {
  hueFromId,
  makeCubeCanvasFromHue,
  makeCubeViewsFromHue,
  makeDiamondCanvas,
  rgba,
} from './cube.ts';
import { spriteBox } from './placement.ts';

// ------------------------------------------------------------------ paleta

/** As quatro faces de um bloco, na mesma ordem de rotação das vistas. */
export const FACINGS = ['north', 'east', 'south', 'west'] as const;
export type Facing = (typeof FACINGS)[number];

/** Uma peça colocável: ou arte gerada (4 faces), ou cubo procedural. */
export interface BlockDef {
  readonly id: string;
  readonly label: string;
  /** URLs das quatro faces. Ausente = cubo procedural. */
  readonly faceUrls?: Readonly<Record<Facing, string>> | undefined;
  /**
   * Matiz HSL do cubo procedural. Ausente, deriva do id — estável, mas sem
   * relação com o nome da peça (foi como "Grama" saiu vermelha).
   */
  readonly hue?: number | undefined;
}

export interface SceneOptions {
  readonly geometry?: ProjectGeometry;
  readonly backgroundColor?: number;
  /** Quantas células de malha desenhar além do conteúdo, por lado. */
  readonly gridMargin?: number;
}

export interface SceneState {
  readonly map: MapData;
  readonly camera: Camera;
  /** Célula vazia sob o cursor onde a peça assentaria. null esconde o preview. */
  readonly preview: Cell3D | null;
  /** true quando a ação atual é destrutiva — pinta o cubo de preview de vermelho. */
  readonly previewInvalid?: boolean;
  /** Célula ocupada sob o cursor, realçada. */
  readonly highlight?: Cell3D | null;
}

export interface RotateOptions {
  /** Células a manter enquadradas durante o giro. */
  readonly cells: readonly Cell3D[];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly durationMs?: number;
}

export interface IsoScene {
  readonly app: Application;
  /** Registra as peças da paleta e pré-carrega a arte das que têm PNG. */
  setPalette(blocks: readonly BlockDef[]): Promise<void>;
  render(state: SceneState): void;
  /**
   * Gira a câmera com animação e resolve com a câmera final.
   *
   * Quem chama só toca no estado UMA vez, no fim: React não reconcilia 60 vezes
   * por segundo por causa de uma animação que vive no ticker do Pixi.
   */
  rotateTo(rotation: Rotation, options: RotateOptions): Promise<Camera>;
  /** true enquanto um giro está em andamento — o cursor fica desligado. */
  isRotating(): boolean;
  resize(width: number, height: number): void;
  destroy(): void;
}

// ------------------------------------------------------------------ cores fixas

const GRID_STROKE = rgba(148, 163, 184, 71);
const HIGHLIGHT_STROKE = rgba(56, 189, 248, 242);
const HIGHLIGHT_FILL = rgba(56, 189, 248, 46);
const PREVIEW_HUE_OK = 190;
const PREVIEW_HUE_BAD = 5;
const PREVIEW_ALPHA = 0.45;

// ------------------------------------------------------------------ fábrica

export async function createIsoScene(
  canvas: HTMLCanvasElement,
  options: SceneOptions = {},
): Promise<IsoScene> {
  const geom = options.geometry ?? DEFAULT_GEOMETRY;
  const gridMargin = options.gridMargin ?? 4;
  // A geometria do cubo é a canônica quando a projeção também é. Uma projeção
  // fora do padrão ainda desenha, mas a arte de reserva segue a canônica: um só
  // molde, sempre.
  const cubeGeom = CANONICAL_CUBE;

  const app = new Application();
  await app.init({
    canvas,
    background: options.backgroundColor ?? 0x0b1020,
    antialias: false,
    // devicePixelRatio 1 de propósito: pixel art escalada por um fator não
    // inteiro do dispositivo volta a borrar, e o zoom já é inteiro.
    resolution: 1,
    autoDensity: false,
  });

  // Padrão GLOBAL de textura, fixado ANTES de qualquer Assets.load: em Pixi 8
  // o default vale no momento em que a fonte de textura é criada, então
  // ajustar depois já chegou tarde para o que foi carregado.
  TextureSource.defaultOptions.scaleMode = 'nearest';
  TextureSource.defaultOptions.autoGenerateMipmaps = false;

  const world = new Container();
  app.stage.addChild(world);

  // --- pools separados: malha embaixo, blocos no meio, preview por cima ---
  const gridLayer = new Container();
  const blockLayer = new Container();
  const overlayLayer = new Container();
  world.addChild(gridLayer, blockLayer, overlayLayer);

  const makePool = (parent: Container) => {
    const pool: Sprite[] = [];
    let used = 0;
    return {
      take(): Sprite {
        const s =
          pool[used] ??
          (() => {
            const created = new Sprite();
            pool.push(created);
            parent.addChild(created);
            return created;
          })();
        s.visible = true;
        s.alpha = 1;
        used += 1;
        return s;
      },
      reset(): void {
        for (let i = used; i < pool.length; i += 1) pool[i]!.visible = false;
        used = 0;
      },
      destroy(): void {
        for (const s of pool) s.destroy();
        pool.length = 0;
      },
    };
  };

  const gridPool = makePool(gridLayer);
  const blockPool = makePool(blockLayer);
  const overlayPool = makePool(overlayLayer);

  // --- texturas ---
  const owned: Texture[] = [];

  const fromCanvas = (c: HTMLCanvasElement): Texture => {
    const tex = Texture.from(c);
    tex.source.scaleMode = 'nearest';
    tex.source.autoGenerateMipmaps = false;
    owned.push(tex);
    return tex;
  };

  const gridTexture = fromCanvas(makeDiamondCanvas(cubeGeom, GRID_STROKE));
  const previewOk = fromCanvas(
    makeCubeCanvasFromHue(PREVIEW_HUE_OK, cubeGeom, PREVIEW_ALPHA, 0.7),
  );
  const previewBad = fromCanvas(
    makeCubeCanvasFromHue(PREVIEW_HUE_BAD, cubeGeom, PREVIEW_ALPHA, 0.7),
  );
  const highlightTexture = fromCanvas(
    makeDiamondCanvas(cubeGeom, HIGHLIGHT_STROKE, HIGHLIGHT_FILL),
  );

  /** id da peça → textura por face; peça procedural tem a mesma nas quatro. */
  const artwork = new Map<string, Texture[]>();

  /**
   * Cubo procedural determinístico, criado sob demanda e cacheado.
   *
   * QUATRO texturas, uma por vista — mesmo tom de face, desenho de material
   * diferente. Uma textura só nas quatro vistas faria o giro parecer a mesma
   * figura deslizando, que é o oposto do efeito de volume.
   */
  function proceduralFor(id: string, hue?: number): Texture[] {
    const cached = artwork.get(id);
    if (cached) return cached;
    const four = makeCubeViewsFromHue(hue ?? hueFromId(id), cubeGeom).map(fromCanvas);
    artwork.set(id, four);
    return four;
  }

  const setPalette = async (blocks: readonly BlockDef[]): Promise<void> => {
    for (const b of blocks) {
      // Descarta o que estiver em cache para este id ANTES de registrar.
      //
      // O primeiro desenho acontece antes de a paleta resolver (setPalette é
      // assíncrona), então o mapa inicial já pediu uma textura para 'grama' e
      // recebeu o cubo derivado do id. Sem esta linha, o matiz declarado
      // chegava depois e o cache antigo ganhava: a plataforma inicial saía
      // salmão enquanto a miniatura da mesma peça, na paleta, saía verde.
      artwork.delete(b.id);
      if (!b.faceUrls) {
        proceduralFor(b.id, b.hue);
        continue;
      }
      try {
        const urls = FACINGS.map((f) => b.faceUrls![f]);
        const loaded = await Promise.all(urls.map((u) => Assets.load<Texture>(u)));
        for (const t of loaded) {
          t.source.scaleMode = 'nearest';
          t.source.autoGenerateMipmaps = false;
        }
        artwork.set(b.id, loaded);
      } catch {
        // Arte que não carrega NÃO derruba o editor: cai no cubo procedural
        // e a peça continua colocável. Um asset ausente é um problema de
        // aparência, não de edição.
        proceduralFor(b.id, b.hue);
      }
    }
  };

  /**
   * Textura da peça numa vista.
   *
   * `(facing + rotation) mod 4` é o mesmo reindexamento das 8 direções de
   * personagem, com N=4: cada giro de 90° avança exatamente uma face. É isto
   * que faz quatro artes darem conta das quatro vistas sem gerar mais nada.
   */
  function textureFor(blockId: string, rotation: Rotation): Texture {
    const four = artwork.get(blockId) ?? proceduralFor(blockId);
    const idx = rotateDirectionIndex(0, 4, rotation);
    return four[idx] ?? four[0]!;
  }

  // ------------------------------------------------------------------ desenho

  /** Posiciona um sprite. A conta mora em `placement.ts`, que é testável. */
  function place(
    s: Sprite,
    texture: Texture,
    screen: { x: number; y: number },
    zoom: number,
    anchorX: number,
    anchorY: number,
  ): void {
    s.texture = texture;
    const box = spriteBox({
      screenX: screen.x,
      screenY: screen.y,
      textureWidth: texture.width,
      tileWidth: geom.tileWidth,
      zoom,
      anchorX,
      anchorY,
    });
    s.scale.set(box.scale);
    s.x = box.x;
    s.y = box.y;
  }

  interface Drawable {
    readonly cell: Cell3D;
    readonly block: string;
    readonly key: number;
  }

  let lastState: SceneState | null = null;

  const collect = (map: MapData, camera: Camera): Drawable[] => {
    const drawables: Drawable[] = [];
    for (const [key, runs] of Object.entries(map.blocks)) {
      const [xs, ys] = key.split(':');
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      let z = 0;
      for (const run of runs) {
        if (run.block !== '') {
          for (let i = 0; i < run.count; i += 1) {
            const cell = { x, y, z: z + i };
            drawables.push({ cell, block: run.block, key: depthAt(cell, camera) });
          }
        }
        z += run.count;
      }
    }
    drawables.sort((a, b) => (a.key !== b.key ? a.key - b.key : a.cell.z - b.cell.z));
    return drawables;
  };

  const render = (state: SceneState): void => {
    lastState = state;
    gridPool.reset();
    blockPool.reset();
    overlayPool.reset();

    const { map, camera } = state;

    // Durante o giro há DUAS vistas certas ao mesmo tempo. Fora dele, uma.
    const turn = camera.turn;
    const baixo = Math.floor(turn);
    const alpha = turn - baixo;
    const vistaA = (((baixo % 4) + 4) % 4) as Rotation;
    const vistaB = ((((baixo + 1) % 4) + 4) % 4) as Rotation;
    const girando = alpha > 0.0001;

    // --- extensão da malha ---
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const key of Object.keys(map.blocks)) {
      const [xs, ys] = key.split(':');
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    // Sem conteúdo, a malha nasce ao redor da origem: um mapa vazio precisa de
    // algum lugar onde clicar.
    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = 0;
      minY = 0;
      maxY = 0;
    }

    for (let x = minX - gridMargin; x <= maxX + gridMargin; x += 1) {
      for (let y = minY - gridMargin; y <= maxY + gridMargin; y += 1) {
        const p = cellToScreen({ x, y, z: 0 }, camera, geom);
        place(gridPool.take(), gridTexture, p, camera.zoom, cubeGeom.anchorX, cubeGeom.anchorY);
      }
    }

    // --- blocos, do fundo para a frente ---
    for (const d of collect(map, camera)) {
      const p = cellToScreen(d.cell, camera, geom);
      const base = blockPool.take();
      place(base, textureFor(d.block, vistaA), p, camera.zoom, cubeGeom.anchorX, cubeGeom.anchorY);
      if (girando) {
        // A vista de destino vai POR CIMA, com o alfa do progresso. A de
        // origem fica opaca embaixo: duas semitransparentes deixariam o fundo
        // aparecer através do bloco no meio do giro.
        const topo = blockPool.take();
        place(topo, textureFor(d.block, vistaB), p, camera.zoom, cubeGeom.anchorX, cubeGeom.anchorY);
        topo.alpha = alpha;
      }
    }

    // --- realce da célula atingida ---
    if (state.highlight) {
      const p = cellToScreen(state.highlight, camera, geom);
      place(overlayPool.take(), highlightTexture, p, camera.zoom, cubeGeom.anchorX, cubeGeom.anchorY);
    }

    // --- cubo semitransparente de preview ---
    if (state.preview) {
      const p = cellToScreen(state.preview, camera, geom);
      place(
        overlayPool.take(),
        state.previewInvalid === true ? previewBad : previewOk,
        p,
        camera.zoom,
        cubeGeom.anchorX,
        cubeGeom.anchorY,
      );
    }
  };

  // ------------------------------------------------------------------ giro

  let rotating = false;

  const rotateTo = (rotation: Rotation, opts: RotateOptions): Promise<Camera> => {
    const state = lastState;
    if (!state) {
      return Promise.resolve({ ...DEFAULT_CAMERA_FALLBACK, rotation, turn: rotation });
    }
    const de = state.camera.rotation;
    const duracao = opts.durationMs ?? ROTATION_DURATION_MS;

    const settle = (): Camera => {
      const pan = centerOn(
        opts.cells,
        rotation,
        opts.viewportWidth,
        opts.viewportHeight,
        state.camera.zoom,
        geom,
      );
      return { rotation, turn: rotation, zoom: state.camera.zoom, ...pan };
    };

    if (de === rotation || duracao <= 0) {
      const final = settle();
      render({ ...state, camera: final, preview: null, highlight: null });
      return Promise.resolve(final);
    }

    rotating = true;
    const tween = startTween(de, rotation, performance.now(), duracao);

    return new Promise<Camera>((resolve) => {
      const tick = (): void => {
        const sample = sampleTween(tween, performance.now());
        // Reenquadrar a cada quadro é o que faz o mapa girar em torno do
        // próprio centro. Sem isso ele descreve um arco e sai da tela no meio.
        const pan = centerOn(
          opts.cells,
          sample.turn,
          opts.viewportWidth,
          opts.viewportHeight,
          state.camera.zoom,
          geom,
        );
        const camera: Camera = {
          rotation: sample.done ? rotation : de,
          turn: sample.turn,
          zoom: state.camera.zoom,
          ...pan,
        };
        // Durante o giro não existe célula sob o cursor: mostrar preview seria
        // prometer uma colocação que o clique não faria.
        render({ ...state, camera, preview: null, highlight: null });

        if (sample.done) {
          app.ticker.remove(tick);
          rotating = false;
          resolve(settle());
        }
      };
      app.ticker.add(tick);
    });
  };

  const resize = (width: number, height: number): void => {
    app.renderer.resize(width, height);
  };

  const destroy = (): void => {
    gridPool.destroy();
    blockPool.destroy();
    overlayPool.destroy();
    for (const t of owned) t.destroy(true);
    owned.length = 0;
    artwork.clear();
    app.destroy(true, { children: true, texture: true, textureSource: true });
  };

  return { app, setPalette, render, rotateTo, isRotating: () => rotating, resize, destroy };
}

/** Só para o caso impossível de girar antes do primeiro desenho. */
const DEFAULT_CAMERA_FALLBACK: Camera = {
  rotation: 0,
  turn: 0,
  panX: 0,
  panY: 0,
  zoom: 2,
};
