/**
 * Atlas packing tests.
 *
 * These run without a PixelLab token and without spending anything: synthetic
 * PNGs stand in for generated frames. The point is to prove the properties that
 * make sprites render correctly, because every one of them is a silent failure
 * in the game rather than a crash:
 *   - the frame rect excludes the extrusion ring (otherwise sprites show a seam)
 *   - the extruded ring copies the border colour (otherwise a 1px halo)
 *   - packing is deterministic (otherwise the atlas cannot be cached by postHash)
 *   - the emitted JSON is exactly what PixiJS 8 parses
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { packGrid, sortFrames, frameName, shortDir, type FrameInput } from './atlas.ts';
import { canonicalJson, digest } from './util.ts';
import { validateSize, validateFrameBudget } from './endpoints.ts';

/** A solid square with a known border colour, so extrusion is checkable. */
async function makeFrame(dir: string, name: string, size: number, rgb: [number, number, number]) {
  const path = join(dir, `${name}.png`);
  await sharp({
    create: {
      width: size, height: size, channels: 4,
      background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 255 },
    },
  }).png().toFile(path);
  return path;
}

test('packGrid emits a PixiJS-shaped spritesheet with correct frame rects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-test-'));
  try {
    const frames: FrameInput[] = [];
    for (const [i, d] of (['south', 'south-west', 'west'] as const).entries()) {
      const name = frameName('wolf', 'walk', d, 0);
      frames.push({
        name,
        file: await makeFrame(dir, name, 16, [200, 30 + i * 10, 40]),
        animation: `wolf_walk_${shortDir(d)}`,
      });
    }

    const res = await packGrid(frames, join(dir, 'out'), 'wolf', { extrude: 1, padding: 2 });
    const sheet = JSON.parse(await readFile(res.jsonPath, 'utf8'));

    // Shape Pixi requires.
    assert.equal(sheet.meta.image, 'wolf.png');
    assert.equal(sheet.meta.format, 'RGBA8888');
    assert.equal(sheet.meta.scale, 1);
    assert.equal(Object.keys(sheet.frames).length, 3);
    assert.equal(Object.keys(sheet.animations).length, 3);

    const f = sheet.frames['wolf_walk_S_00'];
    assert.ok(f, 'frame wolf_walk_S_00 deve existir');
    // The rect is the sprite itself, not the extruded cell.
    assert.equal(f.frame.w, 16);
    assert.equal(f.frame.h, 16);
    assert.equal(f.rotated, false);
    assert.equal(f.trimmed, false);
    // Offset by the extrusion, so Pixi samples inside the real sprite.
    assert.equal(f.frame.x, 1);
    assert.equal(f.frame.y, 1);

    // Sheet is a multiple of 4 on both axes.
    assert.equal(sheet.meta.size.w % 4, 0);
    assert.equal(sheet.meta.size.h % 4, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('extrusion duplicates the border colour outside the frame rect', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-extrude-'));
  try {
    const name = frameName('wolf', 'idle', 'south', 0);
    const frames: FrameInput[] = [
      { name, file: await makeFrame(dir, name, 8, [255, 0, 0]), animation: 'wolf_idle_S' },
    ];
    const res = await packGrid(frames, join(dir, 'out'), 'wolf', { extrude: 1, padding: 0 });

    const { data, info } = await sharp(res.pngPath).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };
    // (0,0) is the extruded ring: must be the sprite's border colour, opaque.
    assert.deepEqual(at(0, 0), [255, 0, 0, 255], 'anel extrudado deve copiar a borda');
    // (1,1) is the first real sprite pixel.
    assert.deepEqual(at(1, 1), [255, 0, 0, 255]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('packing is deterministic — same input, byte-identical PNG', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-determinism-'));
  try {
    const build = async (outName: string) => {
      const frames: FrameInput[] = [];
      for (const d of ['north', 'south', 'east'] as const) {
        const name = frameName('orc', 'attack', d, 0);
        frames.push({
          name,
          file: await makeFrame(dir, `${name}-${outName}`, 12, [10, 120, 200]),
          animation: `orc_attack_${shortDir(d)}`,
        });
      }
      // Shuffle: sortFrames must impose canonical order regardless of input order.
      return packGrid(frames.reverse(), join(dir, outName), 'orc', {});
    };

    const a = await build('a');
    const b = await build('b');
    assert.equal(
      digest(await readFile(a.pngPath)),
      digest(await readFile(b.pngPath)),
      'o mesmo input tem que produzir o mesmo PNG byte a byte',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sortFrames orders by direction then frame index', () => {
  const names = [
    'w_walk_W_01', 'w_walk_S_01', 'w_walk_S_00', 'w_walk_SW_00', 'w_walk_W_00',
  ];
  const sorted = sortFrames(names.map((n) => ({ name: n, file: `${n}.png` })));
  assert.deepEqual(sorted.map((f) => f.name), [
    'w_walk_S_00', 'w_walk_S_01', 'w_walk_SW_00', 'w_walk_W_00', 'w_walk_W_01',
  ]);
});

test('canonicalJson is stable across key order and drops undefined', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  // -0 must not produce a second hash for the same value.
  assert.equal(canonicalJson({ v: -0 }), canonicalJson({ v: 0 }));
  assert.throws(() => canonicalJson({ v: NaN }), TypeError);
});

test('size validation catches the constraints that cost money after submit', () => {
  // 8-direction character: 16..128, and the canvas comes back ~40% bigger.
  assert.deepEqual(validateSize('create-character-with-8-directions', { width: 64, height: 64 }), []);
  assert.ok(
    validateSize('create-character-with-8-directions', { width: 168, height: 168 }).length > 0,
    '168 está fora da faixa 16–128 deste endpoint',
  );
  // pixen requires multiples of 4 and caps total area.
  assert.ok(validateSize('create-image-pixen', { width: 66, height: 64 }).length > 0);
  assert.ok(validateSize('create-image-pixen', { width: 768, height: 768 }).length > 0);
  // animate-with-skeleton only accepts an enumerated set.
  assert.deepEqual(validateSize('animate-with-skeleton', { width: 64, height: 64 }), []);
  assert.ok(validateSize('animate-with-skeleton', { width: 48, height: 48 }).length > 0);
  // The frame budget is a product, not a per-axis cap.
  assert.deepEqual(validateFrameBudget({ width: 128, height: 128 }, 16), []);
  assert.ok(validateFrameBudget({ width: 256, height: 256 }, 16).length > 0);
  assert.ok(validateFrameBudget({ width: 64, height: 64 }, 6).length > 0, 'frame_count 6 é inválido');
});
