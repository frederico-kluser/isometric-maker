/**
 * Testes da regra de disparo em lote do guarda-roupa.
 *
 * O risco coberto é dinheiro: uma peça de silhueta incompatível no lote
 * seria recusada pelo servidor DEPOIS de cobrar; uma peça já pronta cobraria
 * por nada. A hierarquia de bloqueio em si (silhueta > base > célula) é
 * testada em item-state.test.ts — aqui vale o filtro do lote e o contador.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wardrobeKey,
  type Cell,
  type Character,
  type WardrobeItem,
} from '../../../../server/model.ts';
import {
  countBusy,
  fittingWardrobeItems,
  mergeBatch,
  pendingWardrobeItems,
} from './generation-batch.ts';

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

/** Personagem sem base remota (exactOptionalPropertyTypes não deixa passar
 *  `remoteId: undefined` explícito). */
const characterWithoutBase = (): Character => {
  const { remoteId: _remoteId, ...rest } = character();
  return rest;
};

const item = (id: string, over: Partial<WardrobeItem> = {}): WardrobeItem => ({
  id,
  label: id,
  slot: 'torso',
  silhouette: 'humano-medio',
  editDescription: 'wearing a rusted chainmail hauberk',
  keepPalette: true,
  seed: 42,
  createdAt: '2026-07-31T00:00:00.000Z',
  ...over,
});

const cell = (status: Cell['status']): Cell => ({ key: 'k', status });

// ------------------------------------------------------------------ fitting

test('fittingWardrobeItems fica só com a silhueta do personagem', () => {
  const wardrobe = [
    item('cota'),
    item('sela', { silhouette: 'quadrupede' }),
    item('elmo'),
  ];
  assert.deepEqual(
    fittingWardrobeItems(wardrobe, character()).map((w) => w.id),
    ['cota', 'elmo'],
  );
});

// ------------------------------------------------------------------ pendentes

test('peça incompatível NUNCA entra no lote, nem com célula falha', () => {
  const wardrobe = [item('sela', { silhouette: 'quadrupede' })];
  const cells: Record<string, Cell> = {
    [wardrobeKey('manequim', 'sela')]: cell('falhou'),
  };
  assert.equal(pendingWardrobeItems(wardrobe, character(), cells).length, 0);
});

test('sem remoteId nada entra no lote', () => {
  const wardrobe = [item('cota')];
  assert.equal(
    pendingWardrobeItems(wardrobe, characterWithoutBase(), {}).length,
    0,
  );
});

test('lote = peças que servem, com célula vazia ou falha', () => {
  const wardrobe = [
    item('cota'), // pronta — fora
    item('elmo'), // falhou — dentro
    item('botas'), // sem célula — dentro
    item('luvas'), // gerando — fora
    item('sela', { silhouette: 'quadrupede' }), // não serve — fora
  ];
  const cells: Record<string, Cell> = {
    [wardrobeKey('manequim', 'cota')]: cell('pronto'),
    [wardrobeKey('manequim', 'elmo')]: cell('falhou'),
    [wardrobeKey('manequim', 'luvas')]: cell('gerando'),
    [wardrobeKey('manequim', 'sela')]: cell('vazio'),
  };
  assert.deepEqual(
    pendingWardrobeItems(wardrobe, character(), cells).map((w) => w.id),
    ['elmo', 'botas'],
  );
});

// ------------------------------------------------------------------- contador

test('countBusy conta gerando E na-fila entre as chaves dadas', () => {
  const jobs = {
    a: { status: 'gerando' },
    b: { status: 'pronto' },
    c: { status: 'gerando' },
    d: { status: 'na-fila' },
    fora: { status: 'gerando' },
  };
  // Dois 'gerando' e um 'na-fila' entre as chaves pedidas; 'fora' não entra.
  assert.equal(countBusy(['a', 'b', 'c', 'd'], jobs), 3);
  assert.equal(countBusy([], jobs), 0);
});

// -------------------------------------------------------------------- mergeBatch

test('mergeBatch com lote assentado ou de outro personagem substitui', () => {
  const prev = { characterId: 'manequim', keys: ['a'] };
  const settled = mergeBatch(prev, 'manequim', ['b'], {
    a: { status: 'pronto' },
  });
  assert.deepEqual(settled, { characterId: 'manequim', keys: ['b'] });

  const other = mergeBatch(prev, 'outro-personagem', ['b'], {
    a: { status: 'gerando' },
  });
  assert.deepEqual(other, { characterId: 'outro-personagem', keys: ['b'] });
});

test('mergeBatch com lote ainda rodando acumula sem duplicar chave', () => {
  const prev = { characterId: 'manequim', keys: ['a', 'b'] };
  const batch = mergeBatch(prev, 'manequim', ['b', 'c'], {
    a: { status: 'gerando' },
  });
  assert.deepEqual(batch, { characterId: 'manequim', keys: ['a', 'b', 'c'] });
});

test('countBusy: um lote inteiramente ENFILEIRADO não lê zero', () => {
  // O caso comum com fila: várias peças disparadas, nenhuma admitida ainda.
  const jobs = { a: { status: 'na-fila' }, b: { status: 'na-fila' } };
  assert.equal(countBusy(['a', 'b'], jobs), 2);
});

test('countBusy ignora todo status terminal, inclusive os da fila', () => {
  const jobs = {
    a: { status: 'cancelado' },
    b: { status: 'interrompido' },
    c: { status: 'pronto' },
    d: { status: 'falhou' },
  };
  assert.equal(countBusy(['a', 'b', 'c', 'd'], jobs), 0);
});

test('mergeBatch NÃO descarta um lote que ainda está todo na fila', () => {
  // Era o defeito: com o lote inteiro em 'na-fila', o anterior parecia
  // assentado e o disparo seguinte apagava o denominador do "X de Y".
  const prev = { characterId: 'manequim', keys: ['a', 'b'] };
  const batch = mergeBatch(prev, 'manequim', ['c'], {
    a: { status: 'na-fila' },
    b: { status: 'na-fila' },
  });
  assert.deepEqual(batch, { characterId: 'manequim', keys: ['a', 'b', 'c'] });
});
