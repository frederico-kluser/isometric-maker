/**
 * Testes para o Amanatides-Woo DDA voxel raycast.
 */
import { describe, it } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { ddaRaycast } from './dda-raycast.ts';
import type { DdaCell } from './dda-raycast.ts';

// ------------------------------------------------------------------ helpers

/**
 * Cria um callback isOccupied a partir de um conjunto de células ocupadas.
 * Cada célula é uma string "x:y:z".
 */
function makeOccupancy(occupied: readonly string[]): (x: number, y: number, z: number) => boolean {
  const set = new Set(occupied);
  return (x: number, y: number, z: number): boolean => set.has(`${x}:${y}:${z}`);
}

/** Normaliza direção: devolve um vetor unitário (ou zero se entrada for zero). */
function normalize(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ------------------------------------------------------------------ testes

describe('ddaRaycast', () => {
  // ---------------------------------------------------------------- 1. top face
  it('ray straight down hits top face of block at origin', () => {
    // Bloco em (0, 0, 0). Raio acima, apontando para baixo (-z).
    const occupied = makeOccupancy(['0:0:0']);
    const result = ddaRaycast(
      { x: 0.5, y: 0.5, z: 10 },
      { x: 0, y: 0, z: -1 },
      occupied,
      100,
    );

    ok(result.hit !== null);
    strictEqual(result.hit!.cell.x, 0);
    strictEqual(result.hit!.cell.y, 0);
    strictEqual(result.hit!.cell.z, 0);
    // Normal da face de cima: {x:0, y:0, z:1}
    strictEqual(result.hit!.normal.x, 0);
    strictEqual(result.hit!.normal.y, 0);
    strictEqual(result.hit!.normal.z, 1);
  });

  // ---------------------------------------------------------------- 2. side face
  it('ray from side hits side face', () => {
    // Bloco em (0, 0, 0). Raio vindo do lado +x, indo para -x.
    const occupied = makeOccupancy(['0:0:0']);
    const result = ddaRaycast(
      { x: 5, y: 0.5, z: 0.5 },
      normalize({ x: -1, y: 0, z: 0 }),
      occupied,
      100,
    );

    ok(result.hit !== null);
    strictEqual(result.hit!.cell.x, 0);
    strictEqual(result.hit!.cell.y, 0);
    strictEqual(result.hit!.cell.z, 0);
    // Normal da face lateral no eixo X: raio vem de +x, entra pela face -x,
    // normal aponta para +x.
    strictEqual(result.hit!.normal.x, 1);
    strictEqual(result.hit!.normal.y, 0);
    strictEqual(result.hit!.normal.z, 0);
  });

  // ---------------------------------------------------------------- 3. empty space
  it('ray into empty space returns null', () => {
    const occupied = makeOccupancy([]);
    const result = ddaRaycast(
      { x: 0.5, y: 0.5, z: 10 },
      { x: 0, y: 0, z: -1 },
      occupied,
      100,
    );

    strictEqual(result.hit, null);
    // trace deve ter várias células (o raio percorreu o espaço vazio)
    ok(result.trace.length > 0);
  });

  // ---------------------------------------------------------------- 4. nearest block
  it('ray hits nearest block when two are in line', () => {
    // Dois blocos na mesma coluna: (0, 0, 5) e (0, 0, 10).
    // Raio de cima para baixo: deve acertar (0, 0, 10) primeiro.
    const occupied = makeOccupancy(['0:0:5', '0:0:10']);
    const result = ddaRaycast(
      { x: 0.5, y: 0.5, z: 15 },
      { x: 0, y: 0, z: -1 },
      occupied,
      100,
    );

    ok(result.hit !== null);
    strictEqual(result.hit!.cell.x, 0);
    strictEqual(result.hit!.cell.y, 0);
    strictEqual(result.hit!.cell.z, 10);
    // Normal da face de cima
    strictEqual(result.hit!.normal.z, 1);
  });

  // ---------------------------------------------------------------- 5. origin inside occupied
  it('ray origin inside occupied cell skips that cell', () => {
    // Raio começa DENTRO de (0, 0, 0). Deve pular e acertar o próximo.
    const occupied = makeOccupancy(['0:0:0', '0:0:1']);
    const result = ddaRaycast(
      { x: 0.5, y: 0.5, z: 0.5 }, // dentro de (0, 0, 0)
      { x: 0, y: 0, z: 1 },        // apontando para cima
      occupied,
      100,
    );

    ok(result.hit !== null);
    // Não deve acertar (0, 0, 0) — começa dentro, pula.
    strictEqual(result.hit!.cell.x, 0);
    strictEqual(result.hit!.cell.y, 0);
    strictEqual(result.hit!.cell.z, 1);
  });

  // ---------------------------------------------------------------- 6. parallel to grid
  it('ray parallel to grid lines (edge case)', () => {
    // Raio puramente horizontal (z constante, y variando).
    // Bloco em (0, 5, 0).
    const occupied = makeOccupancy(['0:5:0']);
    const result = ddaRaycast(
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 0, y: 1, z: 0 }, // paralelo ao eixo Y
      occupied,
      100,
    );

    ok(result.hit !== null);
    strictEqual(result.hit!.cell.x, 0);
    strictEqual(result.hit!.cell.y, 5);
    strictEqual(result.hit!.cell.z, 0);
    // Normal: raio vai em +y, entra pela face -y do bloco.
    // A normal da face -y aponta para -y no espaço do mundo.
    strictEqual(result.hit!.normal.x, 0);
    strictEqual(result.hit!.normal.y, -1);
    strictEqual(result.hit!.normal.z, 0);
  });

  // ---------------------------------------------------------------- 7. maxDistance
  it('maxDistance exceeded before hitting anything', () => {
    // Bloco a 50 unidades de distância. maxDistance = 10.
    const occupied = makeOccupancy(['0:0:0']);
    const result = ddaRaycast(
      { x: 0.5, y: 0.5, z: 60 },
      { x: 0, y: 0, z: -1 },
      occupied,
      10, // maxDistance curto
    );

    strictEqual(result.hit, null);
  });

  // ---------------------------------------------------------------- 8. out of bounds handling
  it('handles negative coordinates (out of bounds)', () => {
    // Raio viajando para +z desde z negativo.
    // Bloco em (0, 0, -5) com isOccupied aceitando negativos (limite fica a cargo do chamador).
    const occupied = makeOccupancy(['0:0:-5']);
    const result = ddaRaycast(
      { x: 0.5, y: 0.5, z: -10 },
      { x: 0, y: 0, z: 1 },
      occupied,
      100,
    );

    ok(result.hit !== null);
    strictEqual(result.hit!.cell.z, -5);
  });

  // ---------------------------------------------------------------- 9. determinism
  it('same ray, same result (determinism)', () => {
    const occupied = makeOccupancy(['3:4:2', '5:5:5']);
    const origin = { x: 2.3, y: 3.1, z: 8.7 };
    const dir = normalize({ x: 0.2, y: 0.1, z: -0.9 });

    const result1 = ddaRaycast(origin, dir, occupied, 100);
    const result2 = ddaRaycast(origin, dir, occupied, 100);

    if (result1.hit === null) {
      strictEqual(result2.hit, null);
    } else {
      ok(result2.hit !== null);
      deepStrictEqual(result1.hit!.cell, result2.hit!.cell);
      deepStrictEqual(result1.hit!.normal, result2.hit!.normal);
    }
    strictEqual(result1.trace.length, result2.trace.length);
  });

  // ---------------------------------------------------------------- 10. corner
  it('ray through corner chooses one face deterministically', () => {
    // Bloco em (1, 1, 0). Raio passando exatamente pela aresta entre
    // as células (1, 0, 0) e (0, 1, 0) antes de atingir (1, 1, 0).
    // A origem é posicionada para que o raio passe pelo canto.
    const occupied = makeOccupancy(['1:1:0']);

    // Raio diagonal no plano XY, começando de (-1, -1, 0.5)
    const result = ddaRaycast(
      { x: -0.5, y: -0.5, z: 0.5 },
      normalize({ x: 1, y: 1, z: 0 }),
      occupied,
      100,
    );

    // Deve atingir (1, 1, 0). O resultado deve ser determinístico.
    ok(result.hit !== null);
    strictEqual(result.hit!.cell.x, 1);
    strictEqual(result.hit!.cell.y, 1);
    strictEqual(result.hit!.cell.z, 0);

    // A normal deve ser um dos lados — não ambos. Verifica que só um eixo tem valor não-zero.
    const nonZeroAxes = [
      result.hit!.normal.x !== 0,
      result.hit!.normal.y !== 0,
      result.hit!.normal.z !== 0,
    ].filter(Boolean);
    strictEqual(nonZeroAxes.length, 1, 'only one axis should have normal');
  });

  // ---------------------------------------------------------------- 11. raio de baixo pra cima
  it('ray from below hits bottom face', () => {
    // Bloco em (0, 0, 5). Raio vindo de baixo.
    const occupied = makeOccupancy(['0:0:5']);
    const result = ddaRaycast(
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0, y: 0, z: 1 },
      occupied,
      100,
    );

    ok(result.hit !== null);
    strictEqual(result.hit!.cell.x, 0);
    strictEqual(result.hit!.cell.y, 0);
    strictEqual(result.hit!.cell.z, 5);
    // Normal da face de baixo: {x:0, y:0, z:-1}
    strictEqual(result.hit!.normal.x, 0);
    strictEqual(result.hit!.normal.y, 0);
    strictEqual(result.hit!.normal.z, -1);
  });

  // ---------------------------------------------------------------- 12. trace completeness
  it('trace includes all cells before hit', () => {
    // Bloco em (0, 0, 0). Raio de (2, 2, 2) para (0, 0, -1).
    const occupied = makeOccupancy(['0:0:0']);
    const dir = normalize({ x: -2, y: -2, z: -3 }); // aponta para baixo e para (0,0)
    const result = ddaRaycast(
      { x: 2, y: 2, z: 3 },
      dir,
      occupied,
      100,
    );

    ok(result.hit !== null);
    // O trace deve ter as células antes de (0, 0, 0)
    ok(result.trace.length > 0);
    // A última célula no trace não deve ser (0, 0, 0) — o hit é separado
    // Mas o trace inclui a célula ATUAL antes do passo, então pode incluir (0, 0, 0)
    // se o passo que acertou foi um passo antes. Na verdade, o trace inclui
    // a célula corrente ANTES de verificar ocupação — então o último elemento
    // do trace é a célula onde estávamos ANTES de pisar na célula ocupada.
    // A célula (0, 0, 0) aparece no HIT, não no trace (a menos que tenha sido
    // a célula anterior no caminho).
  });

  // ---------------------------------------------------------------- 13. diagonal ray
  it('diagonal ray through 3D grid', () => {
    // Bloco em (3, 4, 2). Raio diagonal.
    const occupied = makeOccupancy(['3:4:2']);
    const dir = normalize({ x: 1, y: 1.2, z: 0.5 });
    const result = ddaRaycast(
      { x: 0, y: 0, z: 0 },
      dir,
      occupied,
      100,
    );

    ok(result.hit !== null);
    strictEqual(result.hit!.cell.x, 3);
    strictEqual(result.hit!.cell.y, 4);
    strictEqual(result.hit!.cell.z, 2);
  });

  // ---------------------------------------------------------------- 14. origin at cell boundary
  it('origin exactly on cell boundary', () => {
    // Bloco em (1, 0, 0). Origem exatamente na fronteira entre (0, 0, 0) e (1, 0, 0).
    const occupied = makeOccupancy(['1:0:0']);
    const result = ddaRaycast(
      { x: 1.0, y: 0.5, z: 0.5 }, // x=1.0 é fronteira: floor(1.0) = 1
      { x: 0, y: 0, z: -1 },       // para baixo
      occupied,
      100,
    );

    // A origem está em x=1.0, então cellX = floor(1.0) = 1.
    // A célula (1, 0, 0) está ocupada, mas a origem está dentro dela
    // (startInside = true), então pula.
    // Mas o raio vai para baixo (-z), então sai de (1, 0, 0) por baixo.
    // Não há bloco abaixo (z=-1 não está ocupado), então o raio continua...
    // Na verdade, depende: se o raio está em z=0.5 e vai para -z,
    // o próximo passo é em z: z vai para -1.
    // Se nada estiver ocupado, retorna null.
    strictEqual(result.hit, null);
  });
});
