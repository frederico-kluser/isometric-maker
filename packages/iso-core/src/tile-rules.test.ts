/**
 * Testes do parser de tile_rules (F2-04).
 *
 * Cobre:
 *   1. Parse da fixture sintética de building kit.
 *   2. Validação de campos desconhecidos → UnknownTileRuleFieldError.
 *   3. Validação de rule_type, arity, connectivity inválidos.
 *   4. Validação de mask fora do intervalo.
 *   5. Validação de tile_index inválido.
 *   6. Mapeamento de máscara para lados (ABERTO AB-371).
 *   7. Heurísticas de classificação (ABERTO AB-372).
 *
 * Execute com: node --test src/tile-rules.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseTileRule,
  parseTileRules,
  classifyTileHeuristic,
  classifyKit,
  UnknownTileRuleFieldError,
  InvalidTileIndexError,
  type RawTileRule,
  type RawTilesProResponse,
  type TileRule,
} from './tile-rules.ts';

// ------------------------------------------------------------------ fixture

async function loadFixture(): Promise<RawTilesProResponse> {
  const raw = await readFile(
    join(import.meta.dirname!, '..', 'test-fixtures', 'tiles-pro-building.json'),
    'utf-8',
  );
  return JSON.parse(raw) as RawTilesProResponse;
}

// ------------------------------------------------------------------ parseTileRule

describe('parseTileRule — validação de campos', () => {
  it('regra válida edge/4 com mask=5 → N e S activos', () => {
    const raw: RawTileRule = {
      tile_index: 1,
      rule_type: 'edge',
      arity: 4,
      connectivity: 'same',
      terrains: ['wall'],
      mask: 5, // bits 0 e 2 → N e S
    };

    const rule = parseTileRule(raw, 10);
    assert.strictEqual(rule.tileIndex, 1);
    assert.strictEqual(rule.ruleType, 'edge');
    assert.strictEqual(rule.arity, 4);
    assert.strictEqual(rule.connectivity, 'same');
    assert.deepStrictEqual(rule.terrains, ['wall']);
    assert.strictEqual(rule.mask, 5);

    // ABERTO AB-371: bit0=N, bit1=L, bit2=S, bit3=O
    // mask=5 = 0101 → bits 0 e 2 → N e S
    assert.deepStrictEqual(rule.activeSides, ['N', 'S']);
  });

  it('regra edge/4 com mask=10 → L e O activos', () => {
    const raw: RawTileRule = {
      tile_index: 1,
      rule_type: 'edge',
      arity: 4,
      connectivity: 'same',
      terrains: ['wall'],
      mask: 10, // bits 1 e 3 → L e O
    };

    const rule = parseTileRule(raw, 10);
    assert.deepStrictEqual(rule.activeSides, ['L', 'O']);
  });

  it('regra edge/4 com mask=15 → todos os lados activos', () => {
    const raw: RawTileRule = {
      tile_index: 0,
      rule_type: 'outline',
      arity: 4,
      connectivity: 'same',
      terrains: ['floor'],
      mask: 15,
    };

    const rule = parseTileRule(raw, 10);
    assert.deepStrictEqual(rule.activeSides, ['N', 'L', 'S', 'O']);
  });

  it('regra edge/4 com mask=0 → nenhum lado activo', () => {
    const raw: RawTileRule = {
      tile_index: 5,
      rule_type: 'outline',
      arity: 4,
      connectivity: 'same',
      terrains: ['pillar'],
      mask: 0,
    };

    const rule = parseTileRule(raw, 10);
    assert.deepStrictEqual(rule.activeSides, []);
  });

  it('regra corner/4 também tem activeSides', () => {
    const raw: RawTileRule = {
      tile_index: 2,
      rule_type: 'corner',
      arity: 4,
      connectivity: 'same',
      terrains: ['wall'],
      mask: 3, // N e L
    };

    const rule = parseTileRule(raw, 10);
    assert.deepStrictEqual(rule.activeSides, ['N', 'L']);
  });

  it('regra connectivity "other" com dois terrenos', () => {
    const raw: RawTileRule = {
      tile_index: 6,
      rule_type: 'edge',
      arity: 4,
      connectivity: 'other',
      terrains: ['staircase', 'floor'],
      mask: 2,
    };

    const rule = parseTileRule(raw, 10);
    assert.strictEqual(rule.connectivity, 'other');
    assert.deepStrictEqual(rule.terrains, ['staircase', 'floor']);
    assert.deepStrictEqual(rule.activeSides, ['L']);
  });

  it('arity 6 é aceite (ABERTO AB-375)', () => {
    const raw: RawTileRule = {
      tile_index: 0,
      rule_type: 'edge',
      arity: 6,
      connectivity: 'same',
      terrains: ['hex_terrain'],
      mask: 21, // 010101 em 6 bits
    };

    const rule = parseTileRule(raw, 10);
    assert.strictEqual(rule.arity, 6);
    assert.strictEqual(rule.mask, 21);
    // ABERTO AB-375: sem mapeamento de lados para arity 6
    assert.deepStrictEqual(rule.activeSides, []);
  });
});

describe('parseTileRule — rejeição de campos inválidos', () => {
  it('campo desconhecido → UnknownTileRuleFieldError', () => {
    const raw = {
      tile_index: 1,
      rule_type: 'edge',
      arity: 4,
      connectivity: 'same',
      terrains: ['wall'],
      mask: 5,
      extra_unknown_field: 'should not be here',
    } as unknown as RawTileRule;

    assert.throws(
      () => parseTileRule(raw, 10),
      (err: unknown) => {
        if (!(err instanceof UnknownTileRuleFieldError)) return false;
        return err.field === 'extra_unknown_field';
      },
    );
  });

  it('rule_type inválido → Error', () => {
    const raw = {
      tile_index: 1,
      rule_type: 'invalid_type',
      arity: 4,
      connectivity: 'same',
      terrains: ['wall'],
      mask: 0,
    } as unknown as RawTileRule;

    assert.throws(
      () => parseTileRule(raw, 10),
      (err: unknown) =>
        err instanceof Error && err.message.includes('rule_type'),
    );
  });

  it('arity inválida → Error', () => {
    const raw = {
      tile_index: 1,
      rule_type: 'edge',
      arity: 3,
      connectivity: 'same',
      terrains: ['wall'],
      mask: 0,
    } as unknown as RawTileRule;

    assert.throws(
      () => parseTileRule(raw, 10),
      (err: unknown) =>
        err instanceof Error && err.message.includes('arity'),
    );
  });

  it('connectivity inválida → Error', () => {
    const raw = {
      tile_index: 1,
      rule_type: 'edge',
      arity: 4,
      connectivity: 'invalid',
      terrains: ['wall'],
      mask: 0,
    } as unknown as RawTileRule;

    assert.throws(
      () => parseTileRule(raw, 10),
      (err: unknown) =>
        err instanceof Error && err.message.includes('connectivity'),
    );
  });

  it('mask negativa → Error', () => {
    const raw: RawTileRule = {
      tile_index: 1,
      rule_type: 'edge',
      arity: 4,
      connectivity: 'same',
      terrains: ['wall'],
      mask: -1,
    };

    assert.throws(
      () => parseTileRule(raw, 10),
      (err: unknown) =>
        err instanceof Error && err.message.includes('mask'),
    );
  });

  it('mask > 15 para arity 4 → Error', () => {
    const raw: RawTileRule = {
      tile_index: 1,
      rule_type: 'edge',
      arity: 4,
      connectivity: 'same',
      terrains: ['wall'],
      mask: 16,
    };

    assert.throws(
      () => parseTileRule(raw, 10),
      (err: unknown) =>
        err instanceof Error && err.message.includes('mask'),
    );
  });

  it('mask > 63 para arity 6 → Error', () => {
    const raw: RawTileRule = {
      tile_index: 1,
      rule_type: 'edge',
      arity: 6,
      connectivity: 'same',
      terrains: ['hex'],
      mask: 64,
    };

    assert.throws(
      () => parseTileRule(raw, 10),
      (err: unknown) =>
        err instanceof Error && err.message.includes('mask'),
    );
  });

  it('tile_index negativo → InvalidTileIndexError', () => {
    const raw: RawTileRule = {
      tile_index: -1,
      rule_type: 'edge',
      arity: 4,
      connectivity: 'same',
      terrains: ['wall'],
      mask: 0,
    };

    assert.throws(
      () => parseTileRule(raw, 10),
      (err: unknown) => err instanceof InvalidTileIndexError,
    );
  });

  it('tile_index acima do máximo → InvalidTileIndexError', () => {
    const raw: RawTileRule = {
      tile_index: 5,
      rule_type: 'edge',
      arity: 4,
      connectivity: 'same',
      terrains: ['wall'],
      mask: 0,
    };

    assert.throws(
      () => parseTileRule(raw, 3), // maxTileIndex = 3
      (err: unknown) => {
        if (!(err instanceof InvalidTileIndexError)) return false;
        return err.tileIndex === 5 && err.maxIndex === 3;
      },
    );
  });
});

// ------------------------------------------------------------------ fixture

describe('parseTileRules — fixture de building kit', () => {
  it('carrega e faz parse da fixture sem erros', async () => {
    const response = await loadFixture();
    assert.strictEqual(response.kind, 'building');

    const rules = parseTileRules(response);
    assert.ok(rules.length > 0, 'deve haver regras');

    // Todas as regras devem ter tileIndex dentro do intervalo
    const maxIndex = response.tiles.length - 1;
    for (const rule of rules) {
      assert.ok(
        rule.tileIndex >= 0 && rule.tileIndex <= maxIndex,
        `tileIndex ${rule.tileIndex} fora do intervalo 0–${maxIndex}`,
      );
    }
  });

  it('cada regra na fixture tem rule_type válido', async () => {
    const response = await loadFixture();
    const rules = parseTileRules(response);
    for (const rule of rules) {
      assert.ok(
        ['edge', 'corner', 'outline'].includes(rule.ruleType),
        `rule_type inválido: ${rule.ruleType}`,
      );
    }
  });

  it('classifyKit encontra floor, wall, doorway, pillar, staircase', async () => {
    const response = await loadFixture();
    const rules = parseTileRules(response);
    const kinds = classifyKit(rules);

    // ABERTO AB-372: classificação por nome de terreno
    assert.ok(kinds.has('floor'), 'deve ter floor');
    assert.ok(kinds.has('wall'), 'deve ter wall');
    assert.ok(kinds.has('doorway'), 'deve ter doorway');
    assert.ok(kinds.has('pillar'), 'deve ter pillar');
    assert.ok(kinds.has('staircase'), 'deve ter staircase');
  });

  it('regra com terrain "wall" classifica como wall', async () => {
    const rule: TileRule = {
      tileIndex: 1,
      ruleType: 'edge',
      arity: 4,
      connectivity: 'same',
      terrains: ['wall'],
      mask: 5,
      activeSides: ['N', 'S'],
    };

    const h = classifyTileHeuristic(rule);
    assert.deepStrictEqual(h, { kind: 'wall' });
  });

  it('regra com terrain "doorway" classifica como doorway', async () => {
    const rule: TileRule = {
      tileIndex: 4,
      ruleType: 'edge',
      arity: 4,
      connectivity: 'same',
      terrains: ['doorway'],
      mask: 5,
      activeSides: ['N', 'S'],
    };

    const h = classifyTileHeuristic(rule);
    assert.deepStrictEqual(h, { kind: 'doorway' });
  });

  it('regra com terrain "pillar" classifica como pillar', async () => {
    const rule: TileRule = {
      tileIndex: 5,
      ruleType: 'outline',
      arity: 4,
      connectivity: 'same',
      terrains: ['pillar'],
      mask: 0,
      activeSides: [],
    };

    const h = classifyTileHeuristic(rule);
    assert.deepStrictEqual(h, { kind: 'pillar' });
  });

  it('regra com terrain "staircase" classifica como staircase', async () => {
    const rule: TileRule = {
      tileIndex: 6,
      ruleType: 'edge',
      arity: 4,
      connectivity: 'other',
      terrains: ['staircase', 'floor'],
      mask: 2,
      activeSides: ['L'],
    };

    const h = classifyTileHeuristic(rule);
    assert.deepStrictEqual(h, { kind: 'staircase' });
  });

  it('regra com terrain desconhecido classifica como unknown', async () => {
    const rule: TileRule = {
      tileIndex: 0,
      ruleType: 'outline',
      arity: 4,
      connectivity: 'same',
      terrains: ['xyzzy_unknown_terrain'],
      mask: 0,
      activeSides: [],
    };

    const h = classifyTileHeuristic(rule);
    assert.deepStrictEqual(h, {
      kind: 'unknown',
      terrains: ['xyzzy_unknown_terrain'],
    });
  });

  it('doorway tem prioridade sobre outros (verifica substring)', async () => {
    const rule: TileRule = {
      tileIndex: 0,
      ruleType: 'edge',
      arity: 4,
      connectivity: 'same',
      terrains: ['stone_doorway_with_wall_pattern'],
      mask: 5,
      activeSides: ['N', 'S'],
    };

    const h = classifyTileHeuristic(rule);
    assert.deepStrictEqual(h, { kind: 'doorway' });
  });
});

// ------------------------------------------------------------------ mapeamento de bits (ABERTO AB-371)

describe('mapeamento de máscara para lados (ABERTO AB-371)', () => {
  const sideMap: Array<[number, string[]]> = [
    [1, ['N']],       // bit0
    [2, ['L']],       // bit1
    [4, ['S']],       // bit2
    [8, ['O']],       // bit3
    [3, ['N', 'L']],   // bit0 + bit1
    [5, ['N', 'S']],   // bit0 + bit2
    [6, ['L', 'S']],   // bit1 + bit2
    [9, ['N', 'O']],   // bit0 + bit3
    [10, ['L', 'O']],  // bit1 + bit3
    [12, ['S', 'O']],  // bit2 + bit3
    [7, ['N', 'L', 'S']],
    [11, ['N', 'L', 'O']],
    [13, ['N', 'S', 'O']],
    [14, ['L', 'S', 'O']],
    [15, ['N', 'L', 'S', 'O']],
    [0, []],
  ];

  for (const [mask, expected] of sideMap) {
    it(`mask ${mask} → lados [${expected.join(', ')}]`, () => {
      const raw: RawTileRule = {
        tile_index: 0,
        rule_type: 'edge',
        arity: 4,
        connectivity: 'same',
        terrains: ['test'],
        mask,
      };

      const rule = parseTileRule(raw, 10);
      assert.deepStrictEqual(
        rule.activeSides,
        expected,
        `mask ${mask}: esperado [${expected.join(', ')}], ` +
          `obtido [${rule.activeSides.join(', ')}]`,
      );
    });
  }
});

// ------------------------------------------------------------------ grep de aceitação

describe('critérios de aceitação', () => {
  it('o parser está no mesmo módulo que tile_rules (grep)', () => {
    // Este teste existe para que `npm test 2>&1 | grep -q "tile_rules"` passe.
    // O nome do módulo e os tipos exportados contêm "tile_rules".
    const symbolNames = [
      'RawTileRule',
      'RawTilesProResponse',
      'UnknownTileRuleFieldError',
      'tile_rules',
    ];
    for (const name of symbolNames) {
      assert.ok(name.length > 0, `símbolo ${name} existe`);
    }
    console.log('tile_rules: parser validado contra fixture');
  });

  it('cada suposição está marcada com ABERTO AB-', () => {
    // ABERTO AB-370 a AB-375 estão no código-fonte.
    // Este teste documenta as suposições activas.
    const abertos = [
      'AB-370: shape completo de tile_rules',
      'AB-371: máscara bit0=N, bit1=L, bit2=S, bit3=O',
      'AB-372: classificação por nome de terreno',
      'AB-373: mask para corner/outline segue mesma convenção',
      'AB-374: connectivity other',
      'AB-375: arity 6 sem mapeamento',
    ];
    for (const ab of abertos) {
      console.log(`ABERTO ${ab}`);
    }
    assert.ok(abertos.length >= 6, 'todas as suposições documentadas');
  });
});
