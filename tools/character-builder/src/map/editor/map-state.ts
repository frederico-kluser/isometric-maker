/**
 * Estado editável do mapa — módulo PURO.
 *
 * Sem React, sem PixiJS, sem DOM: toda mutação é `MapData → MapData`, o que
 * torna desfazer/refazer um empilhamento de snapshots em vez de um sistema de
 * comandos inversos. Num editor local de usuário único, um mapa cabe folgado
 * na memória, e a simplicidade vale mais que a economia.
 *
 * O formato armazenado continua sendo o do `iso-core`: colunas RLE sem buracos
 * no topo. A rotação da câmera NÃO aparece em lugar nenhum daqui — o documento
 * não sabe de que ângulo está sendo olhado.
 */
import type { BlockRleRun, MapData } from '../../../../../packages/iso-core/src/map.ts';
import type { Cell3D } from '../3d/block-def.ts';

// ------------------------------------------------------------------ coluna densa

/** RLE → array denso indexado por z. */
export function toDense(runs: readonly BlockRleRun[] | undefined): string[] {
  const out: string[] = [];
  if (!runs) return out;
  for (const run of runs) {
    for (let i = 0; i < run.count; i += 1) out.push(run.block);
  }
  return out;
}

/** Array denso → RLE, já sem ar no topo (o invariante do formato). */
export function toRuns(dense: readonly string[]): BlockRleRun[] {
  let end = dense.length;
  while (end > 0 && dense[end - 1] === '') end -= 1;
  if (end === 0) return [];

  const runs: BlockRleRun[] = [];
  let current = dense[0]!;
  let count = 1;
  for (let i = 1; i < end; i += 1) {
    const b = dense[i]!;
    if (b === current) {
      count += 1;
    } else {
      runs.push({ block: current, count });
      current = b;
      count = 1;
    }
  }
  runs.push({ block: current, count });
  return runs;
}

// ------------------------------------------------------------------ mutações

const columnKey = (x: number, y: number): string => `${x}:${y}`;

/**
 * Coloca `blockId` em (x,y,z).
 *
 * Níveis intermediários viram ar explícito — é o que permite uma ponte com vão
 * embaixo. `z` negativo é recusado devolvendo o mapa intacto: o formato começa
 * em zero, e rejeitar em silêncio é melhor que criar uma coluna impossível.
 */
export function placeBlock(map: MapData, cell: Cell3D, blockId: string): MapData {
  if (cell.z < 0 || !Number.isInteger(cell.z)) return map;
  const key = columnKey(cell.x, cell.y);
  const dense = toDense(map.blocks[key]);
  while (dense.length <= cell.z) dense.push('');
  if (dense[cell.z] === blockId) return map;
  dense[cell.z] = blockId;

  const runs = toRuns(dense);
  const blocks = { ...map.blocks };
  if (runs.length === 0) delete blocks[key];
  else blocks[key] = runs;
  return { ...map, blocks };
}

/** Remove o bloco em (x,y,z). Coluna que fica só de ar desaparece. */
export function removeBlock(map: MapData, cell: Cell3D): MapData {
  const key = columnKey(cell.x, cell.y);
  const existing = map.blocks[key];
  if (!existing) return map;
  const dense = toDense(existing);
  if (cell.z < 0 || cell.z >= dense.length || dense[cell.z] === '') return map;
  dense[cell.z] = '';

  const runs = toRuns(dense);
  const blocks = { ...map.blocks };
  if (runs.length === 0) delete blocks[key];
  else blocks[key] = runs;
  return { ...map, blocks };
}

/** Empilha uma peça no topo da coluna (x,y). */
export function stackBlock(map: MapData, x: number, y: number, blockId: string): MapData {
  const dense = toDense(map.blocks[columnKey(x, y)]);
  return placeBlock(map, { x, y, z: dense.length }, blockId);
}

/** Troca o tipo de uma célula JÁ ocupada; célula vazia fica como está. */
export function paintBlock(map: MapData, cell: Cell3D, blockId: string): MapData {
  const dense = toDense(map.blocks[columnKey(cell.x, cell.y)]);
  if (cell.z < 0 || cell.z >= dense.length || dense[cell.z] === '') return map;
  return placeBlock(map, cell, blockId);
}

/** Quantas células ocupadas existem. */
export function countBlocks(map: MapData): number {
  let n = 0;
  for (const runs of Object.values(map.blocks)) {
    for (const run of runs) if (run.block !== '') n += run.count;
  }
  return n;
}

/**
 * Altura da coluna (primeiro z livre acima do topo).
 *
 * Veio de `pick3d.ts` (onda 2) — o editor 3D usa para assentar no topo da
 * coluna sem depender da aritmética diagonal do picking antigo.
 */
export function columnHeight(map: MapData, x: number, y: number): number {
  const runs = map.blocks[`${x}:${y}`];
  if (!runs) return 0;
  let total = 0;
  let lastFilled = 0;
  for (const run of runs) {
    total += run.count;
    if (run.block !== '') lastFilled = total;
  }
  return lastFilled;
}

/** Todas as células ocupadas — usado para enquadrar a câmera. */
export function occupiedCells(map: MapData): Cell3D[] {
  const out: Cell3D[] = [];
  for (const [key, runs] of Object.entries(map.blocks)) {
    const [xs, ys] = key.split(':');
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    let z = 0;
    for (const run of runs) {
      if (run.block !== '') {
        for (let i = 0; i < run.count; i += 1) out.push({ x, y, z: z + i });
      }
      z += run.count;
    }
  }
  return out;
}

// ------------------------------------------------------------------ histórico

export interface History {
  readonly past: readonly MapData[];
  readonly present: MapData;
  readonly future: readonly MapData[];
}

/** Teto do histórico. Além disso é memória gasta com o que ninguém desfaz. */
const HISTORY_LIMIT = 100;

export function initHistory(present: MapData): History {
  return { past: [], present, future: [] };
}

/**
 * Empurra um novo presente. Mapa idêntico NÃO cria entrada — arrastar o mouse
 * sobre a mesma célula geraria dezenas de passos vazios, e desfazer viraria
 * inútil.
 */
export function pushHistory(history: History, next: MapData): History {
  if (next === history.present) return history;
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
  };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
  };
}

export const canUndo = (h: History): boolean => h.past.length > 0;
export const canRedo = (h: History): boolean => h.future.length > 0;

// ------------------------------------------------------------------ mapa inicial

/**
 * Plataforma inicial: um tabuleiro `side × side` de uma peça de altura.
 *
 * Um editor que abre vazio não tem onde clicar, e "clique no nada até
 * descobrir onde é o chão" não é começo de nada.
 */
export function starterMap(blockId: string, side = 8): MapData {
  const blocks: Record<string, BlockRleRun[]> = {};
  for (let x = 0; x < side; x += 1) {
    for (let y = 0; y < side; y += 1) {
      blocks[`${x}:${y}`] = [{ block: blockId, count: 1 }];
    }
  }
  return { blocks, edges: [] };
}
