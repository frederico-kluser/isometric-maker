/**
 * Testes da regra de disparo em lote e do contador de progresso das poses.
 *
 * O risco coberto é dinheiro: incluir uma célula pronta no lote cobraria de
 * novo por nada; esquecer uma célula falha deixaria a grade buracada sem
 * aviso; e um contador que acumula lotes mortos mentiria no "de Y".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellKey, type Cell, type Pose } from '../../../../server/model.ts';
import {
  countGenerating,
  isPoseCellPending,
  mergeBatch,
  pendingPoses,
} from './generation-batch.ts';

// ------------------------------------------------------------------ fixtures

const pose = (id: string): Pose => ({
  id,
  label: id,
  kind: 'template',
  templateId: 'attack',
  frameCount: 8,
  fps: 12,
});

const cell = (status: Cell['status']): Cell => ({ key: 'k', status });

// ------------------------------------------------------------ célula pendente

test('célula ausente, vazia ou falha está pendente', () => {
  assert.equal(isPoseCellPending(undefined), true);
  assert.equal(isPoseCellPending(cell('vazio')), true);
  assert.equal(isPoseCellPending(cell('falhou')), true);
});

test('célula na-fila, gerando ou pronta NÃO está pendente', () => {
  assert.equal(isPoseCellPending(cell('na-fila')), false);
  assert.equal(isPoseCellPending(cell('gerando')), false);
  assert.equal(isPoseCellPending(cell('pronto')), false);
});

// ------------------------------------------------------------- poses pendentes

test('pendingPoses devolve só as poses vazias ou falhas do personagem', () => {
  const poses = [pose('parado'), pose('correndo'), pose('pulando'), pose('atacando')];
  const cells: Record<string, Cell> = {
    [cellKey('manequim', 'parado')]: cell('pronto'),
    [cellKey('manequim', 'correndo')]: cell('falhou'),
    [cellKey('manequim', 'pulando')]: cell('gerando'),
    // atacando sem célula — vazia
  };
  const pending = pendingPoses('manequim', poses, cells);
  assert.deepEqual(
    pending.map((p) => p.id),
    ['correndo', 'atacando'],
  );
});

test('pendingPoses não mistura células de outro personagem', () => {
  const poses = [pose('parado')];
  const cells: Record<string, Cell> = {
    [cellKey('outro', 'parado')]: cell('pronto'),
  };
  assert.equal(pendingPoses('manequim', poses, cells).length, 1);
  assert.equal(pendingPoses('outro', poses, cells).length, 0);
});

// ------------------------------------------------------------------- contador

test('countGenerating conta só jobs gerando entre as chaves dadas', () => {
  const jobs = {
    a: { status: 'gerando' },
    b: { status: 'pronto' },
    c: { status: 'falhou' },
    d: { status: 'gerando' },
    fora: { status: 'gerando' },
  };
  assert.equal(countGenerating(['a', 'b', 'c', 'd'], jobs), 2);
  assert.equal(countGenerating([], jobs), 0);
  assert.equal(countGenerating(['inexistente'], jobs), 0);
});

// -------------------------------------------------------------------- mergeBatch

test('mergeBatch sem lote anterior inicia um lote novo', () => {
  const batch = mergeBatch(null, 'manequim', ['a', 'b'], {});
  assert.deepEqual(batch, { characterId: 'manequim', keys: ['a', 'b'] });
});

test('mergeBatch de outro personagem substitui, nunca mistura', () => {
  const prev = { characterId: 'outro', keys: ['x'] };
  const jobs = { x: { status: 'gerando' } };
  const batch = mergeBatch(prev, 'manequim', ['a'], jobs);
  assert.deepEqual(batch, { characterId: 'manequim', keys: ['a'] });
});

test('mergeBatch com lote assentado substitui — o denominador não carrega defuntos', () => {
  const prev = { characterId: 'manequim', keys: ['a', 'b'] };
  const jobs = {
    a: { status: 'pronto' },
    b: { status: 'falhou' },
  };
  const batch = mergeBatch(prev, 'manequim', ['c'], jobs);
  assert.deepEqual(batch, { characterId: 'manequim', keys: ['c'] });
});

test('mergeBatch com lote ainda rodando acumula sem duplicar chave', () => {
  const prev = { characterId: 'manequim', keys: ['a', 'b'] };
  const jobs = {
    a: { status: 'gerando' },
    b: { status: 'pronto' },
  };
  const batch = mergeBatch(prev, 'manequim', ['b', 'c'], jobs);
  assert.deepEqual(batch, { characterId: 'manequim', keys: ['a', 'b', 'c'] });
});
