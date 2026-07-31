/**
 * Teste do modelo de dados server/model.ts — studio.json v2.
 *
 * Propriedades verificadas:
 *   1. seedStudio devolve v2: version 2, manequim com wizard na etapa 'sul',
 *      description vazia, 5 poses builtin, paleta preservada, wardrobe e
 *      cells vazios, lock ausente.
 *   2. Helpers de chave do wizard: formato `${charId}::__etapa__` e unicidade
 *      entre si e contra cellKey/wardrobeKey.
 *   3. Compatibilidade: Character sem `wizard` continua válido (v2 é aditivo).
 *
 * Execute com: node --test server/model.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellKey,
  wardrobeKey,
  southKey,
  cardinalKey,
  directions8Key,
  seedStudio,
  type Character,
} from './model.ts';

// ------------------------------------------------------------------ seed v2

test('seedStudio — v2: manequim com wizard na etapa sul', () => {
  const s = seedStudio();

  assert.equal(s.version, 2, 'version deve ser 2');
  assert.equal(s.lock, undefined, 'lock ausente até o wizard travar');

  assert.equal(s.characters.length, 1, 'um único personagem inicial');
  const m = s.characters[0]!;
  assert.equal(m.id, 'manequim');
  assert.equal(m.label, 'Manequim base');
  assert.equal(m.silhouette, 'humano-medio');
  assert.equal(m.description, '', 'description vazia — o wizard preenche');
  assert.equal(m.size, 64);
  assert.equal(m.seed, 1);

  assert.ok(m.wizard, 'manequim nasce com wizard');
  assert.equal(m.wizard.etapa, 'sul');
  assert.deepEqual(m.wizard.southVersions, []);
  assert.equal(m.wizard.activeSouth, 0);

  console.log('✓ seedStudio v2: manequim com wizard.etapa === "sul"');
});

test('seedStudio — 5 poses builtin e coleções vazias', () => {
  const s = seedStudio();

  assert.deepEqual(
    s.poses.map((p) => p.id),
    ['parado', 'caminhando', 'correndo', 'pulando', 'atacando'],
  );
  assert.equal(s.poses.filter((p) => p.builtin).length, 5, '5 poses embutidas');

  assert.ok(s.palette.length > 0, 'paleta preservada');
  assert.deepEqual(s.wardrobe, [], 'wardrobe vazio');
  assert.deepEqual(s.cells, {}, 'cells vazio');

  console.log('✓ seedStudio v2: 5 poses builtin, wardrobe/cells vazios');
});

// ------------------------------------------------------------------ chaves do wizard

test('helpers do wizard — formato das chaves', () => {
  assert.equal(southKey('manequim'), 'manequim::__south__');
  assert.equal(cardinalKey('manequim', 'east'), 'manequim::__cardinal-east__');
  assert.equal(cardinalKey('manequim', 'north'), 'manequim::__cardinal-north__');
  assert.equal(cardinalKey('manequim', 'west'), 'manequim::__cardinal-west__');
  assert.equal(directions8Key('manequim'), 'manequim::__directions8__');

  // Mesma convenção de cellKey: tudo vive no namespace `${charId}::…`
  for (const k of [
    southKey('manequim'),
    cardinalKey('manequim', 'east'),
    cardinalKey('manequim', 'north'),
    cardinalKey('manequim', 'west'),
    directions8Key('manequim'),
  ]) {
    assert.ok(k.startsWith('manequim::'), `namespace de cellKey: ${k}`);
  }

  console.log('✓ chaves do wizard no formato ${charId}::__etapa__');
});

test('helpers do wizard — unicidade entre si e vs cellKey/wardrobeKey', () => {
  const charId = 'manequim';
  const keys = [
    southKey(charId),
    cardinalKey(charId, 'east'),
    cardinalKey(charId, 'north'),
    cardinalKey(charId, 'west'),
    directions8Key(charId),
    cellKey(charId, '__base__'),
    cellKey(charId, 'parado'),
    wardrobeKey(charId, 'elmo-de-ferro'),
  ];
  assert.equal(new Set(keys).size, keys.length, 'nenhuma colisão de chave');

  // E com outro personagem o prefixo isola as células.
  assert.notEqual(southKey('manequim'), southKey('guarda'));

  console.log('✓ 8 chaves distintas, sem colisão com cellKey/wardrobeKey');
});

// ------------------------------------------------------------------ compatibilidade

test('Character sem wizard continua válido (v2 é aditivo)', () => {
  // Um personagem criado fora do wizard não carrega `wizard` — o tipo permite
  // e as chaves de célula funcionam do mesmo jeito.
  const legacy: Character = {
    id: 'base-humano',
    label: 'Base — humano',
    silhouette: 'humano-medio',
    description: 'bald naked humanoid mannequin',
    size: 64,
    seed: 1,
    createdAt: new Date().toISOString(),
  };

  assert.equal(legacy.wizard, undefined);
  assert.equal(cellKey(legacy.id, '__base__'), 'base-humano::__base__');
  assert.equal(southKey(legacy.id), 'base-humano::__south__');

  console.log('✓ Character sem wizard: válido e chaveável');
});
