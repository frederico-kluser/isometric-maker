/**
 * Testes de degrau automático (F3-03).
 *
 * Verifica:
 *   1. z+1 sobe.
 *   2. z+2 NÃO sobe.
 *   3. z+1 com parede na aresta NÃO sobe.
 *   4. Descida de z−1 e z−3.
 *   5. Descida para z igual ou superior NÃO desce.
 *   6. Destino não-entrável bloqueia.
 *
 * Execute com: node --test src/step-up.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canStepUp, canStepDown } from './step-up.ts';
import type { CollisionCell, CollisionMap } from './collision.ts';
import type { EdgeSide } from './map.ts';

// ------------------------------------------------------------------ fake map

class FakeStepMap implements CollisionMap {
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

// ------------------------------------------------------------------ canStepUp

describe('canStepUp — sobe exactamente um nível', () => {
  it('z+1 com chão no destino → true', () => {
    const map = new FakeStepMap();
    map.addBlock(1, 0, 0); // chão para suporte

    // from=(0,0,0), to=(1,0,1) — z+1, destino entrável (chão em z=0)
    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(1, 0, 1)), true);
  });

  it('z+2 NÃO sobe', () => {
    const map = new FakeStepMap();
    map.addBlock(1, 0, 0);
    map.addBlock(1, 0, 1); // suporte para z=2

    // from=(0,0,0), to=(1,0,2) — z+2
    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(1, 0, 2)), false);
  });

  it('z+1 sem suporte no destino NÃO sobe', () => {
    const map = new FakeStepMap();
    // Sem bloco em (1,0,0) → sem suporte para z=1
    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(1, 0, 1)), false);
  });

  it('z+1 com bloco no destino NÃO sobe', () => {
    const map = new FakeStepMap();
    map.addBlock(1, 0, 0); // suporte
    map.addBlock(1, 0, 1); // ocupado!

    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(1, 0, 1)), false);
  });

  it('z+1 com parede na aresta NÃO sobe', () => {
    const map = new FakeStepMap();
    map.addBlock(1, 0, 0); // suporte para z=1
    map.addEdge(0, 0, 0, 'L'); // parede entre (0,0) e (1,0)

    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(1, 0, 1)), false);
  });

  it('z+1 com parede na aresta (vista do destino) NÃO sobe', () => {
    const map = new FakeStepMap();
    map.addBlock(1, 0, 0);
    map.addEdge(1, 0, 0, 'O'); // parede no oeste de (1,0)

    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(1, 0, 1)), false);
  });

  it('z+1 com aresta livre → true (várias direcções)', () => {
    const map = new FakeStepMap();
    // Chão em várias células
    map.addBlock(1, 0, 0);
    map.addBlock(0, 1, 0);
    map.addBlock(-1, 0, 0);
    map.addBlock(0, -1, 0);

    // Todas as 4 direcções cardinais
    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(1, 0, 1)), true);
    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(0, 1, 1)), true);
    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(-1, 0, 1)), true); // L de (-1,0) ≡ O de (0,0)
    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(0, -1, 1)), true); // N de (0,-1) ≡ S de (0,0)
  });

  it('z+0 (mesmo nível) NÃO é step-up', () => {
    const map = new FakeStepMap();
    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(1, 0, 0)), false);
  });

  it('z−1 (descer) NÃO é step-up', () => {
    const map = new FakeStepMap();
    map.addBlock(1, 0, 0);
    assert.strictEqual(canStepUp(map, cell(0, 0, 1), cell(1, 0, 0)), false);
  });

  it('destino não-adjacente NÃO sobe', () => {
    const map = new FakeStepMap();
    map.addBlock(2, 0, 0);
    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(2, 0, 1)), false);
  });

  it('z+1 com destino em z negativo → false', () => {
    const map = new FakeStepMap();
    // from z=-1, to z=0 → z+1, mas z=-1 não tem suporte
    assert.strictEqual(canStepUp(map, cell(0, 0, -1), cell(0, 0, 0)), false);
  });
});

// ------------------------------------------------------------------ canStepDown

describe('canStepDown — desce um ou mais níveis', () => {
  it('z−1 com chão no destino → true', () => {
    const map = new FakeStepMap();
    // from=(0,0,1), to=(1,0,0) — desce um nível
    assert.strictEqual(canStepDown(map, cell(0, 0, 1), cell(1, 0, 0)), true);
  });

  it('z−3 (descer três níveis) → true', () => {
    const map = new FakeStepMap();
    // from=(0,0,3), to=(1,0,0) — desce 3 níveis
    assert.strictEqual(canStepDown(map, cell(0, 0, 3), cell(1, 0, 0)), true);
  });

  it('z+1 (subir) NÃO é step-down', () => {
    const map = new FakeStepMap();
    map.addBlock(1, 0, 0);
    assert.strictEqual(canStepDown(map, cell(0, 0, 0), cell(1, 0, 1)), false);
  });

  it('mesmo nível NÃO é step-down', () => {
    const map = new FakeStepMap();
    assert.strictEqual(canStepDown(map, cell(0, 0, 0), cell(1, 0, 0)), false);
  });

  it('z−1 com bloco no destino NÃO desce', () => {
    const map = new FakeStepMap();
    map.addBlock(1, 0, 0); // ocupado
    assert.strictEqual(canStepDown(map, cell(0, 0, 1), cell(1, 0, 0)), false);
  });

  it('z−1 com parede na aresta NÃO desce', () => {
    const map = new FakeStepMap();
    // Parede em from.z (z=1) bloqueia
    map.addEdge(0, 0, 1, 'L'); // parede entre (0,0) e (1,0) ao nível z=1
    assert.strictEqual(canStepDown(map, cell(0, 0, 1), cell(1, 0, 0)), false);
  });

  it('z−1 com aresta livre → true (várias direcções)', () => {
    const map = new FakeStepMap();
    // Suporte para z=1: blocos em z=0 nas células de destino
    map.addBlock(1, 0, 0);
    map.addBlock(0, 1, 0);
    map.addBlock(-1, 0, 0);
    map.addBlock(0, -1, 0);

    // Todas as 4 direcções cardinais descendo de z=2 para z=1
    assert.strictEqual(canStepDown(map, cell(0, 0, 2), cell(1, 0, 1)), true);
    assert.strictEqual(canStepDown(map, cell(0, 0, 2), cell(0, 1, 1)), true);
    assert.strictEqual(canStepDown(map, cell(0, 0, 2), cell(-1, 0, 1)), true);
    assert.strictEqual(canStepDown(map, cell(0, 0, 2), cell(0, -1, 1)), true);
  });

  it('z−1 sem suporte no destino NÃO desce', () => {
    const map = new FakeStepMap();
    // from z=2, to z=1 — mas z=1 não tem bloco em z=0
    assert.strictEqual(canStepDown(map, cell(0, 0, 2), cell(1, 0, 1)), false);
  });

  it('destino não-adjacente NÃO desce', () => {
    const map = new FakeStepMap();
    assert.strictEqual(canStepDown(map, cell(0, 0, 1), cell(2, 0, 0)), false);
  });
});

// ------------------------------------------------------------------ integração

describe('step-up/down com canEnter/canCross reais', () => {
  it('step-up + step-down: sobe e desce no mesmo degrau', () => {
    const map = new FakeStepMap();
    map.addBlock(1, 0, 0); // suporte para z=1

    // Sobe
    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(1, 0, 1)), true);

    // Desce de volta
    assert.strictEqual(canStepDown(map, cell(1, 0, 1), cell(0, 0, 0)), true);
  });

  it('z+1 com suporte em z=0 (chão) e destino entrável → true', () => {
    const map = new FakeStepMap();
    // from=(0,0,0), to=(1,0,1)
    // Destino z=1: precisa de bloco em z=0 para suporte
    map.addBlock(1, 0, 0);
    assert.strictEqual(canStepUp(map, cell(0, 0, 0), cell(1, 0, 1)), true);
  });

  it('z+1 com destino em cima de bloco (z>0) → true', () => {
    const map = new FakeStepMap();
    map.addBlock(1, 0, 3); // suporte
    // from=(0,0,3), to=(1,0,4)
    assert.strictEqual(canStepUp(map, cell(0, 0, 3), cell(1, 0, 4)), true);
  });
});
