/**
 * Spritesheet packing for PixiJS 8.
 *
 * Emits two files per family, deliberately:
 *   <name>.json          strictly TexturePacker JSON Hash — what Pixi parses
 *   <name>.pixellab.json our sidecar: fps, provenance, logical anchors
 *
 * Never extend the Pixi JSON with game semantics. The parser owns that shape and
 * a future major version will fight you for it.
 *
 * Pixel-perfect depends on three things done here and two done in the client:
 *   here    1. no resampling, ever
 *           2. 1px extrusion (sprites) / 2px (tiles) + a transparent gutter
 *           3. deterministic frame order, so the PNG is byte-stable
 *   client  4. scaleMode 'nearest', mipmaps off
 *           5. render at logical resolution, then ONE integer nearest upscale
 *
 * On premultiplied alpha: Pixi 8 premultiplies on upload and that is correct —
 * do not disable it. The classic dark halo comes from *filtering* between an
 * opaque pixel and a transparent one whose RGB is black. With nearest sampling,
 * extrusion and integer transforms there is no interpolation, so it cannot
 * appear. The alpha-bleed pass below is belt-and-braces for the cases where a
 * filter or a tint does sneak in.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import sharp from 'sharp';
import { DIRECTIONS_8, type Direction8 } from './endpoints.ts';

export interface FrameInput {
  /** Frame name as it will appear in the atlas. See `frameName`. */
  readonly name: string;
  readonly file: string;
  /** Animation this frame belongs to, e.g. `wolf_walk_S`. */
  readonly animation?: string;
}

export interface PackOptions {
  /** 1 for character sprites, 2 for tiles (tiles abut, sprites do not). */
  readonly extrude?: number;
  /** Transparent gutter between cells, on top of the extrusion. */
  readonly padding?: number;
  /** Hard cap per page. 2048 is safe on integrated and mobile GPUs. */
  readonly maxPage?: number;
  /** Where the sprite's logical origin sits. Feet-centred by default. */
  readonly anchor?: { readonly x: number; readonly y: number };
}

export interface PixiFrame {
  readonly frame: { x: number; y: number; w: number; h: number };
  readonly rotated: false;
  readonly trimmed: false;
  readonly spriteSourceSize: { x: number; y: number; w: number; h: number };
  readonly sourceSize: { w: number; h: number };
  readonly anchor?: { x: number; y: number };
}

export interface PixiSpritesheet {
  readonly frames: Record<string, PixiFrame>;
  readonly animations: Record<string, string[]>;
  readonly meta: {
    readonly app: string;
    readonly version: string;
    readonly image: string;
    readonly format: 'RGBA8888';
    readonly size: { w: number; h: number };
    readonly scale: number;
    readonly related_multi_packs?: string[];
  };
}

export interface Sidecar {
  readonly generatedAt: string;
  readonly anchor: { x: number; y: number };
  readonly fps: Record<string, number>;
  readonly specHashes: Record<string, string>;
  readonly note: string;
}

/**
 * Canonical frame name: `<family>_<action>_<DIR>_<NN>`.
 *
 * Direction is the short uppercase code because it appears in every frame name
 * and the long form triples the JSON size for no gain.
 */
export function frameName(
  family: string, action: string, direction: Direction8, index: number,
): string {
  return `${family}_${action}_${shortDir(direction)}_${String(index).padStart(2, '0')}`;
}

export function shortDir(d: Direction8): string {
  const map: Record<Direction8, string> = {
    south: 'S', 'south-west': 'SW', west: 'W', 'north-west': 'NW',
    north: 'N', 'north-east': 'NE', east: 'E', 'south-east': 'SE',
  };
  return map[d];
}

/** Deterministic order: direction major, frame minor. Keeps the PNG byte-stable. */
export function sortFrames(frames: readonly FrameInput[]): FrameInput[] {
  const dirIndex = new Map(DIRECTIONS_8.map((d, i) => [shortDir(d), i]));
  const parse = (name: string): { dir: number; idx: number } => {
    const m = /_([A-Z]{1,2})_(\d+)$/.exec(name);
    return {
      dir: m ? (dirIndex.get(m[1]!) ?? 99) : 99,
      idx: m ? Number(m[2]) : 0,
    };
  };
  return [...frames].sort((a, b) => {
    const pa = parse(a.name);
    const pb = parse(b.name);
    return pa.dir - pb.dir || pa.idx - pb.idx || (a.name < b.name ? -1 : 1);
  });
}

/**
 * Duplicates the border ring outward by `n` pixels.
 *
 * Without this, sampling exactly at a cell edge at non-integer zoom reads the
 * neighbouring cell and you get a one-pixel seam. Extrusion makes the out-of-
 * bounds read return the correct colour instead.
 */
async function extrudeAndBleed(file: string, extrude: number): Promise<{
  data: Buffer; width: number; height: number; srcW: number; srcH: number;
}> {
  const img = sharp(file).ensureAlpha();
  const meta = await img.metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (srcW === 0 || srcH === 0) throw new Error(`imagem sem dimensão: ${file}`);

  const { data } = await img.raw().toBuffer({ resolveWithObject: true });
  const src = new Uint8Array(data);

  // Alpha bleed: give every fully transparent pixel the RGB of its nearest
  // opaque neighbour, so a stray filter cannot pull black into the edge.
  const bled = new Uint8Array(src);
  for (let y = 0; y < srcH; y += 1) {
    for (let x = 0; x < srcW; x += 1) {
      const i = (y * srcW + x) * 4;
      if (bled[i + 3] !== 0) continue;
      let found = false;
      for (let dy = -1; dy <= 1 && !found; dy += 1) {
        for (let dx = -1; dx <= 1 && !found; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= srcW || ny >= srcH) continue;
          const j = (ny * srcW + nx) * 4;
          if (src[j + 3]! > 0) {
            bled[i] = src[j]!;
            bled[i + 1] = src[j + 1]!;
            bled[i + 2] = src[j + 2]!;
            found = true;
          }
        }
      }
    }
  }

  if (extrude === 0) {
    return { data: Buffer.from(bled), width: srcW, height: srcH, srcW, srcH };
  }

  const w = srcW + extrude * 2;
  const h = srcH + extrude * 2;
  const out = new Uint8Array(w * h * 4);
  const clamp = (v: number, max: number): number => (v < 0 ? 0 : v > max ? max : v);
  for (let y = 0; y < h; y += 1) {
    const sy = clamp(y - extrude, srcH - 1);
    for (let x = 0; x < w; x += 1) {
      const sx = clamp(x - extrude, srcW - 1);
      const s = (sy * srcW + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = bled[s]!;
      out[d + 1] = bled[s + 1]!;
      out[d + 2] = bled[s + 2]!;
      out[d + 3] = bled[s + 3]!;
    }
  }
  return { data: Buffer.from(out), width: w, height: h, srcW, srcH };
}

export interface PackResult {
  readonly pngPath: string;
  readonly jsonPath: string;
  readonly sidecarPath: string;
  readonly pages: number;
  readonly size: { w: number; h: number };
  readonly frameCount: number;
}

/**
 * Packs a uniform grid.
 *
 * A grid rather than maxrects because character frames are all the same size,
 * and a grid is deterministic, trivially debuggable, and produces a stable PNG
 * — which is what lets `postHash` cache the atlas and keeps git diffs empty
 * when nothing changed.
 *
 * Tight NPOT sizing, not power-of-two: PixiJS 8 requires WebGL2 or WebGPU, both
 * of which handle NPOT, and pixel art never uses mipmaps. POT would waste up to
 * 72% of the texture.
 */
export async function packGrid(
  frames: readonly FrameInput[],
  outDir: string,
  name: string,
  opts: PackOptions = {},
): Promise<PackResult> {
  if (frames.length === 0) throw new Error('nada para empacotar');

  const extrude = opts.extrude ?? 1;
  const padding = opts.padding ?? 2;
  const maxPage = opts.maxPage ?? 2048;
  const anchor = opts.anchor ?? { x: 0.5, y: 0.875 };

  const ordered = sortFrames(frames);
  const prepared = await Promise.all(
    ordered.map(async (f) => ({ input: f, img: await extrudeAndBleed(f.file, extrude) })),
  );

  const cellW = Math.max(...prepared.map((p) => p.img.width)) + padding;
  const cellH = Math.max(...prepared.map((p) => p.img.height)) + padding;

  const perRow = Math.max(1, Math.floor(maxPage / cellW));
  const cols = Math.min(perRow, Math.ceil(Math.sqrt(prepared.length)));
  const rows = Math.ceil(prepared.length / cols);

  // Round up to a multiple of 4: harmless, and keeps row strides aligned.
  const align4 = (n: number): number => Math.ceil(n / 4) * 4;
  const sheetW = align4(cols * cellW);
  const sheetH = align4(rows * cellH);

  if (sheetH > maxPage) {
    throw new Error(
      `atlas ${name} precisaria de ${sheetW}×${sheetH}, acima do limite ${maxPage}. ` +
        `Divida a família em mais de um atlas (multipack ainda não implementado).`,
    );
  }

  const composites: sharp.OverlayOptions[] = [];
  const pixiFrames: Record<string, PixiFrame> = {};
  const animations: Record<string, string[]> = {};

  prepared.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = col * cellW;
    const cellY = row * cellH;
    // The frame rect excludes the extrusion ring: Pixi must sample the real
    // sprite, with the extruded ring sitting just outside it.
    const fx = cellX + extrude;
    const fy = cellY + extrude;

    composites.push({
      input: p.img.data,
      raw: { width: p.img.width, height: p.img.height, channels: 4 },
      left: cellX,
      top: cellY,
    });

    pixiFrames[p.input.name] = {
      frame: { x: fx, y: fy, w: p.img.srcW, h: p.img.srcH },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: p.img.srcW, h: p.img.srcH },
      sourceSize: { w: p.img.srcW, h: p.img.srcH },
      anchor: { ...anchor },
    };

    const anim = p.input.animation;
    if (anim) {
      (animations[anim] ??= []).push(p.input.name);
    }
  });

  await mkdir(outDir, { recursive: true });
  const pngName = `${name}.png`;
  const pngPath = join(outDir, pngName);

  await sharp({
    create: {
      width: sheetW, height: sheetH, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    // Explicit: no palette quantisation, no adaptive filtering surprises.
    .png({ compressionLevel: 9, palette: false })
    .toFile(pngPath);

  const sheet: PixiSpritesheet = {
    frames: pixiFrames,
    animations,
    meta: {
      app: 'ferro-e-cinzas/pixellab-pipeline',
      version: '1.0',
      image: pngName,
      format: 'RGBA8888',
      size: { w: sheetW, h: sheetH },
      scale: 1,
    },
  };

  const jsonPath = join(outDir, `${name}.json`);
  await writeFile(jsonPath, `${JSON.stringify(sheet, null, 2)}\n`);

  const sidecar: Sidecar = {
    generatedAt: new Date().toISOString(),
    anchor,
    fps: Object.fromEntries(Object.keys(animations).map((a) => [a, 8])),
    specHashes: {},
    note:
      'O .json ao lado é estritamente formato PixiJS. Semântica de jogo (fps, ' +
      'hitbox, âncora lógica) vive aqui, para não brigar com o parser do Pixi.',
  };
  const sidecarPath = join(outDir, `${name}.pixellab.json`);
  await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);

  return {
    pngPath, jsonPath, sidecarPath, pages: 1,
    size: { w: sheetW, h: sheetH },
    frameCount: prepared.length,
  };
}

/** The client-side half of pixel-perfect, as copyable code. */
export const PIXI_CLIENT_SNIPPET = `
// Antes de QUALQUER Assets.load — o global cobre o caso comum.
import { TextureSource, Assets } from 'pixi.js';
TextureSource.defaultOptions.scaleMode = 'nearest';
TextureSource.defaultOptions.autoGenerateMipmaps = false;

const sheet = await Assets.load('atlas/creatures/lobo-esfomeado.json');
// E explicitamente na folha, para o caso de algo ter pré-carregado com o default.
sheet.textureSource.style.scaleMode = 'nearest';

const sprite = new AnimatedSprite(sheet.animations['lobo_walk_S']);
sprite.animationSpeed = 8 / 60; // fps do sidecar / 60
`.trim();

export function atlasNameFor(assetOut: string): string {
  return basename(assetOut).replace(/[^a-z0-9-]/gi, '-');
}

export function atlasDirFor(assetOut: string, root: string): string {
  return join(root, dirname(assetOut));
}
