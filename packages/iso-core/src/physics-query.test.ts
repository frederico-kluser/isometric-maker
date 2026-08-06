/**
 * Testes da API de consulta ao mundo físico: raycast, overlap, sweep.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type CollisionMap } from './collision.ts';
import type { EdgeSide } from './map.ts';
import {
  raycast,
  overlap,
  overlapMap,
  sweep,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Length,
  vec3Normalize,
  type Vec3,
  type OverlapEntity,
} from './physics-query.ts';
import { entityAabb, type EntityBox } from './collision-box.ts';
import type { GridAabb } from './map-instances.ts';

// ------------------------------------------------------------------ duplo

class FakeMap implements CollisionMap {
  readonly #blocks = new Set<string>();

  hasBlock(x: number, y: number, z: number): boolean {
    return this.#blocks.has(`${x}:${y}:${z}`);
  }

  hasEdge(_x: number, _y: number, _z: number, _lado: EdgeSide): boolean {
    return false;
  }

  solidAt(x: number, y: number, z: number): boolean {
    return this.hasBlock(x, y, z);
  }

  addBlock(x: number, y: number, z: number): this {
    this.#blocks.add(`${x}:${y}:${z}`);
    return this;
  }
}

// ------------------------------------------------------------------ vec3

describe('vec3', () => {
  it('vec3Add soma dois vetores', () => {
    const r = vec3Add({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    assert.deepStrictEqual(r, { x: 5, y: 7, z: 9 });
  });

  it('vec3Sub subtrai dois vetores', () => {
    const r = vec3Sub({ x: 5, y: 7, z: 9 }, { x: 1, y: 2, z: 3 });
    assert.deepStrictEqual(r, { x: 4, y: 5, z: 6 });
  });

  it('vec3Scale multiplica por escalar', () => {
    const r = vec3Scale({ x: 1, y: 2, z: 3 }, 2);
    assert.deepStrictEqual(r, { x: 2, y: 4, z: 6 });
  });

  it('vec3Length calcula magnitude', () => {
    assert.equal(vec3Length({ x: 3, y: 4, z: 0 }), 5);
  });

  it('vec3Normalize normaliza', () => {
    const n = vec3Normalize({ x: 3, y: 0, z: 0 });
    assert.ok(Math.abs(n.x - 1) < 1e-10);
    assert.ok(Math.abs(n.y) < 1e-10);
    assert.ok(Math.abs(n.z) < 1e-10);
  });

  it('vec3Normalize de vetor zero devolve zero', () => {
    const n = vec3Normalize({ x: 0, y: 0, z: 0 });
    assert.deepStrictEqual(n, { x: 0, y: 0, z: 0 });
  });
});

// ------------------------------------------------------------------ raycast

describe('raycast', () => {
  it('atinge bloco diretamente à frente', () => {
    const map = new FakeMap().addBlock(3, 0, 0);
    const result = raycast(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      10,
      map,
    );
    assert.notEqual(result.hit, null);
    assert.deepStrictEqual(result.hit, { x: 3, y: 0, z: 0 });
    // A normal deve apontar para -x (o raio veio de +x → -x? não: veio de 0 para +3)
    // O raio bate na face oeste do bloco em (3,0,0). A normal é (-1, 0, 0).
    assert.deepStrictEqual(result.normal, { x: -1, y: 0, z: 0 });
  });

  it('não atinge nada em espaço vazio', () => {
    const map = new FakeMap();
    const result = raycast(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      10,
      map,
    );
    assert.equal(result.hit, null);
  });

  it('respeita maxDistance', () => {
    const map = new FakeMap().addBlock(5, 0, 0);
    const result = raycast(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      2, // só vai até x=2
      map,
    );
    assert.equal(result.hit, null);
  });

  it('direção zero não crasha', () => {
    const map = new FakeMap().addBlock(5, 0, 0);
    const result = raycast(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      10,
      map,
    );
    assert.equal(result.hit, null);
  });

  it('raio diagonal atinge bloco', () => {
    const map = new FakeMap().addBlock(2, 2, 1);
    const result = raycast(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0.5 },
      10,
      map,
    );
    assert.notEqual(result.hit, null);
    assert.equal(result.hit!.x, 2);
    assert.equal(result.hit!.y, 2);
    assert.equal(result.hit!.z, 1);
  });

  it('raio para baixo (z negativo) atinge bloco', () => {
    const map = new FakeMap().addBlock(1, 1, 0);
    const result = raycast(
      { x: 1.5, y: 1.5, z: 3 },
      { x: 0, y: 0, z: -1 },
      10,
      map,
    );
    assert.notEqual(result.hit, null);
    assert.equal(result.hit!.z, 0);
  });

  it('raio começa dentro de um bloco — devolve esse bloco', () => {
    const map = new FakeMap().addBlock(1, 1, 1);
    const result = raycast(
      { x: 1.5, y: 1.5, z: 1.2 },
      { x: 1, y: 0, z: 0 },
      10,
      map,
    );
    assert.notEqual(result.hit, null);
    assert.equal(result.hit!.x, 1);
    assert.equal(result.hit!.y, 1);
    assert.equal(result.hit!.z, 1);
    assert.equal(result.distance, 0);
  });
});

// ------------------------------------------------------------------ overlap

describe('overlap', () => {
  it('devolve entidades que intersectam a caixa', () => {
    const entities: OverlapEntity[] = [
      { kind: 'block', x: 2, y: 2, z: 0, half: 0.5 },
      { kind: 'block', x: 5, y: 5, z: 0, half: 0.5 },
    ];
    const aabb: GridAabb = {
      minX: 1.5, minY: 1.5, minZ: 0,
      maxX: 2.5, maxY: 2.5, maxZ: 1,
    };
    const result = overlap(aabb, entities);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.x, 2);
  });

  it('devolve vazio se nada intersecta', () => {
    const entities: OverlapEntity[] = [
      { kind: 'block', x: 5, y: 5, z: 0, half: 0.5 },
    ];
    const aabb: GridAabb = {
      minX: 0, minY: 0, minZ: 0,
      maxX: 1, maxY: 1, maxZ: 1,
    };
    const result = overlap(aabb, entities);
    assert.equal(result.length, 0);
  });
});

describe('overlapMap', () => {
  it('devolve células ocupadas do mapa que intersectam a caixa', () => {
    const map = new FakeMap()
      .addBlock(1, 1, 0)
      .addBlock(2, 2, 0)
      .addBlock(1, 1, 1);
    const aabb: GridAabb = {
      minX: 0.5, minY: 0.5, minZ: 0,
      maxX: 1.5, maxY: 1.5, maxZ: 1,
    };
    const result = overlapMap(aabb, map);
    // Deve incluir (1,1,0) mas não (2,2,0) nem (1,1,1) (fora de maxZ=1).
    assert.ok(result.some((c) => c.x === 1 && c.y === 1 && c.z === 0));
  });
});

// ------------------------------------------------------------------ sweep

describe('sweep', () => {
  it('sweep sem obstáculo devolve time=1', () => {
    const map = new FakeMap();
    const box: EntityBox = { cx: 1, cy: 1, z: 0, half: 0.5 };
    const result = sweep(box, { x: 3, y: 0, z: 0 }, map);
    assert.equal(result.hit, null);
    assert.equal(result.time, 1);
  });

  it('sweep contra parede devolve tempo de colisão < 1', () => {
    const map = new FakeMap().addBlock(3, 0, 0);
    const box: EntityBox = { cx: 0.5, cy: 0.5, z: 0, half: 0.5 };
    // Caixa de [0,1] em X. Velocidade +3 em X.
    // A face dianteira começa em maxX=1 e vai até 4.
    // Bloco em (3,0,0) é atingido quando a face chega a 3 → deslocamento = 2.
    // tempo = 2/3 ≈ 0.667
    const result = sweep(box, { x: 3, y: 0, z: 0 }, map);
    assert.notEqual(result.hit, null);
    assert.ok(result.time < 1 && result.time > 0, `tempo=${result.time}`);
    assert.deepStrictEqual(result.normal, { x: -1, y: 0, z: 0 });
  });

  it('sweep em Y também funciona', () => {
    const map = new FakeMap().addBlock(0, 5, 0);
    const box: EntityBox = { cx: 0.5, cy: 0.5, z: 0, half: 0.5 };
    const result = sweep(box, { x: 0, y: 5, z: 0 }, map);
    assert.notEqual(result.hit, null);
    assert.ok(result.time < 1 && result.time > 0);
    assert.deepStrictEqual(result.normal, { x: 0, y: -1, z: 0 });
  });

  it('sweep em diagonal desliza corretamente', () => {
    // Parede em x=5 que bloqueia o movimento em X mas não em Y.
    // O bloco precisa estar no alcance Y da caixa (box half=0.5 → y in [0,1)).
    const map = new FakeMap().addBlock(5, 0, 0);
    const box: EntityBox = { cx: 0.5, cy: 0.5, z: 0, half: 0.5 };
    const result = sweep(box, { x: 10, y: 1, z: 0 }, map);
    // Deve bater na parede em X antes de chegar ao fim.
    assert.notEqual(result.hit, null);
    assert.ok(result.time > 0 && result.time < 1);
  });

  it('sweep com velocidade zero não colide', () => {
    const map = new FakeMap().addBlock(1, 1, 0);
    const box: EntityBox = { cx: 0.5, cy: 0.5, z: 0, half: 0.5 };
    const result = sweep(box, { x: 0, y: 0, z: 0 }, map);
    assert.equal(result.hit, null);
    assert.equal(result.time, 1);
  });
});
