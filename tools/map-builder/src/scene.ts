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
 * ## O giro (ADR 0030 — o quadro inteiro como corpo rígido)
 *
 * A versão anterior (ADR 0026) interpolava a POSIÇÃO de cada bloco e fazia
 * cross-fade por peça. A matemática estava certa e a tela errada: no meio do
 * giro o reticulado projetado comprime, cada sprite mantém o tamanho, e o mapa
 * lê como peças deslizando soltas — não como uma câmera girando.
 *
 * Agora a transição fotografa a vista de ORIGEM e a de DESTINO em duas
 * `RenderTexture` e aplica a cada uma A MESMA transformação afim
 * (`rigidTurnMatrix`, o squash–rotate–unsquash do plano do chão), com
 * cross-fade entre as duas. O precedente é o Mode 7 do SNES (Contra III gira o
 * cenário composto como camada única) somado ao insight do Doom: a arte de
 * cada peça nunca é reamostrada isoladamente — seleciona-se a vista
 * pré-desenhada e o movimento fica na projeção. Nos extremos o quadro é o
 * desenho discreto normal, pixel-perfeito; o meio do giro é uma varredura de
 * 280 ms do quadro composto.
 */
import {
  Application,
  Assets,
  Container,
  Sprite,
  Spritesheet,
  Texture,
  TextureSource,
} from 'pixi.js';
import type { MapData } from '@isometric-maker/iso-core/map';
import { rotateDirectionIndex, type Rotation } from '@isometric-maker/iso-core/rotation';
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

/** Uma peça colocável: arte gerada (4 faces ou textura animada) ou cubo procedural. */
export interface BlockDef {
  readonly id: string;
  readonly label: string;
  /** Hash do asset no catálogo — monta a miniatura da paleta (v3: texture). */
  readonly hash?: string | undefined;
  /** URLs das quatro faces (v2: chained/rotated). Ausente = cubo procedural ou textura. */
  readonly faceUrls?: Readonly<Record<Facing, string>> | undefined;
  /**
   * Matiz HSL do cubo procedural. Ausente, um cinza neutro — derivar do id dá
   * cor estável, mas sem relação com o material (foi como "Grama" saiu
   * vermelha).
   */
  readonly hue?: number | undefined;
  /** URL da spritesheet da animação (v3: texture, ADR 0032). */
  readonly spritesheetUrl?: string | undefined;
  /** URL do sidecar de animação com fps e frameCount. */
  readonly animationUrl?: string | undefined;
  /** Número de frames da animação (v3: texture). 0 = estático. */
  readonly frameCount?: number | undefined;
  /** FPS da animação (v3: texture). */
  readonly fps?: number | undefined;
  /** Ping-pong: vai-e-volta em vez de loop com reset. Default true. */
  readonly pingPong?: boolean | undefined;
  /** false = bloco estático, sem animação. Default true. */
  readonly animated?: boolean | undefined;
  /** URL da imagem base (estática) quando animated === false. */
  readonly baseUrl?: string | undefined;
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
  /** Gira a câmera — imediato, sem animação. Devolve a câmera final. */
  rotateTo(rotation: Rotation, options: RotateOptions): Camera;
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

  /** id da peça → textura por face; peça procedural tem a mesma nas quatro.
   *  Para blocos 'texture' (v3), o array tem os frames da animação. */
  const artwork = new Map<string, Texture[]>();

  /** Estado de animação por bloco: frame atual, direção e timestamp do último avanço. */
  const animState = new Map<string, { frame: number; direction: 1 | -1; lastMs: number }>();
  /** Ping-pong ativo por bloco. */
  const pingPongFlag = new Map<string, boolean>();
  let animTickerActive = false;

  /** Avança o frame de todos os blocos animados. Chamado pelo ticker. */
  const tickAnim = (): void => {
    const now = performance.now();
    let anyAnimating = false;
    for (const [id, state] of animState) {
      const frames = artwork.get(id);
      if (!frames || frames.length <= 1) continue;
      const fps = animFps.get(id) ?? 8;
      const interval = 1000 / fps;
      if (now - state.lastMs >= interval) {
        const last = frames.length - 1;
        const pingPong = pingPongFlag.get(id) ?? true;
        if (pingPong) {
          // Vai-e-volta: 0 → 1 → ... → last → last-1 → ... → 0 → ...
          const next = state.frame + state.direction;
          if (next > last) {
            state.direction = -1;
            state.frame = last - 1;
          } else if (next < 0) {
            state.direction = 1;
            state.frame = 1;
          } else {
            state.frame = next;
          }
        } else {
          state.frame = (state.frame + 1) % frames.length;
        }
        state.lastMs = now;
      }
      anyAnimating = true;
    }
    // Se há blocos animados, redesenha para mostrar o novo frame.
    if (anyAnimating && lastState) {
      render(lastState);
    }
  };

  /** FPS de animação por bloco. */
  const animFps = new Map<string, number>();

  /**
   * Cubo procedural determinístico, criado sob demanda e cacheado.
   *
   * QUATRO texturas, uma por vista — mesmo tom de face, desenho de material
   * diferente. Uma textura só nas quatro vistas faria o giro parecer a mesma
   * figura deslizando, que é o oposto do efeito de volume.
   *
   * Sem `hue` declarado (blocos gerados só têm hash/spritesheetUrl), cinza
   * neutro: cor derivada do hash é estável, mas o usuário confia nela — e
   * "Grama" saiu vermelha exatamente assim.
   */
  function proceduralFor(id: string, hue?: number): Texture[] {
    const cached = artwork.get(id);
    if (cached) return cached;
    // Saturação 0 anula o matiz: hsl(h, 0, l) é cinza para qualquer h.
    const saturation = hue === undefined ? 0 : 0.45;
    const four = makeCubeViewsFromHue(hue ?? 0, cubeGeom, saturation).map(fromCanvas);
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
      animState.delete(b.id);
      animFps.delete(b.id);
      pingPongFlag.delete(b.id);

      // v3 estático: sem animação, só a imagem base.
      if (b.animated === false || b.frameCount === 0) {
        const staticUrl = b.baseUrl ?? (b.hash ? `/world-blocks/${b.hash}/base.png` : undefined);
        if (!staticUrl) {
          proceduralFor(b.id, b.hue);
          continue;
        }
        try {
          const tex = await Assets.load<Texture>(staticUrl);
          tex.source.scaleMode = 'nearest';
          tex.source.autoGenerateMipmaps = false;
          artwork.set(b.id, [tex]);
        } catch {
          proceduralFor(b.id, b.hue);
        }
        continue;
      }

      // v3: textura animada (ADR 0032)
      if (b.spritesheetUrl) {
        try {
          // O catálogo devolve a URL do PNG. O atlas JSON está no mesmo path
          // com extensão .json. O Assets.load do PixiJS 8 reconhece o JSON
          // como Spritesheet e carrega a imagem referenciada em meta.image.
          const atlasUrl = b.spritesheetUrl.replace(/\.png$/, '.json');
          const sheet = await Assets.load<Spritesheet>(atlasUrl);
          // O packer grava a animação sob a chave `anim`
          // (tools/character-builder/server/world-block.ts, packSpritesheet).
          // Depois do parse, animations.anim é Texture[] — texturas já
          // resolvidas, NÃO nomes de frame. O código antigo tratava como
          // string[] e procurava cada elemento em sheet.textures: o lookup
          // com uma Texture como chave nunca achava nada, o array ficava
          // vazio e todo bloco 'texture' caía no cubo procedural.
          const animTextures: Texture[] = sheet.animations['anim'] ?? [];
          if (animTextures.length > 0) {
            for (const tex of animTextures) {
              tex.source.scaleMode = 'nearest';
              tex.source.autoGenerateMipmaps = false;
            }
            artwork.set(b.id, animTextures);
            animState.set(b.id, { frame: 0, direction: 1, lastMs: performance.now() });
            animFps.set(b.id, b.fps ?? 8);
            pingPongFlag.set(b.id, b.pingPong ?? true);
            // Liga o ticker de animação se ainda não estiver ativo.
            if (!animTickerActive) {
              animTickerActive = true;
              app.ticker.add(tickAnim);
            }
            console.log(
              `[scene] spritesheet ok: ${b.id} — ${animTextures.length} frames at ${b.fps ?? 8} fps (${atlasUrl})`,
            );
          } else {
            // Atlas sem a chave `anim` é estado de conteúdo, não erro: a peça
            // continua colocável como cubo procedural.
            console.warn(`[scene] spritesheet has no animations['anim']: ${b.id} (${atlasUrl})`);
            proceduralFor(b.id, b.hue);
          }
        } catch (err) {
          // Arte que não carrega NÃO derruba o editor.
          console.warn('[scene] spritesheet load failed:', b.id, err);
          proceduralFor(b.id, b.hue);
        }
        continue;
      }

      // v2: 4 faces (ADR 0029)
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
   * Textura da peça para desenho.
   *
   * Blocos v3 ('texture', ADR 0032): a textura é a mesma em qualquer vista —
   * o frame atual da animação. A rotação de câmera não afeta a arte.
   *
   * Blocos v2 (4 faces, ADR 0029): `(facing + rotation) mod 4` seleciona a
   * face correta para a vista da câmera.
   */
  function textureFor(blockId: string, rotation: Rotation): Texture {
    const frames = artwork.get(blockId) ?? proceduralFor(blockId);
    // Bloco animado (texture): sempre o frame atual, independe da rotação.
    if (animState.has(blockId)) {
      const state = animState.get(blockId);
      const idx = state?.frame ?? 0;
      return frames[idx] ?? frames[0]!;
    }
    // Bloco de 4 faces: seleciona por rotação.
    const idx = rotateDirectionIndex(0, 4, rotation);
    return frames[idx] ?? frames[0]!;
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

    // render() só desenha vistas DISCRETAS. A transição não passa por aqui:
    // ela transforma dois snapshots prontos (ADR 0030), e por isso a vista da
    // textura é sempre a rotação da câmera, nunca uma fração de giro.
    const vista = camera.rotation;

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
      place(base, textureFor(d.block, vista), p, camera.zoom, cubeGeom.anchorX, cubeGeom.anchorY);
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

  const rotateTo = (rotation: Rotation, opts: RotateOptions): Camera => {
    const state = lastState;
    if (!state) {
      return { ...DEFAULT_CAMERA_FALLBACK, rotation, turn: rotation };
    }
    const pan = centerOn(
      opts.cells,
      rotation,
      opts.viewportWidth,
      opts.viewportHeight,
      state.camera.zoom,
      geom,
    );
    const final: Camera = { rotation, turn: rotation, zoom: state.camera.zoom, ...pan };
    render({ ...state, camera: final, preview: null, highlight: null });
    return final;
  };

  const resize = (width: number, height: number): void => {
    app.renderer.resize(width, height);
  };

  const destroy = (): void => {
    if (animTickerActive) {
      app.ticker.remove(tickAnim);
      animTickerActive = false;
    }
    gridPool.destroy();
    blockPool.destroy();
    overlayPool.destroy();
    for (const t of owned) t.destroy(true);
    owned.length = 0;
    artwork.clear();
    animState.clear();
    animFps.clear();
    pingPongFlag.clear();
    app.destroy(true, { children: true, texture: true, textureSource: true });
  };

  return { app, setPalette, render, rotateTo, resize, destroy };
}

/** Só para o caso impossível de girar antes do primeiro desenho. */
const DEFAULT_CAMERA_FALLBACK: Camera = {
  rotation: 0,
  turn: 0,
  panX: 0,
  panY: 0,
  zoom: 2,
};
