/**
 * O contrato do giro rígido (ADR 0030): a matriz de tela `L(τ) = P∘R(τ)∘P⁻¹`
 * tem de concordar EXATAMENTE com a rotação discreta nos múltiplos de 90° —
 * igualdade estrita, não tolerância — porque é isso que garante que o quadro
 * de destino da transição aterrissa pixel a pixel sobre a vista final.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyAffine, rigidTurnMatrix, type GroundPlane } from './rotation-rigid.ts';
import { normalizeRotation, rotatePoint, type Rotation } from './rotation.ts';
import { CANONICAL_CUBE } from './iso-cube.ts';

/** A projeção do chão — a mesma fórmula única de camera.ts, em z = 0. */
function project(x: number, y: number, plane: GroundPlane): { x: number; y: number } {
  return {
    x: ((x - y) * plane.tileWidth) / 2 + 0,
    y: ((x + y) * plane.tileHeight) / 2 + 0,
  };
}

const PLANES: ReadonlyArray<[string, GroundPlane]> = [
  ['cubo canônico', { tileWidth: CANONICAL_CUBE.tileWidth, tileHeight: CANONICAL_CUBE.tileHeight }],
  ['64×32 clássico', { tileWidth: 64, tileHeight: 32 }],
];

const GRID = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

describe('rigidTurnMatrix — concordância exata com a rotação discreta', () => {
  for (const [nome, plane] of PLANES) {
    it(`leva a vista projetada à vista seguinte nos inteiros (${nome})`, () => {
      for (const de of [0, 1, 2, 3] as const) {
        for (const passo of [-3, -2, -1, 1, 2, 3]) {
          const m = rigidTurnMatrix(passo, plane);
          const destino = normalizeRotation(de + passo);
          for (const x of GRID) {
            for (const y of GRID) {
              const origem = rotatePoint(x, y, de);
              const esperado = project(
                rotatePoint(x, y, destino).x,
                rotatePoint(x, y, destino).y,
                plane,
              );
              const obtido = applyAffine(m, project(origem.x, origem.y, plane).x, project(origem.x, origem.y, plane).y);
              // Igualdade ESTRITA: a trigonometria é cravada nos inteiros.
              assert.deepEqual(obtido, esperado, `${nome} de=${de} passo=${passo} célula=(${x},${y})`);
            }
          }
        }
      }
    });
  }

  it('τ = 0 é a identidade, com e sem pivô', () => {
    const plane = { tileWidth: 48, tileHeight: 24 };
    for (const m of [rigidTurnMatrix(0, plane), rigidTurnMatrix(0, plane, 320, 240)]) {
      assert.deepEqual(applyAffine(m, 17, -5), { x: 17, y: -5 });
      assert.equal(m.a, 1);
      assert.equal(m.b, 0);
      assert.equal(m.c, 0);
      assert.equal(m.d, 1);
    }
  });

  it('o pivô é ponto fixo em qualquer τ', () => {
    const plane = { tileWidth: 48, tileHeight: 24 };
    for (const tau of [0.25, 0.5, 1, 1.75, -0.5, 3]) {
      const m = rigidTurnMatrix(tau, plane, 320, 240);
      const p = applyAffine(m, 320, 240);
      assert.ok(Math.abs(p.x - 320) < 1e-9 && Math.abs(p.y - 240) < 1e-9, `τ=${tau}`);
    }
  });

  it('a matriz com pivô é a conjugação da matriz na origem', () => {
    const plane = { tileWidth: 48, tileHeight: 24 };
    const px = 100;
    const py = 60;
    const semPivo = rigidTurnMatrix(0.37, plane);
    const comPivo = rigidTurnMatrix(0.37, plane, px, py);
    for (const [x, y] of [[0, 0], [50, -20], [-13, 7]] as const) {
      const via = applyAffine(semPivo, x - px, y - py);
      const direto = applyAffine(comPivo, x, y);
      assert.ok(Math.abs(direto.x - (via.x + px)) < 1e-9);
      assert.ok(Math.abs(direto.y - (via.y + py)) < 1e-9);
    }
  });

  it('compõe: L(0.3) depois L(0.7) ≈ L(1.0), e L(1.0) é exata', () => {
    const plane = { tileWidth: 48, tileHeight: 24 };
    const m3 = rigidTurnMatrix(0.3, plane);
    const m7 = rigidTurnMatrix(0.7, plane);
    const m10 = rigidTurnMatrix(1, plane);
    for (const [x, y] of [[24, 12], [-48, 36], [7, -19]] as const) {
      const encadeado = applyAffine(m7, applyAffine(m3, x, y).x, applyAffine(m3, x, y).y);
      const direto = applyAffine(m10, x, y);
      assert.ok(Math.abs(encadeado.x - direto.x) < 1e-9, `x em (${x},${y})`);
      assert.ok(Math.abs(encadeado.y - direto.y) < 1e-9, `y em (${x},${y})`);
    }
  });

  it('preserva área em todo τ (det = 1): o corpo é rígido no plano achatado', () => {
    const plane = { tileWidth: 64, tileHeight: 32 };
    for (const tau of [0, 0.1, 0.5, 0.9, 1, 2.4, -1.3]) {
      const m = rigidTurnMatrix(tau, plane);
      assert.ok(Math.abs(m.a * m.d - m.b * m.c - 1) < 1e-12, `τ=${tau}`);
    }
  });

  it('meia-volta é o espelho central exato, mesmo com pivô', () => {
    const plane = { tileWidth: 48, tileHeight: 24 };
    const m = rigidTurnMatrix(2, plane, 10, 20);
    // Espelho em torno do pivô: (10+dx, 20+dy) → (10−dx, 20−dy).
    assert.deepEqual(applyAffine(m, 13, 26), { x: 7, y: 14 });
    assert.deepEqual(applyAffine(m, 10, 20), { x: 10, y: 20 });
  });

  it('τ = 4 fecha o círculo: identidade exata', () => {
    const plane = { tileWidth: 48, tileHeight: 24 };
    const m = rigidTurnMatrix(4, plane, 5, 5);
    assert.deepEqual(applyAffine(m, 99, -3), { x: 99, y: -3 });
  });
});
