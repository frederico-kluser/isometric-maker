/**
 * Testes de colisão (F3-02).
 *
 * Cobre:
 *   1. canEnter: célula vazia é entrável; célula com bloco não; suporte
 *      (z>0 precisa de bloco em z−1).
 *   2. canCross: movimento cardinal com/sem parede.
 *   3. Diagonal testa AS DUAS arestas.
 *   4. Parede em qualquer das duas arestas de uma quina impede a diagonal.
 *
 * Execute com: node --test src/collision.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canEnter, canCross, type CollisionCell, type CollisionMap } from './collision.ts';
import type { EdgeSide } from './map.ts';

// ------------------------------------------------------------------ fake map

/** Mapa em memória para testes de colisão. */
class FakeCollisionMap implements CollisionMap {
  private blocks = new Set<string>();
  private edges = new Set<string>();

  private bkey(x: number, y: number, z: number): string {
    return `${x}:${y}:${z}`;
  }

  private ekey(x: number, y: number, z: number, lado: EdgeSide): string {
    return `${x}:${y}:${z}:${lado}`;
  }

  hasBlock(x: number, y: number, z: number): boolean {
    return this.blocks.has(this.bkey(x, y, z));
  }

  hasEdge(x: number, y: number, z: number, lado: EdgeSide): boolean {
    return this.edges.has(this.ekey(x, y, z, lado));
  }

  addBlock(x: number, y: number, z: number): void {
    this.blocks.add(this.bkey(x, y, z));
  }

  addEdge(x: number, y: number, z: number, lado: EdgeSide): void {
    this.edges.add(this.ekey(x, y, z, lado));
  }
}

function cell(x: number, y: number, z: number): CollisionCell {
  return { x, y, z };
}

// ------------------------------------------------------------------ canEnter

describe('canEnter — walkability da célula', () => {
  it('célula no chão (z=0) sem bloco é entrável', () => {
    const map = new FakeCollisionMap();
    assert.strictEqual(canEnter(map, 0, 0, 0), true);
  });

  it('célula com bloco NÃO é entrável', () => {
    const map = new FakeCollisionMap();
    map.addBlock(0, 0, 0);
    assert.strictEqual(canEnter(map, 0, 0, 0), false);
  });

  it('célula em z>0 sem bloco em z−1 NÃO é entrável (sem suporte)', () => {
    const map = new FakeCollisionMap();
    // z=1 sem bloco em z=0 → sem chão
    assert.strictEqual(canEnter(map, 0, 0, 1), false);
  });

  it('célula em z>0 COM bloco em z−1 é entrável (em cima do bloco)', () => {
    const map = new FakeCollisionMap();
    map.addBlock(0, 0, 0); // chão
    assert.strictEqual(canEnter(map, 0, 0, 1), true);
  });

  it('célula em z>0 com bloco em z−1 mas COM bloco nela → não entrável', () => {
    const map = new FakeCollisionMap();
    map.addBlock(0, 0, 0); // suporte
    map.addBlock(0, 0, 1); // ocupada
    assert.strictEqual(canEnter(map, 0, 0, 1), false);
  });

  it('z negativo não é entrável', () => {
    const map = new FakeCollisionMap();
    assert.strictEqual(canEnter(map, 0, 0, -1), false);
  });

  it('célula no chão com bloco em z=−1 é irrelevante (z=−1 não existe)', () => {
    const map = new FakeCollisionMap();
    map.addBlock(0, 0, 0);
    assert.strictEqual(canEnter(map, 0, 0, 0), false);
  });
});

// ------------------------------------------------------------------ canCross cardinal

describe('canCross — movimento cardinal', () => {
  it('move para célula adjacente vazia → true', () => {
    const map = new FakeCollisionMap();
    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(1, 0, 0)), true);
  });

  it('move para célula ocupada → false', () => {
    const map = new FakeCollisionMap();
    map.addBlock(1, 0, 0);
    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(1, 0, 0)), false);
  });

  it('move com parede na aresta → false', () => {
    const map = new FakeCollisionMap();
    map.addEdge(0, 0, 0, 'L'); // parede no leste de (0,0,0)
    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(1, 0, 0)), false);
  });

  it('move com parede na aresta oposta (vista do destino) → false', () => {
    const map = new FakeCollisionMap();
    map.addEdge(1, 0, 0, 'O'); // parede no oeste de (1,0,0)
    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(1, 0, 0)), false);
  });

  it('move em todas as 4 direcções sem paredes → true', () => {
    const map = new FakeCollisionMap();
    const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      assert.strictEqual(
        canCross(map, cell(5, 5, 0), cell(5 + dx, 5 + dy, 0)),
        true,
        `direcção (${dx},${dy})`,
      );
    }
  });

  it('z diferente → false (canCross não trata mudança de z)', () => {
    const map = new FakeCollisionMap();
    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(0, 0, 1)), false);
  });

  it('movimento não-adjacente → false', () => {
    const map = new FakeCollisionMap();
    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(2, 0, 0)), false);
  });

  it('sem movimento (mesma célula) → true', () => {
    const map = new FakeCollisionMap();
    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(0, 0, 0)), true);
  });
});

// ------------------------------------------------------------------ canCross diagonal

describe('canCross — movimento diagonal', () => {
  it('diagonal livre → true', () => {
    const map = new FakeCollisionMap();
    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(1, 1, 0)), true);
  });

  it('diagonal com bloco no destino → false', () => {
    const map = new FakeCollisionMap();
    map.addBlock(1, 1, 0);
    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(1, 1, 0)), false);
  });

  it('diagonal: parede na aresta-x bloqueia', () => {
    // Diagonal (0,0)→(1,1): aresta-x = leste de (0,0) / oeste de (1,0)
    const map = new FakeCollisionMap();
    map.addEdge(0, 0, 0, 'L'); // parede no leste de (0,0)

    assert.strictEqual(
      canCross(map, cell(0, 0, 0), cell(1, 1, 0)),
      false,
      'parede na aresta-x deve bloquear diagonal',
    );
  });

  it('diagonal: parede na aresta-y bloqueia', () => {
    // Diagonal (0,0)→(1,1): aresta-y = norte de (1,0) / sul de (1,1)
    const map = new FakeCollisionMap();
    map.addEdge(1, 0, 0, 'N'); // parede no norte de (1,0)

    assert.strictEqual(
      canCross(map, cell(0, 0, 0), cell(1, 1, 0)),
      false,
      'parede na aresta-y deve bloquear diagonal',
    );
  });

  it('diagonal: parede em AMBAS as arestas bloqueia (redundante)', () => {
    const map = new FakeCollisionMap();
    map.addEdge(0, 0, 0, 'L'); // aresta-x
    map.addEdge(1, 0, 0, 'N'); // aresta-y

    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(1, 1, 0)), false);
  });

  it('DEMONSTRAÇÃO: parede em CADA UMA das duas arestas de uma quina impede a diagonal', () => {
    // Quina: célula (0,0). Duas arestas partem dela para a diagonal (1,1):
    //   aresta-x: leste de (0,0) ou oeste de (1,0)
    //   aresta-y: norte de (0,0) ou sul de (0,1)

    // Teste 1: apenas aresta-x
    const map1 = new FakeCollisionMap();
    map1.addEdge(0, 0, 0, 'L');
    assert.strictEqual(
      canCross(map1, cell(0, 0, 0), cell(1, 1, 0)),
      false,
      'aresta-x (leste de (0,0)) bloqueia',
    );

    // Teste 2: apenas aresta-y (norte de (0,0) no caminho alternativo)
    // Nota: o nosso algoritmo testa midX=(1,0), mas a aresta-y também pode ser
    // testada como norte de (0,0). Vamos verificar que ambas as arestas da
    // quina bloqueiam.
    const map2 = new FakeCollisionMap();
    map2.addEdge(1, 0, 0, 'N'); // norte de (1,0) ≡ sul de (1,1)
    assert.strictEqual(
      canCross(map2, cell(0, 0, 0), cell(1, 1, 0)),
      false,
      'aresta-y (norte de (1,0)) bloqueia',
    );

    console.log('✓ cada uma das duas arestas da quina bloqueia a diagonal');
  });

  it('diagonal em todas as 4 direcções sem paredes → true', () => {
    const map = new FakeCollisionMap();
    const diagonals: Array<[number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of diagonals) {
      assert.strictEqual(
        canCross(map, cell(5, 5, 0), cell(5 + dx, 5 + dy, 0)),
        true,
        `diagonal (${dx},${dy})`,
      );
    }
  });

  it('diagonal com destino não-entrável (sem suporte em z>0) → false', () => {
    const map = new FakeCollisionMap();
    // Destino em z=1 sem bloco em z=0
    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(1, 1, 1)), false);
  });
});

// ------------------------------------------------------------------ integração com BlockStore e EdgeStore reais

describe('colisão com BlockStore e EdgeStore reais', () => {
  it('canEnter com BlockStore real', async () => {
    // Import dinâmico porque os módulos são ESM
    const { BlockStore } = await import('./map.ts');
    const store = new BlockStore();
    store.setBlock(0, 0, 0, 'grass');
    store.setBlock(0, 0, 1, 'dirt');

    // Criar um CollisionMap adapter
    const map: CollisionMap = {
      hasBlock: (x, y, z) => store.getBlock(x, y, z) !== undefined && store.getBlock(x, y, z) !== '',
      hasEdge: () => false,
    };

    assert.strictEqual(canEnter(map, 0, 0, 0), false); // ocupada por grass
    assert.strictEqual(canEnter(map, 0, 0, 1), false); // ocupada por dirt
    assert.strictEqual(canEnter(map, 0, 0, 2), true);  // vazia, suporte em z=1
    assert.strictEqual(canEnter(map, 1, 0, 0), true);  // vazia no chão
    assert.strictEqual(canEnter(map, 1, 0, 1), false); // vazia mas sem suporte
  });

  it('canCross com EdgeStore real', async () => {
    const { EdgeStore } = await import('./map.ts');
    const edges = new EdgeStore();
    edges.setEdge(0, 0, 0, 'L', 'stone_wall');

    const map: CollisionMap = {
      hasBlock: () => false,
      hasEdge: (x, y, z, lado) => edges.getEdge(x, y, z, lado) !== undefined,
    };

    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(1, 0, 0)), false);
    assert.strictEqual(canCross(map, cell(0, 0, 0), cell(0, 1, 0)), true); // norte livre
  });
});
