/**
 * Teste das instâncias de bloco e da exportação v2.
 *
 * O que estes testes travam: cada bloco colocado sai com id, posição, tipo e
 * material — o registro autocontido que a física consome —, a ordem é
 * determinística (senão todo salvamento sujaria o diff), e a caixa de colisão
 * está em coordenadas de CÉLULA, não de tela.
 *
 * Execute com: node --test src/map-instances.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_CUBE } from './iso-cube.ts';
import { DEFAULT_CATALOG, MATERIALS, makeCatalog } from './block-catalog.ts';
import type { MapData } from './map.ts';
import {
  aabbOf,
  aabbOverlaps,
  blocksMovement,
  buildExport,
  enumerateBlocks,
  indexBlocks,
  instanceId,
  parseInstanceId,
} from './map-instances.ts';

const GEOM = {
  tileWidth: CANONICAL_CUBE.tileWidth,
  tileHeight: CANONICAL_CUBE.tileHeight,
  cubeHeight: CANONICAL_CUBE.cubeHeight,
};

/** Duas colunas, um vão de ar no meio de uma delas. */
const MAPA: MapData = {
  blocks: {
    '0:0': [
      { block: 'grama', count: 1 },
      { block: 'terra', count: 2 },
    ],
    '1:0': [
      { block: 'pedra', count: 1 },
      { block: '', count: 1 },
      { block: 'madeira', count: 1 },
    ],
    '0:1': [{ block: 'agua', count: 1 }],
  },
  edges: [{ x: 0, y: 0, z: 0, lado: 'N', tipo: 'stone_wall' }],
};

// ------------------------------------------------------------------ id

test('o id sai da posição e volta dela', () => {
  assert.equal(instanceId(3, -2, 7), 'b:3:-2:7');
  assert.deepEqual(parseInstanceId('b:3:-2:7'), { x: 3, y: -2, z: 7 });
  assert.equal(parseInstanceId('b:1:2'), null);
  assert.equal(parseInstanceId('x:1:2:3'), null);
  assert.equal(parseInstanceId('b:a:2:3'), null);
});

// ------------------------------------------------------------------ enumeração

test('cada célula ocupada vira uma instância com tipo e material resolvidos', () => {
  const blocos = enumerateBlocks(MAPA, DEFAULT_CATALOG);
  assert.equal(blocos.length, 6, '3 na coluna 0:0, 2 na 1:0, 1 na 0:1 — o ar não conta');

  const grama = blocos.find((b) => b.id === 'b:0:0:0')!;
  assert.deepEqual(grama, {
    id: 'b:0:0:0',
    blockId: 'grama',
    kind: 'solid',
    material: 'grama',
    x: 0,
    y: 0,
    z: 0,
  });

  const agua = blocos.find((b) => b.id === 'b:0:1:0')!;
  assert.equal(agua.kind, 'liquid');
  assert.equal(agua.material, 'agua');
});

test('o ar não vira instância, e o bloco acima do vão mantém o z certo', () => {
  const blocos = enumerateBlocks(MAPA, DEFAULT_CATALOG);
  assert.equal(blocos.some((b) => b.x === 1 && b.y === 0 && b.z === 1), false, 'o vão está vazio');
  const madeira = blocos.find((b) => b.blockId === 'madeira')!;
  assert.equal(madeira.z, 2, 'a ponte fica em z=2, não em z=1');
});

test('a ordem é determinística — x, depois y, depois z', () => {
  const a = enumerateBlocks(MAPA, DEFAULT_CATALOG).map((b) => b.id);
  const embaralhado: MapData = {
    blocks: Object.fromEntries(Object.entries(MAPA.blocks).reverse()),
    edges: MAPA.edges,
  };
  const b = enumerateBlocks(embaralhado, DEFAULT_CATALOG).map((x) => x.id);
  assert.deepEqual(a, b, 'a ordem das chaves do objeto não pode vazar para a saída');
  assert.deepEqual(a, ['b:0:0:0', 'b:0:0:1', 'b:0:0:2', 'b:0:1:0', 'b:1:0:0', 'b:1:0:2']
    .filter((id) => a.includes(id)));
});

test('peça fora do catálogo vira definição de reserva, sem quebrar o mapa', () => {
  const mapa: MapData = { blocks: { '0:0': [{ block: 'peca-apagada', count: 1 }] }, edges: [] };
  const [bloco] = enumerateBlocks(mapa, DEFAULT_CATALOG);
  assert.equal(bloco!.blockId, 'peca-apagada');
  assert.equal(bloco!.kind, 'solid');
  assert.equal(bloco!.material, 'pedra');
});

test('o índice acha a instância pelo id', () => {
  const index = indexBlocks(enumerateBlocks(MAPA, DEFAULT_CATALOG));
  assert.equal(index.get('b:0:0:1')!.blockId, 'terra');
  assert.equal(index.get('b:9:9:9'), undefined);
});

// ------------------------------------------------------------------ física

test('a caixa é de uma célula, no espaço do grid, meio-aberta em cima', () => {
  const [bloco] = enumerateBlocks(MAPA, DEFAULT_CATALOG);
  assert.deepEqual(aabbOf(bloco!), {
    minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1,
  });
});

test('blocos vizinhos se encostam sem colidir; o mesmo lugar colide', () => {
  const blocos = enumerateBlocks(MAPA, DEFAULT_CATALOG);
  const base = aabbOf(blocos.find((b) => b.id === 'b:0:0:0')!);
  const acima = aabbOf(blocos.find((b) => b.id === 'b:0:0:1')!);
  const aoLado = aabbOf(blocos.find((b) => b.id === 'b:1:0:0')!);
  assert.equal(aabbOverlaps(base, acima), false, 'empilhado encosta, não colide');
  assert.equal(aabbOverlaps(base, aoLado), false, 'vizinho encosta, não colide');
  assert.equal(aabbOverlaps(base, base), true, 'consigo mesmo colide');
});

test('sólido barra, líquido não', () => {
  const blocos = enumerateBlocks(MAPA, DEFAULT_CATALOG);
  assert.equal(blocksMovement(blocos.find((b) => b.blockId === 'grama')!), true);
  assert.equal(blocksMovement(blocos.find((b) => b.blockId === 'agua')!), false);
});

test('a tabela de materiais é congelada e cobre todos os ids', () => {
  assert.ok(Object.isFrozen(MATERIALS));
  assert.equal(MATERIALS.lava.movementCost, Infinity);
  assert.equal(MATERIALS.lava.harmful, true);
  assert.ok(MATERIALS.gelo.friction < MATERIALS.pedra.friction, 'gelo escorrega mais que pedra');
});

// ------------------------------------------------------------------ exportação

test('a exportação traz paleta, materiais usados, instâncias e contagens', () => {
  const e = buildExport(MAPA, DEFAULT_CATALOG, GEOM);
  assert.equal(e.schemaVersion, 2);
  assert.deepEqual(e.geometry, { tileWidth: 48, tileHeight: 24, cubeHeight: 29 });
  assert.deepEqual(e.palette.map((p) => p.id), ['agua', 'grama', 'madeira', 'pedra', 'terra']);
  assert.deepEqual(Object.keys(e.materials).sort(), ['agua', 'grama', 'madeira', 'pedra', 'terra']);
  assert.equal(e.blocks.length, 6);
  assert.deepEqual(e.stats, { blockCount: 6, columnCount: 3, maxZ: 2 });
  assert.deepEqual(e.edges, MAPA.edges);
});

test('a paleta exportada só tem o que o mapa usa', () => {
  const catalogo = makeCatalog([
    { id: 'grama', label: 'Grama', kind: 'solid', material: 'grama' },
    { id: 'nunca-usado', label: 'Nunca', kind: 'solid', material: 'metal' },
  ]);
  const mapa: MapData = { blocks: { '0:0': [{ block: 'grama', count: 1 }] }, edges: [] };
  const e = buildExport(mapa, catalogo, GEOM);
  assert.deepEqual(e.palette.map((p) => p.id), ['grama']);
  assert.deepEqual(Object.keys(e.materials), ['grama']);
});

test('mapa vazio exporta vazio, sem explodir nas contagens', () => {
  const e = buildExport({ blocks: {}, edges: [] }, DEFAULT_CATALOG, GEOM);
  assert.deepEqual(e.blocks, []);
  assert.deepEqual(e.stats, { blockCount: 0, columnCount: 0, maxZ: 0 });
});

test('a exportação é estável — duas chamadas dão o mesmo JSON', () => {
  const a = JSON.stringify(buildExport(MAPA, DEFAULT_CATALOG, GEOM));
  const b = JSON.stringify(buildExport(MAPA, DEFAULT_CATALOG, GEOM));
  assert.equal(a, b);
});
