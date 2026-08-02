/**
 * Teste do módulo de diagonal picking (F2-06).
 *
 * Verifica:
 *   1. pick devolve a primeira célula ocupada no raio (bloco no topo).
 *   2. pick devolve o piso quando não há bloco no raio.
 *   3. pick devolve null ("nenhuma") para clique fora dos limites.
 *   4. A propriedade da diagonal: screen→cell muda com ±(0.5, 0.5) por nível de z.
 *   5. Mapa com degraus: cada ponto de tela tem resposta esperada escrita à mão.
 *   6. Borda: clique fora devolve null.
 *   7. pickWithHighlight devolve a célula de piso adicional.
 *
 * Execute com: npx tsx src/picking.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pick, pickWithHighlight, DEFAULT_GEOMETRY } from './picking.ts';
import type { MapData } from '../../../../packages/iso-core/src/map.ts';

// ------------------------------------------------------------------ helpers

/** Mapa vazio: sem blocos. */
function emptyMap(): MapData {
  return { blocks: {}, edges: [] };
}

/** Mapa com um bloco em (0,0,0). */
function singleBlockMap(): MapData {
  return {
    blocks: {
      '0:0': [{ block: 'stone', count: 1 }],
    },
    edges: [],
  };
}

/**
 * Mapa com degraus (staircase):
 *
 *   z=2: bloco em (2,2)
 *   z=1: bloco em (1,1), bloco em (2,2)
 *   z=0: bloco em (0,0), bloco em (1,1), bloco em (2,2)
 */
function stairsMap(): MapData {
  return {
    blocks: {
      '0:0': [{ block: 'grass', count: 1 }],
      '1:1': [{ block: 'grass', count: 2 }],
      '2:2': [{ block: 'grass', count: 3 }],
    },
    edges: [],
  };
}

// ------------------------------------------------------------------ geometria

const GEOM = DEFAULT_GEOMETRY; // tileWidth=64, tileHeight=32, zStep=16

function worldToScreen(x: number, y: number, z: number): { sx: number; sy: number } {
  const halfW = GEOM.tileWidth / 2;
  const halfH = GEOM.tileHeight / 2;
  return {
    sx: (x - y) * halfW,
    sy: (x + y) * halfH - z * GEOM.zStep,
  };
}

// ------------------------------------------------------------------ diagonal

test('propriedade da diagonal: screen→cell avança na diagonal com z', (t) => {
  // Propriedade: screenToWorld(sx,sy,z+1) = screenToWorld(sx,sy,z) + (0.5, 0.5)
  // com a geometria padrão. Dois níveis de z = uma célula diagonal completa.
  const sx = 32;
  const sy = 48;

  // Calcula cell em z=0 e z=2 manualmente.
  function cellAt(z: number) {
    const hw = GEOM.tileWidth / 2;
    const hh = GEOM.tileHeight / 2;
    const a = sx / hw;
    const b = (sy + z * GEOM.zStep) / hh;
    return { x: Math.floor((b + a) / 2), y: Math.floor((b - a) / 2) };
  }

  const c0 = cellAt(0);
  const c2 = cellAt(2);
  const dx = c2.x - c0.x;
  const dy = c2.y - c0.y;

  // Dois níveis de z = um passo de (1.0, 1.0) no mundo = uma diagonal.
  assert.equal(dx, dy, 'dx deve igualar dy (diagonal)');
  assert.ok(dx === 1 || dx === 2, `dx=${dx} deve ser 1 ou 2`);
  // As células calculadas são informação, não enfeite: `t.diagnostic` passa pelo
  // canal do runner. `console.log` escreveria cru no stdout e corromperia o
  // protocolo serializado que o `node --test` usa entre pai e filho.
  t.diagnostic(`diagonal: cell(z=0)=(${c0.x},${c0.y}) cell(z=2)=(${c2.x},${c2.y}) dx=dy=${dx}`);
});

// ------------------------------------------------------------------ bloco único

test('pick atinge bloco único em (0,0,0)', () => {
  const map = singleBlockMap();
  const result = pick(0, 0, map, GEOM);
  assert.ok(result, 'deveria encontrar algo');
  assert.equal(result!.cell.x, 0);
  assert.equal(result!.cell.y, 0);
  assert.equal(result!.cell.z, 0);
  assert.equal(result!.blockType, 'stone');
  assert.equal(result!.isFloor, false);
});

// ------------------------------------------------------------------ piso

test('pick devolve piso quando coluna existe mas bloco está acima do piso', () => {
  // Coluna em (0,0): ar em z=0, bloco em z=1.
  // zMax=1 (bloco em z=1).
  // worldToScreen(0,0,0) = (0, 0).
  // z=1: screenToCell(0,0,1) → (0,0). Bloco='grass' → encontrado. isFloor=false.
  //
  // Para isFloor=true: coluna existe, mas nenhum z ao longo do raio tem bloco.
  // Isto acontece quando o bloco está em z=1 e o raio começa em z=0:
  // o pick NÃO encontra bloco porque zMax=1 começa em z=1 e desce.
  // Em z=1 encontra bloco → não é piso.
  //
  // Para o piso, precisamos que a coluna do piso exista mas o bloco
  // NÃO seja atingido pelo raio. Ex: coluna com ar em z=0, bloco em z=2,
  // e zMax=1 (de outra coluna). O raio desce de z=1 até 0 sem achar bloco.
  const map: MapData = {
    blocks: {
      // Coluna (0,0): ar em z=0, bloco em z=2 (invisível ao raio de zMax=1)
      '0:0': [{ block: '', count: 2 }, { block: 'grass', count: 1 }],
      // Coluna (1,0): bloco em z=1 → zMax=1
      '1:0': [{ block: 'stone', count: 1 }],
    },
    edges: [],
  };

  // worldToScreen(0,0,0) = (0, 0)
  // zMax=1 (da coluna 1:0).
  // z=1: screenToCell(0,0,1) → b=(0+16)/16=1, x=0.5, y=0.5 → cell=(0,0).
  //   getBlockAt(0,0,1): run 0 (ar, count=2) cobre z=0,1 → block='' → undefined.
  // z=0: screenToCell(0,0,0) → cell=(0,0).
  //   getBlockAt(0,0,0): run 0 cobre z=0 → block='' → undefined.
  // Floor: coluna (0,0) existe → isFloor=true!
  const pt = worldToScreen(0, 0, 0);
  const result = pick(pt.sx, pt.sy, map, GEOM);
  assert.ok(result, 'deveria encontrar o piso');
  assert.equal(result!.isFloor, true, 'deveria ser piso');
  assert.equal(result!.cell.x, 0);
  assert.equal(result!.cell.y, 0);
  assert.equal(result!.cell.z, 0);
  assert.equal(result!.blockType, 'piso');
});

// ------------------------------------------------------------------ ausência

test('pick devolve null para clique fora dos limites do mapa', () => {
  // Mapa vazio: qualquer ponto → null
  const map = emptyMap();
  assert.equal(pick(100, 100, map, GEOM), null);

  // Mapa com bloco: ponto longe → null
  const map2 = singleBlockMap();
  assert.equal(pick(1000, 1000, map2, GEOM), null);
});

// ------------------------------------------------------------------ degraus

test('mapa com degraus — cada ponto de tela tem resposta esperada', () => {
  const map = stairsMap();

  // Degrau em (0,0,0): worldToScreen(0,0,0) = (0, 0)
  const r0 = pick(0, 0, map, GEOM);
  assert.ok(r0);
  assert.deepEqual(
    { x: r0!.cell.x, y: r0!.cell.y, z: r0!.cell.z },
    { x: 0, y: 0, z: 0 },
    '(0,0) ecrã → (0,0,0)',
  );

  // Degrau em (1,1,1): worldToScreen(1,1,1) = (0, 16)
  const pt1 = worldToScreen(1, 1, 1);
  const r1 = pick(pt1.sx, pt1.sy, map, GEOM);
  assert.ok(r1);
  assert.deepEqual(
    { x: r1!.cell.x, y: r1!.cell.y, z: r1!.cell.z },
    { x: 1, y: 1, z: 1 },
    'worldToScreen(1,1,1) → (1,1,1)',
  );

  // Degrau em (2,2,2): worldToScreen(2,2,2) = (0, 32)
  const pt2 = worldToScreen(2, 2, 2);
  const r2 = pick(pt2.sx, pt2.sy, map, GEOM);
  assert.ok(r2);
  assert.deepEqual(
    { x: r2!.cell.x, y: r2!.cell.y, z: r2!.cell.z },
    { x: 2, y: 2, z: 2 },
    'worldToScreen(2,2,2) → (2,2,2)',
  );

  // worldToScreen(1,1,0) = (0, 32) — MESMO que worldToScreen(2,2,2).
  // O pick deve ver o topo em z=2 (da coluna 2:2), não o piso em (1,1,0).
  const ptFloor = worldToScreen(1, 1, 0);
  const rFloor = pick(ptFloor.sx, ptFloor.sy, map, GEOM);
  assert.ok(rFloor);
  // O ponto (0,32) em z=2 cai em (2,2) que tem bloco em z=2.
  assert.equal(rFloor!.cell.z, 2, '(0,32) no ecrã deve ver z=2, não z=0');

  // Ponto fora do mapa: (3,3,0) → sem coluna → null
  const pt3 = worldToScreen(3, 3, 0);
  assert.equal(pick(pt3.sx, pt3.sy, map, GEOM), null, '(3,3) sem coluna → null');
});

// ------------------------------------------------------------------ borda

test('borda — clique no limite do mapa devolve célula ou null', () => {
  const map = singleBlockMap();

  // Centro do losango em (0,0) → deve encontrar o bloco.
  const r = pick(0, 0, map, GEOM);
  assert.ok(r);

  // Ponto fora → null
  assert.equal(pick(1000, 1000, map, GEOM), null);
});

// ------------------------------------------------------------------ highlight

test('pickWithHighlight devolve floorCell adicional', () => {
  const map = stairsMap();

  const pt2 = worldToScreen(2, 2, 2);
  const result = pickWithHighlight(pt2.sx, pt2.sy, map, GEOM);

  assert.ok(result);
  assert.equal(result!.cell.z, 2, 'seleccionada em z=2');
  assert.equal(result!.floorCell.z, 0, 'piso em z=0');
  assert.equal(typeof result!.floorCell.x, 'number');
  assert.equal(typeof result!.floorCell.y, 'number');
});

// ------------------------------------------------------------------ coluna alta

test('coluna alta — pick vê o topo, não o meio', () => {
  const map: MapData = {
    blocks: {
      '0:0': [{ block: 'stone', count: 5 }],
    },
    edges: [],
  };

  // worldToScreen(0,0,4) = (0, -64)
  const ptTop = worldToScreen(0, 0, 4);
  const result = pick(ptTop.sx, ptTop.sy, map, GEOM);

  assert.ok(result);
  assert.equal(result!.cell.z, 4, 'deveria ver o topo em z=4');
  assert.equal(result!.blockType, 'stone');
});
