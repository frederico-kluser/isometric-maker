/**
 * Renderizador isométrico do runtime — F4-02.
 *
 * Desenha o mapa com ordenação de profundidade (F2-03) e o personagem com
 * âncora medida e animações ao fps do sidecar.
 *
 * Este módulo é browser-only — importa de pixi.js.
 */
import {
  Container,
  Graphics,
  AnimatedSprite,
  Assets,
  TextureSource,
  type Spritesheet,
  type Application,
  type Renderer,
} from 'pixi.js';
import type { ProjectV1, ProjectGeometry } from '@isometric-maker/iso-core/project';
import type { MapData } from '@isometric-maker/iso-core/map';
import { sortByDepth, type DepthItem } from '@isometric-maker/iso-core/depth';
import { worldToScreen } from '@isometric-maker/iso-core/geometry';
import type { MovementState } from '@isometric-maker/iso-core/movement';

// ------------------------------------------------------------------ tipos

export interface RenderContext {
  readonly app: Application;
  readonly geom: ProjectGeometry;
  readonly mapLayer: Container;
  readonly entityLayer: Container;
}

export interface CharacterRender {
  readonly sprite: AnimatedSprite;
  readonly sidecarFps: Record<string, number>;
  /** Nome da animação actual. */
  currentAnim: string;
  /** Direcção actual (ângulo em radianos). */
  facing: number;
}

export interface FpsCounter {
  frames: number;
  lastTime: number;
  fps: number;
  drawCalls: number;
}

// ------------------------------------------------------------------ constantes

/** Cores de bloco para renderização de fallback (sem atlas de tiles). */
const BLOCK_COLORS: Record<string, number> = {
  grass: 0x4caf50,
  dirt: 0x8d6e63,
  stone: 0x9e9e9e,
  sand: 0xfff176,
  water: 0x42a5f5,
  wood: 0x795548,
};

/** Cor padrão para blocos sem cor conhecida. */
const DEFAULT_BLOCK_COLOR = 0x607d8b;

// ------------------------------------------------------------------ render context

export function createRenderContext(
  app: Application,
  geom: ProjectGeometry,
): RenderContext {
  const mapLayer = new Container();
  const entityLayer = new Container();
  app.stage.addChild(mapLayer);
  app.stage.addChild(entityLayer);

  return { app, geom, mapLayer, entityLayer };
}

// ------------------------------------------------------------------ mapa

/**
 * Desenha o mapa na camada `mapLayer`, usando ordenação de profundidade.
 *
 * Cada bloco é desenhado como um losango colorido. Arestas (paredes) são
 * desenhadas como linhas. A ordem de desenho segue `sortByDepth` (F2-03):
 * itens com chave `x+y+z` maior são desenhados por cima.
 */
export function drawMap(ctx: RenderContext, mapa: MapData): void {
  ctx.mapLayer.removeChildren();

  const items: DepthItem[] = [];

  // Recolhe blocos
  for (const [key, runs] of Object.entries(mapa.blocks)) {
    const [xs, ys] = key.split(':');
    const x = Number(xs!);
    const y = Number(ys!);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;

    let z = 0;
    for (const run of runs) {
      for (let i = 0; i < run.count; i++) {
        if (run.block !== '') {
          items.push({ kind: 'cell', x, y, z: z + i });
        }
      }
      z += run.count;
    }
  }

  // Recolhe arestas
  for (const edge of mapa.edges) {
    items.push({
      kind: 'edge',
      x: edge.x,
      y: edge.y,
      z: edge.z,
      lado: edge.lado,
    });
  }

  // Ordena por profundidade
  sortByDepth(items);

  // Desenha cada item
  for (const item of items) {
    const g = new Graphics();

    if (item.kind === 'cell') {
      const { sx, sy } = worldToScreen(item.x, item.y, item.z, ctx.geom);
      const color = getBlockColor(mapa, item.x, item.y, item.z);
      drawTile(g, sx, sy, ctx.geom, color);
    } else {
      const { sx, sy } = worldToScreen(item.x, item.y, item.z, ctx.geom);
      drawEdge(g, sx, sy, ctx.geom, item.lado);
    }

    ctx.mapLayer.addChild(g);
  }
}

function getBlockColor(
  mapa: MapData,
  x: number,
  y: number,
  z: number,
): number {
  const key = `${x}:${y}`;
  const runs = mapa.blocks[key];
  if (!runs) return DEFAULT_BLOCK_COLOR;

  let accZ = 0;
  for (const run of runs) {
    if (z >= accZ && z < accZ + run.count) {
      return BLOCK_COLORS[run.block] ?? DEFAULT_BLOCK_COLOR;
    }
    accZ += run.count;
  }
  return DEFAULT_BLOCK_COLOR;
}

function drawTile(
  g: Graphics,
  sx: number,
  sy: number,
  geom: ProjectGeometry,
  color: number,
): void {
  const hw = geom.tileWidth / 2;
  const hh = geom.tileHeight / 2;

  // Losango isométrico
  g.poly([
    sx, sy,           // topo
    sx + hw, sy + hh, // direita
    sx, sy + hh * 2,  // baixo
    sx - hw, sy + hh, // esquerda
  ]);
  g.fill({ color, alpha: 0.9 });

  // Contorno subtil
  g.poly([
    sx, sy,
    sx + hw, sy + hh,
    sx, sy + hh * 2,
    sx - hw, sy + hh,
  ]);
  g.stroke({ color: 0x000000, alpha: 0.15, width: 1 });
}

function drawEdge(
  g: Graphics,
  sx: number,
  sy: number,
  geom: ProjectGeometry,
  lado: string,
): void {
  const hw = geom.tileWidth / 2;
  const hh = geom.tileHeight / 2;

  let x1: number, y1: number, x2: number, y2: number;

  switch (lado) {
    case 'N':
      x1 = sx - hw; y1 = sy;
      x2 = sx;      y2 = sy - hh;
      break;
    case 'L':
      x1 = sx;      y1 = sy - hh;
      x2 = sx + hw; y2 = sy;
      break;
    case 'S':
      x1 = sx + hw; y1 = sy;
      x2 = sx;      y2 = sy + hh;
      break;
    case 'O':
      x1 = sx;      y1 = sy + hh;
      x2 = sx - hw; y2 = sy;
      break;
    default:
      return;
  }

  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke({ color: 0x5d4037, alpha: 0.8, width: 2 });
}

// ------------------------------------------------------------------ personagem

export async function createCharacterRender(
  sheetUrl: string,
  sidecar: { readonly fps: Record<string, number>; readonly anchor: { readonly x: number; readonly y: number } },
): Promise<CharacterRender> {
  TextureSource.defaultOptions.scaleMode = 'nearest';
  TextureSource.defaultOptions.autoGenerateMipmaps = false;

  const sheet = await Assets.load(sheetUrl) as Spritesheet;

  // Usa a primeira animação disponível, ou cria uma sprite estática.
  const animNames = Object.keys(sheet.animations ?? {});
  const firstAnim = animNames[0] ?? 'idle';
  const frames = sheet.animations?.[firstAnim];

  const sprite = new AnimatedSprite(
    frames && frames.length > 0 ? frames : [Object.values(sheet.textures)[0]!],
  );

  // Aplica a âncora medida do sidecar.
  sprite.anchor.set(sidecar.anchor.x, sidecar.anchor.y);
  sprite.animationSpeed = (sidecar.fps[firstAnim] ?? 8) / 60;

  if (frames && frames.length > 1) {
    sprite.play();
  }

  return {
    sprite,
    sidecarFps: sidecar.fps,
    currentAnim: firstAnim,
    facing: 0,
  };
}

/**
 * Troca a animação do personagem se a acção mudou.
 *
 * A selecção é baseada no estado de movimento:
 *   - `vel == 0` → idle
 *   - `vel > 0` → walk
 *   - `airborne` → jump
 */
export function updateCharacterAnim(
  char: CharacterRender,
  state: MovementState,
): void {
  let action: string;
  if (state.airborne) {
    action = 'jump';
  } else if (state.vel.x === 0 && state.vel.y === 0) {
    action = 'idle';
  } else {
    action = 'walk';
  }

  // Direcção cardinal mais próxima do ângulo de facing.
  const dir = facingToDirection(state.facing);

  const animName = `${action}_${dir}`; // ex.: walk_S
  if (animName === char.currentAnim) return;

  // Procura a animação no spritesheet carregado.
  const sheet = (char.sprite as unknown as { spritesheet?: Spritesheet }).spritesheet;
  if (sheet) {
    const frames = sheet.animations[animName];
    if (frames && frames.length > 0) {
      char.sprite.textures = frames;
      char.sprite.animationSpeed = (char.sidecarFps[animName] ?? 8) / 60;
      char.sprite.play();
      char.currentAnim = animName;
    }
  }

  char.facing = state.facing;
}

const DIRECTION_LABELS = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

function facingToDirection(angle: number): string {
  // Normaliza para [0, 2π)
  let a = angle % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  // 8 direcções: S=0, SW=π/4, W=π/2, NW=3π/4, N=π, NE=5π/4, E=3π/2, SE=7π/4
  const idx = Math.round((a / (Math.PI / 4)) % 8);
  return DIRECTION_LABELS[idx % 8]!;
}

// ------------------------------------------------------------------ fps

export function createFpsCounter(): FpsCounter {
  return { frames: 0, lastTime: performance.now(), fps: 0, drawCalls: 0 };
}

export function updateFps(
  counter: FpsCounter,
  renderer: Renderer,
): void {
  counter.frames++;
  const now = performance.now();
  if (now - counter.lastTime >= 1000) {
    counter.fps = counter.frames;
    counter.frames = 0;
    counter.lastTime = now;
    // PixiJS 8 expõe drawCalls via renderer.stats ou similar.
    // Usamos um fallback se não estiver disponível.
    counter.drawCalls = (renderer as unknown as Record<string, unknown>).drawCalls as number ?? 0;
    console.log(
      `FPS: ${counter.fps}  |  Draw Calls: ${counter.drawCalls}`,
    );
  }
}

// ------------------------------------------------------------------ posicionamento

/**
 * Posiciona o sprite do personagem no ecrã.
 *
 * A posição do modelo é convertida para coordenadas de ecrã via
 * `worldToScreen`.
 */
export function positionCharacter(
  sprite: AnimatedSprite,
  x: number,
  y: number,
  z: number,
  geom: ProjectGeometry,
): void {
  const { sx, sy } = worldToScreen(x, y, z, geom);
  sprite.x = sx;
  sprite.y = sy;
}
