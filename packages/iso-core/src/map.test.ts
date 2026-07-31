import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BlockStore,
  EdgeStore,
  EDGE_SIDES,
  MULTI_CELL_ERROR,
  validateMapObject,
  type BlockRleRun,
  type EdgeSide,
  type MapObject,
} from './map.ts';

// ---------------------------------------------------------------------------
// BlockStore
// ---------------------------------------------------------------------------

describe('BlockStore', () => {
  describe('getBlock / setBlock', () => {
    it('coluna inexistente devolve undefined', () => {
      const store = new BlockStore();
      assert.strictEqual(store.getBlock(0, 0, 0), undefined);
    });

    it('getBlock acima do topo devolve undefined', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      assert.strictEqual(store.getBlock(0, 0, 1), undefined);
    });

    it('z negativo devolve undefined', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      assert.strictEqual(store.getBlock(0, 0, -1), undefined);
    });

    it('setBlock e getBlock concordam', () => {
      const store = new BlockStore();
      store.setBlock(3, 5, 0, 'grass');
      store.setBlock(3, 5, 1, 'dirt');
      store.setBlock(3, 5, 2, 'stone');

      assert.strictEqual(store.getBlock(3, 5, 0), 'grass');
      assert.strictEqual(store.getBlock(3, 5, 1), 'dirt');
      assert.strictEqual(store.getBlock(3, 5, 2), 'stone');
    });

    it('setBlock em z saltado preenche níveis intermédios com ar', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 3, 'stone');

      // Níveis 0-2 devem ser ar
      assert.strictEqual(store.getBlock(0, 0, 0), '');
      assert.strictEqual(store.getBlock(0, 0, 1), '');
      assert.strictEqual(store.getBlock(0, 0, 2), '');
      assert.strictEqual(store.getBlock(0, 0, 3), 'stone');
      // Nível 4 acima do topo
      assert.strictEqual(store.getBlock(0, 0, 4), undefined);
    });

    it('substituir bloco existente funciona', () => {
      const store = new BlockStore();
      store.setBlock(1, 2, 0, 'grass');
      store.setBlock(1, 2, 0, 'water');
      assert.strictEqual(store.getBlock(1, 2, 0), 'water');
    });

    it('z negativo em setBlock é ignorado', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, -1, 'grass');
      assert.strictEqual(store.getBlock(0, 0, -1), undefined);
      assert.strictEqual(store.heightAt(0, 0), 0);
    });
  });

  describe('removeBlock', () => {
    it('removeBlock substitui por ar', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      store.removeBlock(0, 0, 0);
      assert.strictEqual(store.getBlock(0, 0, 0), undefined);
      assert.strictEqual(store.heightAt(0, 0), 0);
    });

    it('removeBlock no topo encolhe a coluna', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      store.setBlock(0, 0, 1, 'dirt');
      store.removeBlock(0, 0, 1);

      assert.strictEqual(store.getBlock(0, 0, 1), undefined);
      assert.strictEqual(store.heightAt(0, 0), 1);
      assert.strictEqual(store.getBlock(0, 0, 0), 'grass');
    });

    it('removeBlock no meio preserva níveis superiores', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      store.setBlock(0, 0, 1, 'dirt');
      store.setBlock(0, 0, 2, 'stone');
      store.removeBlock(0, 0, 1);

      // z=1 vira ar, mas z=2 continua stone
      assert.strictEqual(store.getBlock(0, 0, 0), 'grass');
      assert.strictEqual(store.getBlock(0, 0, 1), '');
      assert.strictEqual(store.getBlock(0, 0, 2), 'stone');
      assert.strictEqual(store.heightAt(0, 0), 3);
    });

    it('removeBlock em coluna inexistente é no-op', () => {
      const store = new BlockStore();
      store.removeBlock(99, 99, 0); // não lança
      assert.strictEqual(store.heightAt(99, 99), 0);
    });
  });

  describe('heightAt — derivada, nunca persistida', () => {
    it('coluna vazia tem altura 0', () => {
      const store = new BlockStore();
      assert.strictEqual(store.heightAt(0, 0), 0);
    });

    it('um bloco → altura 1', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      assert.strictEqual(store.heightAt(0, 0), 1);
    });

    it('três blocos empilhados → altura 3', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      store.setBlock(0, 0, 1, 'dirt');
      store.setBlock(0, 0, 2, 'stone');
      assert.strictEqual(store.heightAt(0, 0), 3);
    });

    it('altura é o primeiro z vazio (maxZ + 1)', () => {
      const store = new BlockStore();
      store.setBlock(5, 5, 0, 'a');
      store.setBlock(5, 5, 4, 'b');

      // Preenchimento automático: z=1,2,3 são ar
      // TrimTop: z=4 tem 'b', então coluna vai até z=4 inclusive → length=5
      assert.strictEqual(store.heightAt(5, 5), 5);
    });

    it('colunas independentes não interferem', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      store.setBlock(0, 0, 1, 'dirt');
      store.setBlock(10, 20, 0, 'sand');

      assert.strictEqual(store.heightAt(0, 0), 2);
      assert.strictEqual(store.heightAt(10, 20), 1);
      assert.strictEqual(store.heightAt(5, 5), 0);
    });
  });

  describe('forEach', () => {
    it('itera todos os blocos não-ar', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      store.setBlock(0, 0, 1, 'dirt');
      store.setBlock(1, 0, 0, 'sand');

      const collected: Array<[number, number, number, string]> = [];
      store.forEach((x, y, z, block) => {
        collected.push([x, y, z, block]);
      });

      assert.strictEqual(collected.length, 3);
      // Ordem é determinística (por inserção de coluna)
      assert.deepStrictEqual(collected[0], [0, 0, 0, 'grass']);
      assert.deepStrictEqual(collected[1], [0, 0, 1, 'dirt']);
      assert.deepStrictEqual(collected[2], [1, 0, 0, 'sand']);
    });

    it('forEach não itera blocos de ar', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      store.setBlock(0, 0, 3, 'stone'); // z=1,2 são ar

      const collected: string[] = [];
      store.forEach((_x, _y, _z, block) => {
        collected.push(block);
      });

      assert.deepStrictEqual(collected, ['grass', 'stone']);
    });

    it('forEach em store vazio não chama callback', () => {
      const store = new BlockStore();
      let called = false;
      store.forEach(() => {
        called = true;
      });
      assert.strictEqual(called, false);
    });
  });

  describe('RLE — codificação e descodificação', () => {
    it('encodeRle: coluna vazia → []', () => {
      assert.deepStrictEqual(BlockStore.encodeRle([]), []);
    });

    it('encodeRle: bloco único', () => {
      const runs = BlockStore.encodeRle(['grass']);
      assert.deepStrictEqual(runs, [{ block: 'grass', count: 1 }]);
    });

    it('encodeRle: vários blocos iguais colapsam', () => {
      const runs = BlockStore.encodeRle([
        'grass',
        'grass',
        'grass',
      ]);
      assert.deepStrictEqual(runs, [{ block: 'grass', count: 3 }]);
    });

    it('encodeRle: alternância de tipos', () => {
      const runs = BlockStore.encodeRle([
        'grass',
        'grass',
        'dirt',
        'dirt',
        'dirt',
        'stone',
      ]);
      assert.deepStrictEqual(runs, [
        { block: 'grass', count: 2 },
        { block: 'dirt', count: 3 },
        { block: 'stone', count: 1 },
      ]);
    });

    it('encodeRle: inclui ar', () => {
      const runs = BlockStore.encodeRle(['', '', 'stone', 'stone']);
      assert.deepStrictEqual(runs, [
        { block: '', count: 2 },
        { block: 'stone', count: 2 },
      ]);
    });

    it('decodeRle: inversa de encodeRle', () => {
      const original = [
        'grass',
        'grass',
        'dirt',
        'stone',
        'stone',
        'stone',
      ];
      const runs = BlockStore.encodeRle(original);
      const decoded = BlockStore.decodeRle(runs);
      assert.deepStrictEqual(decoded, original);
    });

    it('decodeRle: vazio → []', () => {
      assert.deepStrictEqual(BlockStore.decodeRle([]), []);
    });

    it('round-trip: store → RLE → store preserva dados', () => {
      const original = new BlockStore();
      original.setBlock(0, 0, 0, 'grass');
      original.setBlock(0, 0, 1, 'grass');
      original.setBlock(0, 0, 2, 'dirt');
      original.setBlock(1, 0, 0, 'sand');
      original.setBlock(1, 0, 1, 'stone');
      original.setBlock(5, 5, 0, 'water');

      const rle = original.toRle();
      const restored = BlockStore.fromRle(rle);

      // Verifica cada bloco
      const check = (store: BlockStore, x: number, y: number, z: number, expected: string) => {
        assert.strictEqual(
          store.getBlock(x, y, z),
          expected,
          `(${x},${y},${z})`,
        );
      };

      check(restored, 0, 0, 0, 'grass');
      check(restored, 0, 0, 1, 'grass');
      check(restored, 0, 0, 2, 'dirt');
      check(restored, 1, 0, 0, 'sand');
      check(restored, 1, 0, 1, 'stone');
      check(restored, 5, 5, 0, 'water');

      // Alturas
      assert.strictEqual(restored.heightAt(0, 0), 3);
      assert.strictEqual(restored.heightAt(1, 0), 2);
      assert.strictEqual(restored.heightAt(5, 5), 1);
      assert.strictEqual(restored.heightAt(99, 99), 0);
    });

    it('toRle: coluna vazia é omitida', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      store.removeBlock(0, 0, 0); // vazia de novo

      const rle = store.toRle();
      assert.strictEqual(Object.keys(rle).length, 0);
    });

    it('toRle: coluna com trailing air não inclui runs de ar no fim', () => {
      const store = new BlockStore();
      store.setBlock(0, 0, 0, 'grass');
      store.setBlock(0, 0, 3, 'stone'); // z=1,2 ar, z=4+ não existe

      const rle = store.toRle();
      const runs = rle['0:0']!;
      // Deve ser: grass, ar, ar, stone (trimTop remove trailing air)
      assert.deepStrictEqual(runs, [
        { block: 'grass', count: 1 },
        { block: '', count: 2 },
        { block: 'stone', count: 1 },
      ]);
    });

    it('fromRle: chave mal-formada é ignorada', () => {
      const store = BlockStore.fromRle({
        'abc': [{ block: 'grass', count: 1 }],
        '1:2': [{ block: 'dirt', count: 1 }],
      });
      assert.strictEqual(store.getBlock(1, 2, 0), 'dirt');
    });
  });
});

// ---------------------------------------------------------------------------
// EdgeStore
// ---------------------------------------------------------------------------

describe('EdgeStore', () => {
  it('aresta inexistente devolve undefined', () => {
    const store = new EdgeStore();
    assert.strictEqual(store.getEdge(0, 0, 0, 'N'), undefined);
  });

  it('setEdge e getEdge concordam', () => {
    const store = new EdgeStore();
    store.setEdge(0, 0, 0, 'N', 'stone_wall');
    store.setEdge(0, 0, 0, 'L', 'brick_wall');
    store.setEdge(1, 2, 3, 'S', 'wood_wall');

    assert.strictEqual(store.getEdge(0, 0, 0, 'N'), 'stone_wall');
    assert.strictEqual(store.getEdge(0, 0, 0, 'L'), 'brick_wall');
    assert.strictEqual(store.getEdge(1, 2, 3, 'S'), 'wood_wall');
  });

  it('removeEdge funciona', () => {
    const store = new EdgeStore();
    store.setEdge(0, 0, 0, 'N', 'stone_wall');
    store.removeEdge(0, 0, 0, 'N');
    assert.strictEqual(store.getEdge(0, 0, 0, 'N'), undefined);
  });

  it('removeEdge em aresta inexistente é no-op', () => {
    const store = new EdgeStore();
    store.removeEdge(99, 99, 99, 'O'); // não lança
  });

  it('forEach itera todas as arestas', () => {
    const store = new EdgeStore();
    store.setEdge(0, 0, 0, 'N', 'a');
    store.setEdge(1, 0, 0, 'L', 'b');

    const collected: Array<[number, number, number, EdgeSide, string]> = [];
    store.forEach((x, y, z, lado, tipo) => {
      collected.push([x, y, z, lado, tipo]);
    });

    assert.strictEqual(collected.length, 2);
  });

  it('forEach em store vazio não chama callback', () => {
    const store = new EdgeStore();
    let called = false;
    store.forEach(() => {
      called = true;
    });
    assert.strictEqual(called, false);
  });

  it('toEntries e fromEntries — round-trip', () => {
    const original = new EdgeStore();
    original.setEdge(0, 0, 0, 'N', 'stone_wall');
    original.setEdge(0, 0, 1, 'L', 'brick_wall');
    original.setEdge(3, 5, 2, 'O', 'glass_wall');

    const entries = original.toEntries();
    assert.strictEqual(entries.length, 3);

    const restored = EdgeStore.fromEntries(entries);
    assert.strictEqual(restored.getEdge(0, 0, 0, 'N'), 'stone_wall');
    assert.strictEqual(restored.getEdge(0, 0, 1, 'L'), 'brick_wall');
    assert.strictEqual(restored.getEdge(3, 5, 2, 'O'), 'glass_wall');
  });

  it('toEntries devolve array vazio para store vazio', () => {
    const store = new EdgeStore();
    assert.deepStrictEqual(store.toEntries(), []);
  });

  it('EDGE_SIDES contém as quatro direcções', () => {
    assert.deepStrictEqual(EDGE_SIDES, ['N', 'L', 'S', 'O']);
  });
});

// ---------------------------------------------------------------------------
// validateMapObject — proibição de multi-célula
// ---------------------------------------------------------------------------

describe('validateMapObject — proíbe multi-célula', () => {
  it('objeto válido com uma célula', () => {
    assert.strictEqual(
      validateMapObject({ tipo: 'tree', x: 0, y: 0, z: 0 }),
      true,
    );
  });

  it('rejeita null', () => {
    assert.strictEqual(validateMapObject(null), false);
  });

  it('rejeita não-objeto', () => {
    assert.strictEqual(validateMapObject('string'), false);
    assert.strictEqual(validateMapObject(42), false);
  });

  it('rejeita sem tipo', () => {
    assert.strictEqual(
      validateMapObject({ x: 0, y: 0, z: 0 }),
      false,
    );
  });

  it('rejeita sem x', () => {
    assert.strictEqual(
      validateMapObject({ tipo: 'tree', y: 0, z: 0 }),
      false,
    );
  });

  it('rejeita sem z', () => {
    assert.strictEqual(
      validateMapObject({ tipo: 'tree', x: 0, y: 0 }),
      false,
    );
  });

  it('rejeita com campo cells (multi-célula)', () => {
    assert.strictEqual(
      validateMapObject({
        tipo: 'tree',
        x: 0,
        y: 0,
        z: 0,
        cells: [{ x: 0, y: 0, z: 0 }],
      }),
      false,
    );
  });

  it('rejeita com width/height (multi-célula)', () => {
    assert.strictEqual(
      validateMapObject({
        tipo: 'building',
        x: 0,
        y: 0,
        z: 0,
        width: 2,
        height: 3,
      }),
      false,
    );
  });

  it('rejeita com area (multi-célula)', () => {
    assert.strictEqual(
      validateMapObject({
        tipo: 'zone',
        x: 0,
        y: 0,
        z: 0,
        area: 4,
      }),
      false,
    );
  });

  it('rejeita com size (multi-célula)', () => {
    assert.strictEqual(
      validateMapObject({
        tipo: 'furniture',
        x: 0,
        y: 0,
        z: 0,
        size: 'large',
      }),
      false,
    );
  });

  it('MULTI_CELL_ERROR contém multi-célula', () => {
    assert.ok(MULTI_CELL_ERROR.includes('multi-célula'));
  });
});
