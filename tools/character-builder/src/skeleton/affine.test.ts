/**
 * Testes de rescale (F1-05).
 *
 * Verifica:
 *   1. Escala 1 é identidade.
 *   2. Dobrar a altura dobra as distâncias.
 *   3. Reescalar e desreescalar volta ao original.
 *   4. Translação mantém o bounding box centrado.
 *   5. Array vazio não lança.
 *
 * Execute com: npx tsx src/skeleton/affine.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rescale, type Keypoint2D } from './affine.ts';

// ------------------------------------------------------------------ helpers

const EPS = 1e-9;

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS;
}

/** Conjunto de keypoints de teste — um stick figure simples de altura 64. */
const STICK_64: readonly Keypoint2D[] = [
  { label: 'NOSE', x: 32, y: 8 },
  { label: 'NECK', x: 32, y: 16 },
  { label: 'RIGHT SHOULDER', x: 48, y: 20 },
  { label: 'RIGHT ELBOW', x: 56, y: 32 },
  { label: 'RIGHT ARM', x: 60, y: 44 },
  { label: 'LEFT SHOULDER', x: 16, y: 20 },
  { label: 'LEFT ELBOW', x: 8, y: 32 },
  { label: 'LEFT ARM', x: 4, y: 44 },
  { label: 'RIGHT HIP', x: 40, y: 40 },
  { label: 'RIGHT KNEE', x: 44, y: 52 },
  { label: 'RIGHT LEG', x: 48, y: 64 },
  { label: 'LEFT HIP', x: 24, y: 40 },
  { label: 'LEFT KNEE', x: 20, y: 52 },
  { label: 'LEFT LEG', x: 16, y: 64 },
  { label: 'RIGHT EYE', x: 36, y: 6 },
  { label: 'LEFT EYE', x: 28, y: 6 },
  { label: 'RIGHT EAR', x: 42, y: 10 },
  { label: 'LEFT EAR', x: 22, y: 10 },
];

// ------------------------------------------------------------------ testes

describe('rescale — escala uniforme + translação', () => {
  it('escala 1 é identidade', () => {
    const result = rescale(STICK_64, 64, 64);
    assert.strictEqual(result.length, STICK_64.length);

    for (let i = 0; i < STICK_64.length; i++) {
      const orig = STICK_64[i]!;
      const res = result[i]!;
      assert.strictEqual(res.label, orig.label);
      assert.ok(
        approxEqual(res.x, orig.x),
        `${orig.label}: x esperado ${orig.x}, obtido ${res.x}`,
      );
      assert.ok(
        approxEqual(res.y, orig.y),
        `${orig.label}: y esperado ${orig.y}, obtido ${res.y}`,
      );
    }
  });

  it('dobrar a altura dobra as distâncias entre keypoints', () => {
    const result = rescale(STICK_64, 128, 64);

    // Distância entre NOSE e LEFT LEG no original
    const dx0 = STICK_64[0]!.x - STICK_64[13]!.x; // 32 - 16 = 16
    const dy0 = STICK_64[0]!.y - STICK_64[13]!.y; // 8 - 64 = -56

    const dx1 = result[0]!.x - result[13]!.x;
    const dy1 = result[0]!.y - result[13]!.y;

    assert.ok(approxEqual(dx1, dx0 * 2), `dx: ${dx1} vs ${dx0 * 2}`);
    assert.ok(approxEqual(dy1, dy0 * 2), `dy: ${dy1} vs ${dy0 * 2}`);
  });

  it('dobrar a altura dobra a largura do bounding box', () => {
    const result = rescale(STICK_64, 128, 64);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const kp of result) {
      if (kp.x < minX) minX = kp.x;
      if (kp.y < minY) minY = kp.y;
      if (kp.x > maxX) maxX = kp.x;
      if (kp.y > maxY) maxY = kp.y;
    }

    const width = maxX - minX;
    const height = maxY - minY;

    // Original: maxX-minX = 60-4 = 56, maxY-minY = 64-6 = 58
    assert.ok(approxEqual(width, 56 * 2), `largura: ${width}`);
    assert.ok(approxEqual(height, 58 * 2), `altura: ${height}`);
  });

  it('reescalar e desreescalar volta ao original', () => {
    // Escala para 128 e depois de volta para 64
    const scaled = rescale(STICK_64, 128, 64);
    const restored = rescale(scaled, 64, 128);

    assert.strictEqual(restored.length, STICK_64.length);
    for (let i = 0; i < STICK_64.length; i++) {
      const orig = STICK_64[i]!;
      const res = restored[i]!;
      assert.strictEqual(res.label, orig.label);
      assert.ok(
        approxEqual(res.x, orig.x),
        `${orig.label}: x esperado ${orig.x}, obtido ${res.x}`,
      );
      assert.ok(
        approxEqual(res.y, orig.y),
        `${orig.label}: y esperado ${orig.y}, obtido ${res.y}`,
      );
    }
  });

  it('escala 0.5 reduz os keypoints para metade', () => {
    const result = rescale(STICK_64, 32, 64);
    assert.strictEqual(result.length, STICK_64.length);

    // Distância NOSE → LEFT LEG deve ser metade
    const dx0 = STICK_64[0]!.x - STICK_64[13]!.x; // 16
    const dx1 = result[0]!.x - result[13]!.x;
    assert.ok(approxEqual(dx1, dx0 * 0.5), `dx: ${dx1} vs ${dx0 * 0.5}`);
  });

  it('array vazio devolve array vazio', () => {
    const result = rescale([], 128, 64);
    assert.deepStrictEqual(result, []);
  });

  it('keypoint único: escala em torno de si mesmo não muda posição', () => {
    const single: Keypoint2D[] = [{ label: 'NOSE', x: 10, y: 20 }];
    const result = rescale(single, 200, 100);

    assert.strictEqual(result.length, 1);
    const kp = result[0]!;
    // factor = 200/100 = 2, mas centro = (10,20) é o próprio ponto
    // x' = 10 + (10-10)*2 = 10
    // y' = 20 + (20-20)*2 = 20
    assert.ok(approxEqual(kp.x, 10), `x: ${kp.x}`);
    assert.ok(approxEqual(kp.y, 20), `y: ${kp.y}`);
  });

  it('escala preserva o centro do bounding box', () => {
    // Usa keypoints assimétricos para testar a escala em torno do centro
    const kps: Keypoint2D[] = [
      { label: 'A', x: 0, y: 0 },
      { label: 'B', x: 100, y: 200 },
    ];

    const result = rescale(kps, 300, 100);
    // factor = 3
    // cx = 50, cy = 100
    // A: 50 + (0-50)*3 = 50 - 150 = -100
    // B: 50 + (100-50)*3 = 50 + 150 = 200
    // Centro: ((-100+200)/2, (100-300?))...
    // cy: A: 100 + (0-100)*3 = 100 - 300 = -200
    //     B: 100 + (200-100)*3 = 100 + 300 = 400
    // Centro: ((-100+200)/2, (-200+400)/2) = (50, 100) — preservado!

    const cxOut = (result[0]!.x + result[1]!.x) / 2;
    const cyOut = (result[0]!.y + result[1]!.y) / 2;
    assert.ok(approxEqual(cxOut, 50), `centro x: ${cxOut}`);
    assert.ok(approxEqual(cyOut, 100), `centro y: ${cyOut}`);
  });

  it('não modifica o array original', () => {
    const original = [...STICK_64];
    rescale(STICK_64, 128, 64);
    assert.deepStrictEqual(STICK_64, original);
  });

  it('labels são preservadas', () => {
    const result = rescale(STICK_64, 96, 64);
    for (let i = 0; i < STICK_64.length; i++) {
      assert.strictEqual(result[i]!.label, STICK_64[i]!.label);
    }
  });

  it('escala com altura canónica zero lança (divisão por zero)', () => {
    assert.throws(
      () => rescale(STICK_64, 64, 0),
      (err: unknown) => err instanceof Error,
    );
  });
});
