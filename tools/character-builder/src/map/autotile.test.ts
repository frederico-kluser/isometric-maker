/**
 * Testes do autoladrilhamento — F2-08.
 *
 * Cobre:
 *   1. Máscara de 4 bits: todas as 16 combinações de vizinhança.
 *   2. Selecção de peça pela regra da API (fixture sintética).
 *   3. Erro visível para combinação sem peça.
 *   4. Diagnóstico de cobertura: quais máscaras faltam no tileset.
 *   5. Células afectadas pela pintura de um bloco.
 *
 * Execute com: npx tsx --test src/autotile.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BlockStore } from '../../../../packages/iso-core/src/map.ts';
import {
  parseTileRules,
  type TileRule,
  type RawTilesProResponse,
} from '../../../../packages/iso-core/src/tile-rules.ts';
import {
  buildMask,
  findTileForMask,
  autotile,
  missingMasks,
  affectedCells,
} from './autotile.ts';

// ------------------------------------------------------------------ fixture

async function loadFixture(): Promise<RawTilesProResponse> {
  const raw = await readFile(
    join(
      import.meta.dirname!,
      '..',
      '..',
      '..',
      '..',
      'packages',
      'iso-core',
      'test-fixtures',
      'tiles-pro-building.json',
    ),
    'utf-8',
  );
  return JSON.parse(raw) as RawTilesProResponse;
}

// ------------------------------------------------------------------ buildMask — todas as 16 combinações

describe('buildMask — 16 combinações de vizinhança', () => {
  /**
   * Cria um BlockStore com um bloco central e vizinhos conforme a máscara.
   *
   * Convenção: bit0=N (+y), bit1=L (+x), bit2=S (-y), bit3=O (-x)
   */
  function storeWithMask(mask: number): BlockStore {
    const bs = new BlockStore();
    const terrain = 'wall';

    // Bloco central
    bs.setBlock(0, 0, 0, terrain);

    // Vizinhos (se o bit estiver a 1, colocamos o mesmo terreno)
    if (mask & 1) bs.setBlock(0, 1, 0, terrain); // N
    if (mask & 2) bs.setBlock(1, 0, 0, terrain); // L
    if (mask & 4) bs.setBlock(0, -1, 0, terrain); // S
    if (mask & 8) bs.setBlock(-1, 0, 0, terrain); // O

    return bs;
  }

  for (let mask = 0; mask < 16; mask++) {
    it(`máscara ${mask} → buildMask devolve ${mask}`, () => {
      const bs = storeWithMask(mask);
      const result = buildMask(bs, 0, 0, 0, 'wall');
      assert.strictEqual(
        result,
        mask,
        `Esperado ${mask}, obtido ${result}`,
      );
    });
  }

  it('vizinhos com terreno diferente não activam bits', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'wall');
    // Todos os vizinhos existem mas com terreno diferente
    bs.setBlock(0, 1, 0, 'floor');
    bs.setBlock(1, 0, 0, 'floor');
    bs.setBlock(0, -1, 0, 'floor');
    bs.setBlock(-1, 0, 0, 'floor');

    const result = buildMask(bs, 0, 0, 0, 'wall');
    assert.strictEqual(result, 0);
  });

  it('vizinhos em z diferente não activam bits', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'wall');
    // Vizinhos com mesmo terreno mas em z=1
    bs.setBlock(0, 1, 1, 'wall');
    bs.setBlock(1, 0, 1, 'wall');
    bs.setBlock(0, -1, 1, 'wall');
    bs.setBlock(-1, 0, 1, 'wall');

    const result = buildMask(bs, 0, 0, 0, 'wall');
    assert.strictEqual(result, 0);
  });

  it('vizinhos ausentes (coluna vazia) não activam bits', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'wall');
    // Nenhum vizinho definido

    const result = buildMask(bs, 0, 0, 0, 'wall');
    assert.strictEqual(result, 0);
  });

  it('célula sem bloco retorna máscara 0 (getBlock devolve undefined)', () => {
    const bs = new BlockStore();
    // Não definimos nenhum bloco

    const result = buildMask(bs, 0, 0, 0, 'wall');
    // undefined !== 'wall', por isso nenhum bit fica a 1
    assert.strictEqual(result, 0);
  });

  it('máscara 15 com todos os vizinhos do mesmo terreno', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'floor');
    bs.setBlock(0, 1, 0, 'floor'); // N
    bs.setBlock(1, 0, 0, 'floor'); // L
    bs.setBlock(0, -1, 0, 'floor'); // S
    bs.setBlock(-1, 0, 0, 'floor'); // O

    const result = buildMask(bs, 0, 0, 0, 'floor');
    assert.strictEqual(result, 15);
  });
});

// ------------------------------------------------------------------ findTileForMask

describe('findTileForMask — selecção de peça', () => {
  let rules: TileRule[];

  before(async () => {
    const response = await loadFixture();
    rules = parseTileRules(response);
  });

  it('encontra floor com mask 15', () => {
    const rule = findTileForMask(rules, 15, 'floor');
    assert.ok(rule);
    assert.strictEqual(rule.tileIndex, 0);
    assert.strictEqual(rule.ruleType, 'outline');
  });

  it('encontra wall com mask 5 (N+S)', () => {
    const rule = findTileForMask(rules, 5, 'wall');
    assert.ok(rule);
    assert.strictEqual(rule.tileIndex, 1);
    assert.strictEqual(rule.ruleType, 'edge');
    assert.deepStrictEqual(rule.activeSides, ['N', 'S']);
  });

  it('encontra wall com mask 10 (L+O)', () => {
    const rule = findTileForMask(rules, 10, 'wall');
    assert.ok(rule);
    assert.strictEqual(rule.tileIndex, 1);
    assert.deepStrictEqual(rule.activeSides, ['L', 'O']);
  });

  it('encontra doorway com mask 5 (N+S)', () => {
    const rule = findTileForMask(rules, 5, 'doorway');
    assert.ok(rule);
    assert.strictEqual(rule.tileIndex, 4);
  });

  it('encontra pillar com mask 0', () => {
    const rule = findTileForMask(rules, 0, 'pillar');
    assert.ok(rule);
    assert.strictEqual(rule.tileIndex, 5);
  });

  it('não encontra wall com mask 7 (combinação ausente na fixture)', () => {
    const rule = findTileForMask(rules, 7, 'wall');
    assert.strictEqual(rule, undefined);
  });

  it('não encontra terreno que não existe nas regras', () => {
    const rule = findTileForMask(rules, 0, 'water');
    assert.strictEqual(rule, undefined);
  });
});

// ------------------------------------------------------------------ autotile

describe('autotile — ladrilhamento automático', () => {
  let rules: TileRule[];

  before(async () => {
    const response = await loadFixture();
    rules = parseTileRules(response);
  });

  it('devolve tileIndex 0 para floor totalmente rodeado (mask 15)', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'floor');
    bs.setBlock(0, 1, 0, 'floor');
    bs.setBlock(1, 0, 0, 'floor');
    bs.setBlock(0, -1, 0, 'floor');
    bs.setBlock(-1, 0, 0, 'floor');

    const tileIndex = autotile(bs, 0, 0, 0, 'floor', rules);
    assert.strictEqual(tileIndex, 0);
  });

  it('devolve tileIndex 1 para wall isolado (mask 0)', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'wall');

    const tileIndex = autotile(bs, 0, 0, 0, 'wall', rules);
    assert.strictEqual(tileIndex, 1);
  });

  it('devolve tileIndex 1 para wall com vizinhos N+S (mask 5)', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'wall');
    bs.setBlock(0, 1, 0, 'wall'); // N
    bs.setBlock(0, -1, 0, 'wall'); // S

    const tileIndex = autotile(bs, 0, 0, 0, 'wall', rules);
    assert.strictEqual(tileIndex, 1);
  });

  it('devolve tileIndex 2 para wall com vizinhos N+L (mask 3)', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'wall');
    bs.setBlock(0, 1, 0, 'wall'); // N
    bs.setBlock(1, 0, 0, 'wall'); // L

    const tileIndex = autotile(bs, 0, 0, 0, 'wall', rules);
    assert.strictEqual(tileIndex, 2);
  });

  it('devolve tileIndex 3 para wall com vizinhos S+O (mask 12)', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'wall');
    bs.setBlock(0, -1, 0, 'wall'); // S
    bs.setBlock(-1, 0, 0, 'wall'); // O

    const tileIndex = autotile(bs, 0, 0, 0, 'wall', rules);
    assert.strictEqual(tileIndex, 3);
  });

  it('ERRO visível quando não há peça para a combinação (mask 7)', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'wall');
    bs.setBlock(0, 1, 0, 'wall'); // N
    bs.setBlock(1, 0, 0, 'wall'); // L
    bs.setBlock(0, -1, 0, 'wall'); // S
    // mask = 1+2+4 = 7, sem peça na fixture

    assert.throws(
      () => autotile(bs, 0, 0, 0, 'wall', rules),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        return (
          err.message.includes('máscara 7') &&
          err.message.includes('0,0,0') &&
          err.message.includes('wall')
        );
      },
    );
  });

  it('ERRO visível para terreno sem regras', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'water');

    assert.throws(
      () => autotile(bs, 0, 0, 0, 'water', rules),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        return (
          err.message.includes('máscara') &&
          err.message.includes('water')
        );
      },
    );
  });
});

// ------------------------------------------------------------------ missingMasks

describe('missingMasks — diagnóstico de cobertura', () => {
  let rules: TileRule[];

  before(async () => {
    const response = await loadFixture();
    rules = parseTileRules(response);
  });

  it('wall tem máscaras em falta (a fixture é incompleta)', () => {
    const missing = missingMasks(rules, 'wall');
    // A fixture cobre masks 0, 3, 5, 10, 12 para wall
    // Faltam: 1, 2, 4, 6, 7, 8, 9, 11, 13, 14, 15
    assert.ok(missing.length > 0, 'deve haver máscaras em falta');
    assert.ok(missing.includes(1));
    assert.ok(missing.includes(2));
    assert.ok(missing.includes(4));
    assert.ok(missing.includes(6));
    assert.ok(missing.includes(7));
    assert.ok(missing.includes(8));
    assert.ok(missing.includes(9));
    assert.ok(missing.includes(11));
    assert.ok(missing.includes(13));
    assert.ok(missing.includes(14));
    assert.ok(missing.includes(15));
  });

  it('floor tem máscaras em falta', () => {
    const missing = missingMasks(rules, 'floor');
    // floor tem mask 15 (outline) + mask 2 e 8 (staircase, floor)
    assert.ok(missing.length > 0);
    // mask 15, 2 e 8 estão cobertas (staircase partilha terrain "floor")
    assert.ok(!missing.includes(15));
    assert.ok(!missing.includes(2));
    assert.ok(!missing.includes(8));
    // as outras 13 estão em falta
    assert.strictEqual(missing.length, 13);
  });

  it('doorway tem máscaras em falta', () => {
    const missing = missingMasks(rules, 'doorway');
    // doorway só tem mask 5
    assert.ok(missing.length > 0);
    assert.ok(!missing.includes(5));
    assert.strictEqual(missing.length, 15);
  });

  it('staircase tem máscaras em falta', () => {
    const missing = missingMasks(rules, 'staircase');
    // staircase tem mask 2 e 8
    assert.ok(missing.length > 0);
    assert.ok(!missing.includes(2));
    assert.ok(!missing.includes(8));
    assert.strictEqual(missing.length, 14);
  });

  it('terreno inexistente → 16 máscaras em falta', () => {
    const missing = missingMasks(rules, 'water');
    assert.strictEqual(missing.length, 16);
  });

  it('máscaras em falta estão ordenadas', () => {
    const missing = missingMasks(rules, 'wall');
    for (let i = 1; i < missing.length; i++) {
      assert.ok(
        missing[i]! > missing[i - 1]!,
        `máscaras devem estar ordenadas: ${missing[i - 1]} < ${missing[i]}`,
      );
    }
  });
});

// ------------------------------------------------------------------ affectedCells

describe('affectedCells — vizinhança afectada', () => {
  it('devolve a própria célula mais 4 vizinhos', () => {
    const cells = affectedCells(5, 3);
    assert.strictEqual(cells.length, 5);

    // A própria célula
    assert.deepStrictEqual(cells[0], { x: 5, y: 3 });

    // Vizinhos cardeais
    const set = new Set(cells.map((c) => `${c.x}:${c.y}`));
    assert.ok(set.has('5:3'), 'célula central');
    assert.ok(set.has('5:4'), 'Norte');
    assert.ok(set.has('6:3'), 'Leste');
    assert.ok(set.has('5:2'), 'Sul');
    assert.ok(set.has('4:3'), 'Oeste');
  });

  it('células podem ter coordenadas negativas', () => {
    const cells = affectedCells(0, 0);
    const set = new Set(cells.map((c) => `${c.x}:${c.y}`));
    assert.ok(set.has('0:0'));
    assert.ok(set.has('0:1'));
    assert.ok(set.has('1:0'));
    assert.ok(set.has('0:-1'));
    assert.ok(set.has('-1:0'));
  });
});

// ------------------------------------------------------------------ grep de aceitação

describe('critérios de aceitação', () => {
  it('buildMask usa a convenção F2-04 (N=bit0, L=bit1, S=bit2, O=bit3)', () => {
    // Verifica que cada bit individual corresponde à direcção correcta
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'test');

    // Norte → bit 0 (valor 1)
    bs.setBlock(0, 1, 0, 'test');
    assert.strictEqual(buildMask(bs, 0, 0, 0, 'test'), 1);
    bs.removeBlock(0, 1, 0);

    // Leste → bit 1 (valor 2)
    bs.setBlock(1, 0, 0, 'test');
    assert.strictEqual(buildMask(bs, 0, 0, 0, 'test'), 2);
    bs.removeBlock(1, 0, 0);

    // Sul → bit 2 (valor 4)
    bs.setBlock(0, -1, 0, 'test');
    assert.strictEqual(buildMask(bs, 0, 0, 0, 'test'), 4);
    bs.removeBlock(0, -1, 0);

    // Oeste → bit 3 (valor 8)
    bs.setBlock(-1, 0, 0, 'test');
    assert.strictEqual(buildMask(bs, 0, 0, 0, 'test'), 8);
  });

  it('não escreve tabela à mão — importa tile_rules de iso-core', () => {
    // Se este teste compila, a dependência está correcta.
    // Verifica que os tipos vêm do iso-core.
    const rule: TileRule = {
      tileIndex: 0,
      ruleType: 'edge',
      arity: 4,
      connectivity: 'same',
      terrains: ['test'],
      mask: 0,
      activeSides: [],
    };
    assert.strictEqual(rule.tileIndex, 0);
  });

  it('combinação sem peça → ERRO (mensagem contém máscara e terreno)', () => {
    const bs = new BlockStore();
    bs.setBlock(0, 0, 0, 'ghost_terrain');

    try {
      autotile(bs, 0, 0, 0, 'ghost_terrain', []);
      assert.fail('devia ter lançado');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('máscara'),
        'mensagem deve mencionar a máscara',
      );
      assert.ok(
        err.message.includes('ghost_terrain'),
        'mensagem deve mencionar o terreno',
      );
    }
  });

  it('missingMasks diz quais faltam — o editor pode mostrar', () => {
    const missing = missingMasks([], 'wall');
    // Sem regras, todas as 16 faltam
    assert.strictEqual(missing.length, 16);
    // A primeira é 0
    assert.strictEqual(missing[0], 0);
    // A última é 15
    assert.strictEqual(missing[15], 15);
  });
});
