/**
 * Testes da regra de estado da peça do guarda-roupa.
 *
 * O que está em jogo é dinheiro: um falso `canGenerate` deixa a UI oferecer
 * uma geração que o servidor cobraria e recusaria (silhueta errada) ou que
 * cobraria por nada (célula já pronta).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Cell, Character, WardrobeItem } from '../../../../server/model.ts';
import { itemStatus } from './item-state.ts';

// ------------------------------------------------------------------ fixtures

const character = (over: Partial<Character> = {}): Character => ({
  id: 'manequim',
  label: 'Manequim base',
  silhouette: 'humano-medio',
  description: '',
  size: 64,
  seed: 1,
  remoteId: 'char-123',
  createdAt: '2026-07-31T00:00:00.000Z',
  ...over,
});

const item = (over: Partial<WardrobeItem> = {}): WardrobeItem => ({
  id: 'cota-de-malha',
  label: 'Cota de malha enferrujada',
  slot: 'torso',
  silhouette: 'humano-medio',
  editDescription: 'wearing a rusted chainmail hauberk',
  keepPalette: true,
  seed: 42,
  createdAt: '2026-07-31T00:00:00.000Z',
  ...over,
});

const cell = (status: Cell['status']): Cell => ({ key: 'k', status });

/** Personagem sem base remota — remoteId omitido (exactOptionalPropertyTypes
 *  não deixa passar `remoteId: undefined` explícito). */
const characterWithoutBase = (): Character => {
  const { remoteId: _remoteId, ...rest } = character();
  return rest;
};

// ------------------------------------------------------------------ bloqueios

test('silhueta diferente bloqueia, mesmo com base remota e célula pronta', () => {
  const s = itemStatus(
    item({ silhouette: 'quadrupede' }),
    character(),
    cell('pronto'),
  );
  assert.equal(s.availability, 'mismatch');
  assert.equal(s.action, 'blocked');
  assert.equal(s.canGenerate, false);
});

test('sem remoteId bloqueia, mesmo com célula pronta', () => {
  const s = itemStatus(item(), characterWithoutBase(), cell('pronto'));
  assert.equal(s.availability, 'no-base');
  assert.equal(s.action, 'blocked');
  assert.equal(s.canGenerate, false);
});

test('silhueta errada vence a falta de base remota', () => {
  const s = itemStatus(
    item({ silhouette: 'humano-esguio' }),
    characterWithoutBase(),
    undefined,
  );
  assert.equal(s.availability, 'mismatch');
});

// ------------------------------------------------------------------ células

test('sem célula: idle e pode gerar', () => {
  const s = itemStatus(item(), character(), undefined);
  assert.deepEqual(s, { availability: 'fits', action: 'idle', canGenerate: true });
});

test('célula vazia: idle e pode gerar', () => {
  const s = itemStatus(item(), character(), cell('vazio'));
  assert.equal(s.action, 'idle');
  assert.equal(s.canGenerate, true);
});

test('célula na-fila: working', () => {
  const s = itemStatus(item(), character(), cell('na-fila'));
  assert.equal(s.action, 'working');
  assert.equal(s.canGenerate, false);
});

test('célula gerando: working', () => {
  const s = itemStatus(item(), character(), cell('gerando'));
  assert.equal(s.action, 'working');
  assert.equal(s.canGenerate, false);
});

test('célula pronta é terminal — idempotência, não gera de novo', () => {
  const s = itemStatus(item(), character(), cell('pronto'));
  assert.equal(s.action, 'done');
  assert.equal(s.canGenerate, false);
});

test('célula falhou: retry e pode gerar de novo', () => {
  const s = itemStatus(item(), character(), cell('falhou'));
  assert.equal(s.action, 'retry');
  assert.equal(s.canGenerate, true);
});
