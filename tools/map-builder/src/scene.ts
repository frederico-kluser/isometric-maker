/**
 * Cena isométrica do editor — PixiJS 8.
 *
 * Substitui `renderer.ts`, que desenhava retângulos coloridos: o que se via na
 * tela era um borrão, não um mapa. Aqui cada célula é um cubo isométrico de
 * verdade, com as três faces do gênero, e a câmera gira nas quatro vistas.
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
 * Por `depthAt`, que rotaciona a coordenada e só então soma. Um caminho, não
 * quatro expressões por vista. Empate desfeito por z, para que a coluna suba
 * de baixo para cima.
 *
 * **A oclusão continua imperfeita, e isso é declarado.** O motor isométrico de
 * referência resolve ordem por comparação par-a-par de caixas 3D e mesmo assim
 * o mantenedor descreve a melhoria como "não perfeita". Uma cena acíclica de
 * uma vista pode ser cíclica de outra. A chave escalar aqui cobre o caso de
 * célula única — que é exatamente o que o formato de mapa permite.
 */
import { Application, Assets, Container, Sprite, Texture, TextureSource } from 'pixi.js';
import type { MapData } from '@isometric-maker/iso-core/map';
import { rotateDirectionIndex, type Rotation } from '@isometric-maker/iso-core/rotation';
import {
  DEFAULT_GEOMETRY,
  cellToScreen,
  depthAt,
  type Camera,
  type Cell3D,
  type ProjectGeometry,
} from './camera.ts';
import {
  hueFromId,
  makeCubeCanvas,
  makeDiamondCanvas,
  shadesFromHue,
  type CubeGeometry,
} from './cube.ts';

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

export interface IsoScene {
  readonly app: Application;
  /** Registra as peças da paleta e pré-carrega a arte das que têm PNG. */
  setPalette(blocks: readonly BlockDef[]): Promise<void>;
  render(state: SceneState): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

// ------------------------------------------------------------------ cores fixas

const GRID_STROKE = 'rgba(148, 163, 184, 0.28)';
const PREVIEW_HUE_OK = 190;
const PREVIEW_HUE_BAD = 5;

// ------------------------------------------------------------------ fábrica

export async function createIsoScene(
  canvas: HTMLCanvasElement,
  options: SceneOptions = {},
): Promise<IsoScene> {
  const geom = options.geometry ?? DEFAULT_GEOMETRY;
  const gridMargin = options.gridMargin ?? 4;
  const cubeGeom: CubeGeometry = {
    tileWidth: geom.tileWidth,
    tileHeight: geom.tileHeight,
    depth: geom.zStep,
  };

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
        const s = pool[used] ?? (() => {
          const created = new Sprite();
          pool.push(created);
          parent.addChild(created);
          return created;
        })();
        s.visible = true;
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

  const gridTexture = fromCanvas(
    makeDiamondCanvas(geom.tileWidth, geom.tileHeight, GRID_STROKE),
  );
  const previewOk = fromCanvas(
    makeCubeCanvas(cubeGeom, shadesFromHue(PREVIEW_HUE_OK, 70), 0.45),
  );
  const previewBad = fromCanvas(
    makeCubeCanvas(cubeGeom, shadesFromHue(PREVIEW_HUE_BAD, 70), 0.45),
  );
  const highlightTexture = fromCanvas(
    makeDiamondCanvas(geom.tileWidth, geom.tileHeight, 'rgba(56,189,248,0.95)', 'rgba(56,189,248,0.18)'),
  );

  /** id da peça → textura por face; peça procedural tem a mesma nas quatro. */
  const artwork = new Map<string, Texture[]>();

  /** Cubo procedural determinístico, criado sob demanda e cacheado. */
  function proceduralFor(id: string, hue?: number): Texture[] {
    const cached = artwork.get(id);
    if (cached) return cached;
    const tex = fromCanvas(makeCubeCanvas(cubeGeom, shadesFromHue(hue ?? hueFromId(id))));
    const four = [tex, tex, tex, tex];
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
   * Textura da peça na vista atual.
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

  interface Drawable {
    readonly cell: Cell3D;
    readonly texture: Texture;
    readonly key: number;
  }

  const render = (state: SceneState): void => {
    gridPool.reset();
    blockPool.reset();
    overlayPool.reset();

    const { map, camera } = state;

    // --- células ocupadas ---
    const drawables: Drawable[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const [key, runs] of Object.entries(map.blocks)) {
      const [xs, ys] = key.split(':');
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      let z = 0;
      for (const run of runs) {
        if (run.block !== '') {
          for (let i = 0; i < run.count; i += 1) {
            const cell = { x, y, z: z + i };
            drawables.push({
              cell,
              texture: textureFor(run.block, camera.rotation),
              key: depthAt(cell, camera),
            });
          }
        }
        z += run.count;
      }
    }

    // --- malha do chão ---
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
        const s = gridPool.take();
        s.texture = gridTexture;
        s.width = geom.tileWidth * camera.zoom;
        s.height = geom.tileHeight * camera.zoom;
        s.x = p.x - (geom.tileWidth / 2) * camera.zoom;
        s.y = p.y;
        s.alpha = 1;
      }
    }

    // --- blocos, do fundo para a frente ---
    drawables.sort((a, b) => (a.key !== b.key ? a.key - b.key : a.cell.z - b.cell.z));
    for (const d of drawables) {
      const p = cellToScreen(d.cell, camera, geom);
      const s = blockPool.take();
      s.texture = d.texture;
      // A arte cobre o losango MAIS a profundidade das laterais; ancorar pelo
      // losango do topo é o que faz a peça assentar na célula certa.
      s.width = geom.tileWidth * camera.zoom;
      s.height = (geom.tileHeight + geom.zStep) * camera.zoom;
      s.x = p.x - (geom.tileWidth / 2) * camera.zoom;
      s.y = p.y;
      s.alpha = 1;
    }

    // --- realce da célula atingida ---
    if (state.highlight) {
      const p = cellToScreen(state.highlight, camera, geom);
      const s = overlayPool.take();
      s.texture = highlightTexture;
      s.width = geom.tileWidth * camera.zoom;
      s.height = geom.tileHeight * camera.zoom;
      s.x = p.x - (geom.tileWidth / 2) * camera.zoom;
      s.y = p.y;
    }

    // --- cubo semitransparente de preview ---
    if (state.preview) {
      const p = cellToScreen(state.preview, camera, geom);
      const s = overlayPool.take();
      s.texture = state.previewInvalid === true ? previewBad : previewOk;
      s.width = geom.tileWidth * camera.zoom;
      s.height = (geom.tileHeight + geom.zStep) * camera.zoom;
      s.x = p.x - (geom.tileWidth / 2) * camera.zoom;
      s.y = p.y;
    }
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

  return { app, setPalette, render, resize, destroy };
}
