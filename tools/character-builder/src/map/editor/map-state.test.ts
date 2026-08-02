/**
 * Teste do estado editável do mapa.
 *
 * O que se prova aqui é o invariante do formato: coluna RLE sem ar no topo, ar
 * explícito no meio quando há vão, e coluna que esvazia sai do objeto em vez de
 * virar `[]`. Um mapa que viola isso ainda "funciona" na tela e quebra no
 * export — o pior tipo de bug.
 *
 * Execute com: node --test src/editor/map-state.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MapData } from '../../../../../packages/iso-core/src/map.ts';
import {
  canRedo,
  canUndo,
  countBlocks,
  initHistory,
  occupiedCells,
  paintBlock,
  placeBlock,
  pushHistory,
  redo,
  removeBlock,
  stackBlock,
  starterMap,
  toDense,
  toRuns,
  undo,
} from './map-state.ts';

const EMPTY: MapData = { blocks: {}, edges: [] };

// ------------------------------------------------------------------ RLE

test('toRuns corta o ar do topo mas preserva o vão do meio', () => {
  assert.deepEqual(toRuns(['a', 'a', '', 'b', '', '']), [
    { block: 'a', count: 2 },
    { block: '', count: 1 },
    { block: 'b', count: 1 },
  ]);
  assert.deepEqual(toRuns(['', '', '']), [], 'coluna só de ar não é coluna');
  assert.deepEqual(toRuns([]), []);
});

test('toDense e toRuns fecham o ciclo em colunas sem ar no topo', () => {
  const runs = [
    { block: 'a', count: 2 },
    { block: '', count: 1 },
    { block: 'b', count: 3 },
  ];
  assert.deepEqual(toRuns(toDense(runs)), runs);
});

// ------------------------------------------------------------------ colocar

test('placeBlock cria a coluna e escreve na altura pedida', () => {
  const m = placeBlock(EMPTY, { x: 2, y: 3, z: 0 }, 'grass');
  assert.deepEqual(m.blocks['2:3'], [{ block: 'grass', count: 1 }]);
  assert.equal(countBlocks(m), 1);
});

test('placeBlock acima do topo preenche o meio com ar EXPLÍCITO (ponte com vão)', () => {
  const m = placeBlock(EMPTY, { x: 0, y: 0, z: 3 }, 'stone');
  assert.deepEqual(m.blocks['0:0'], [
    { block: '', count: 3 },
    { block: 'stone', count: 1 },
  ]);
});

test('placeBlock com z negativo ou fracionário devolve o mapa intacto', () => {
  assert.equal(placeBlock(EMPTY, { x: 0, y: 0, z: -1 }, 'a'), EMPTY);
  assert.equal(placeBlock(EMPTY, { x: 0, y: 0, z: 1.5 }, 'a'), EMPTY);
});

test('placeBlock idempotente: repor o MESMO bloco devolve a mesma referência', () => {
  // Identidade referencial é o que faz pushHistory não criar passo vazio ao
  // arrastar o mouse sobre a célula que já está pintada.
  const m = placeBlock(EMPTY, { x: 0, y: 0, z: 0 }, 'grass');
  assert.equal(placeBlock(m, { x: 0, y: 0, z: 0 }, 'grass'), m);
});

test('placeBlock não muta o mapa anterior', () => {
  const before = placeBlock(EMPTY, { x: 0, y: 0, z: 0 }, 'grass');
  const snapshot = JSON.stringify(before);
  placeBlock(before, { x: 0, y: 0, z: 1 }, 'stone');
  assert.equal(JSON.stringify(before), snapshot, 'desfazer depende de snapshots imutáveis');
});

// ------------------------------------------------------------------ remover

test('removeBlock esvazia a célula e a coluna some quando não sobra nada', () => {
  const m = placeBlock(EMPTY, { x: 1, y: 1, z: 0 }, 'grass');
  const gone = removeBlock(m, { x: 1, y: 1, z: 0 });
  assert.equal(gone.blocks['1:1'], undefined, 'coluna vazia sai do objeto, não vira []');
  assert.equal(countBlocks(gone), 0);
});

test('removeBlock no meio da torre deixa vão e corta o ar do topo', () => {
  let m = EMPTY;
  for (let z = 0; z < 3; z += 1) m = placeBlock(m, { x: 0, y: 0, z }, 'stone');

  const meio = removeBlock(m, { x: 0, y: 0, z: 1 });
  assert.deepEqual(meio.blocks['0:0'], [
    { block: 'stone', count: 1 },
    { block: '', count: 1 },
    { block: 'stone', count: 1 },
  ]);

  const topo = removeBlock(m, { x: 0, y: 0, z: 2 });
  assert.deepEqual(topo.blocks['0:0'], [{ block: 'stone', count: 2 }], 'sem ar sobrando no topo');
});

test('removeBlock em célula vazia ou coluna inexistente é no-op', () => {
  const m = placeBlock(EMPTY, { x: 0, y: 0, z: 0 }, 'grass');
  assert.equal(removeBlock(m, { x: 5, y: 5, z: 0 }), m);
  assert.equal(removeBlock(m, { x: 0, y: 0, z: 4 }), m);
  assert.equal(removeBlock(m, { x: 0, y: 0, z: -1 }), m);
});

// ------------------------------------------------------------------ empilhar e pintar

test('stackBlock sobe um nível a cada chamada', () => {
  let m = EMPTY;
  m = stackBlock(m, 0, 0, 'a');
  m = stackBlock(m, 0, 0, 'b');
  m = stackBlock(m, 0, 0, 'c');
  assert.deepEqual(m.blocks['0:0'], [
    { block: 'a', count: 1 },
    { block: 'b', count: 1 },
    { block: 'c', count: 1 },
  ]);
});

test('paintBlock só troca célula JÁ ocupada — nunca cria', () => {
  const m = placeBlock(EMPTY, { x: 0, y: 0, z: 0 }, 'grass');
  assert.deepEqual(paintBlock(m, { x: 0, y: 0, z: 0 }, 'stone').blocks['0:0'], [
    { block: 'stone', count: 1 },
  ]);
  assert.equal(paintBlock(m, { x: 0, y: 0, z: 5 }, 'stone'), m, 'pintar o ar não inventa bloco');
  assert.equal(paintBlock(m, { x: 9, y: 9, z: 0 }, 'stone'), m);
});

// ------------------------------------------------------------------ inspeção

test('occupiedCells lista só o que existe e ignora o ar', () => {
  let m = placeBlock(EMPTY, { x: 0, y: 0, z: 0 }, 'a');
  m = placeBlock(m, { x: 0, y: 0, z: 2 }, 'b');
  const cells = occupiedCells(m).sort((p, q) => p.z - q.z);
  assert.deepEqual(cells, [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 2 },
  ]);
});

test('starterMap monta a plataforma inicial completa', () => {
  const m = starterMap('grass', 4);
  assert.equal(countBlocks(m), 16);
  assert.equal(Object.keys(m.blocks).length, 16);
  assert.deepEqual(m.blocks['3:3'], [{ block: 'grass', count: 1 }]);
});

// ------------------------------------------------------------------ histórico

test('desfazer e refazer percorrem os snapshots nos dois sentidos', () => {
  let h = initHistory(EMPTY);
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);

  h = pushHistory(h, placeBlock(h.present, { x: 0, y: 0, z: 0 }, 'a'));
  h = pushHistory(h, placeBlock(h.present, { x: 1, y: 0, z: 0 }, 'b'));
  assert.equal(countBlocks(h.present), 2);

  h = undo(h);
  assert.equal(countBlocks(h.present), 1);
  assert.equal(canRedo(h), true);

  h = undo(h);
  assert.equal(countBlocks(h.present), 0);
  assert.equal(canUndo(h), false);

  h = redo(h);
  h = redo(h);
  assert.equal(countBlocks(h.present), 2);
  assert.equal(canRedo(h), false);
});

test('pushHistory ignora presente idêntico — arrastar o mouse não enche o histórico', () => {
  let h = initHistory(EMPTY);
  h = pushHistory(h, placeBlock(h.present, { x: 0, y: 0, z: 0 }, 'a'));
  const depoisDoPrimeiro = h;
  for (let i = 0; i < 20; i += 1) {
    h = pushHistory(h, placeBlock(h.present, { x: 0, y: 0, z: 0 }, 'a'));
  }
  assert.equal(h, depoisDoPrimeiro, 'vinte no-ops não podem virar vinte passos de desfazer');
});

test('uma edição nova descarta o futuro', () => {
  let h = initHistory(EMPTY);
  h = pushHistory(h, placeBlock(h.present, { x: 0, y: 0, z: 0 }, 'a'));
  h = undo(h);
  assert.equal(canRedo(h), true);
  h = pushHistory(h, placeBlock(h.present, { x: 5, y: 5, z: 0 }, 'z'));
  assert.equal(canRedo(h), false, 'editar depois de desfazer fecha o ramo antigo');
});

test('undo e redo em histórico no limite são no-op', () => {
  const h = initHistory(EMPTY);
  assert.equal(undo(h), h);
  assert.equal(redo(h), h);
});
