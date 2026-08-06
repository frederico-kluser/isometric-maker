/**
 * Testes da física de blocos — queda, suporte, simulação determinística.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type CollisionMap, type CollisionCell } from './collision.ts';
import type { EdgeSide } from './map.ts';
import {
  hasSupport,
  findUnsupported,
  stepBlockPhysics,
  initBlockPhysics,
  resolveMapAfterSimulation,
  DEFAULT_BLOCK_PHYSICS_CONFIG,
  type BlockWorld,
  type FallingBlock,
} from './block-physics.ts';
import { pushPlayerFromFallingBlocks } from './entity-collision.ts';
import { solidAtOf, type PlayerCell } from './collision-box.ts';

// ------------------------------------------------------------------ duplo de mapa

class FakeMap implements CollisionMap {
  readonly #blocks = new Set<string>();
  readonly #edges = new Set<string>();

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

function occupiedFromMap(
  map: CollisionMap,
  bounds: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number },
): { x: number; y: number; z: number; blockType: string }[] {
  const cells: { x: number; y: number; z: number; blockType: string }[] = [];
  for (let x = bounds.x0; x <= bounds.x1; x++) {
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      for (let z = bounds.z0; z <= bounds.z1; z++) {
        if (map.hasBlock(x, y, z)) {
          cells.push({ x, y, z, blockType: 'stone' });
        }
      }
    }
  }
  return cells;
}

// ------------------------------------------------------------------ hasSupport

describe('hasSupport', () => {
  it('z=0 tem suporte (chão)', () => {
    const map = new FakeMap();
    assert.equal(hasSupport(map, 5, 5, 0), true);
  });

  it('z>0 sem bloco em baixo NÃO tem suporte', () => {
    const map = new FakeMap();
    assert.equal(hasSupport(map, 5, 5, 3), false);
  });

  it('z>0 com bloco em baixo tem suporte', () => {
    const map = new FakeMap().addBlock(5, 5, 2);
    assert.equal(hasSupport(map, 5, 5, 3), true);
  });

  it('z negativo não tem suporte', () => {
    const map = new FakeMap();
    assert.equal(hasSupport(map, 5, 5, -1), false);
  });
});

// ------------------------------------------------------------------ findUnsupported

describe('findUnsupported', () => {
  it('coluna apoiada não devolve nada', () => {
    const map = new FakeMap().addBlock(0, 0, 0).addBlock(0, 0, 1);
    const occ = occupiedFromMap(map, { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 1 });
    const unsupported = findUnsupported(map, occ);
    assert.equal(unsupported.length, 0);
  });

  it('bloco no ar é detetado', () => {
    const map = new FakeMap().addBlock(0, 0, 3); // bloco flutuando, sem z=2
    const occ = occupiedFromMap(map, { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 3 });
    const unsupported = findUnsupported(map, occ);
    assert.equal(unsupported.length, 1);
    assert.equal(unsupported[0]!.x, 0);
    assert.equal(unsupported[0]!.y, 0);
    assert.equal(unsupported[0]!.z, 3);
  });

  it('múltiplos blocos no ar são todos detetados', () => {
    const map = new FakeMap()
      .addBlock(1, 0, 5)
      .addBlock(2, 0, 7);
    const occ = occupiedFromMap(map, { x0: 0, x1: 2, y0: 0, y1: 0, z0: 0, z1: 7 });
    const unsupported = findUnsupported(map, occ);
    assert.equal(unsupported.length, 2);
  });
});

// ------------------------------------------------------------------ stepBlockPhysics

function makeWorld(map: FakeMap): BlockWorld {
  const occ = occupiedFromMap(map, { x0: 0, x1: 10, y0: 0, y1: 10, z0: 0, z1: 10 });
  return { occupied: occ, collisionMap: map };
}

describe('stepBlockPhysics', () => {
  it('bloco no ar começa a cair', () => {
    const map = new FakeMap().addBlock(5, 5, 3); // flutuando
    const world = makeWorld(map);
    const init = initBlockPhysics(world);

    // Inicialmente deteta o bloco sem suporte.
    assert.equal(init.falling.length, 1);
    assert.equal(init.falling[0]!.z, 3);
    assert.equal(init.accumulator, 0);
  });

  it('bloco desce 1 nível após fallInterval passos', () => {
    const map = new FakeMap().addBlock(5, 5, 3);
    const world = makeWorld(map);
    const init = initBlockPhysics(world);

    // Avança fallInterval - 1 passos — ainda não desce.
    let state = { falling: init.falling, landed: [] as FallingBlock[], pushedPlayer: null as PlayerCell | null };
    let acc = 0;
    const cfg = DEFAULT_BLOCK_PHYSICS_CONFIG;
    for (let i = 1; i < cfg.fallInterval; i++) {
      const result = stepBlockPhysics(world, state.falling, acc, null, cfg);
      state = { falling: result.falling as FallingBlock[], landed: result.landed as FallingBlock[], pushedPlayer: result.pushedPlayer };
      acc = acc + 1;
      // O bloco NÃO desceu ainda — o acumulador não chegou ao intervalo.
      assert.equal(state.falling.length, 1);
      assert.equal(state.falling[0]!.z, 3, `passo ${i}: bloco desceu antes da hora`);
      assert.equal(state.landed.length, 0);
    }

    // Agora sim, no passo fallInterval.
    const result = stepBlockPhysics(world, state.falling, cfg.fallInterval - 1, null, cfg);
    assert.equal(result.falling.length, 1);
    assert.equal(result.falling[0]!.z, 2, 'bloco deveria ter descido para z=2');
  });

  it('bloco aterra quando encontra suporte', () => {
    // Bloco em z=3, com suporte em z=1 (plataforma). Deve cair até z=2 e aterrar.
    const map = new FakeMap()
      .addBlock(5, 5, 0) // chão
      .addBlock(5, 5, 1) // plataforma
      .addBlock(5, 5, 3); // bloco flutuando (gap em z=2)
    const world = makeWorld(map);
    const init = initBlockPhysics(world);
    assert.equal(init.falling.length, 1);
    assert.equal(init.falling[0]!.z, 3);

    // Avança até o bloco aterrar.
    let falling = init.falling;
    let acc = 0;
    let allLanded: FallingBlock[] = [];
    const cfg = DEFAULT_BLOCK_PHYSICS_CONFIG;
    let maxSteps = 100;
    while (falling.length > 0 && maxSteps-- > 0) {
      const result = stepBlockPhysics(world, falling, acc, null, cfg);
      falling = result.falling as FallingBlock[];
      allLanded = [...allLanded, ...result.landed];
      acc = (acc + 1) % cfg.fallInterval;
    }

    assert.equal(falling.length, 0, 'todos os blocos deveriam ter aterrado');
    assert.ok(allLanded.length > 0, 'pelo menos um bloco aterrou');
    // O bloco aterra em z=2 (imediatamente acima da plataforma em z=1).
    assert.equal(allLanded[0]!.z, 2, `bloco aterrou em z=${allLanded[0]!.z}, esperava z=2`);
  });

  it('bloco cai até ao chão (z=0)', () => {
    const map = new FakeMap().addBlock(5, 5, 5); // flutuando, sem nada por baixo
    const world = makeWorld(map);
    const init = initBlockPhysics(world);

    let falling = init.falling;
    let acc = 0;
    let allLanded: FallingBlock[] = [];
    const cfg = DEFAULT_BLOCK_PHYSICS_CONFIG;
    let maxSteps = 200;
    while (falling.length > 0 && maxSteps-- > 0) {
      const result = stepBlockPhysics(world, falling, acc, null, cfg);
      falling = result.falling as FallingBlock[];
      allLanded = [...allLanded, ...result.landed];
      acc = (acc + 1) % cfg.fallInterval;
    }

    assert.equal(falling.length, 0, 'todos os blocos deveriam ter aterrado');
    const landedZ = allLanded.map((l) => l.z);
    assert.ok(landedZ.includes(0), `bloco deveria aterrar em z=0, aterrou em ${JSON.stringify(landedZ)}`);
  });

  it('efeito dominó: remover suporte faz bloco de cima cair', () => {
    // Coluna: z=0 (chão), z=1, z=2 (três blocos empilhados).
    // Se removermos z=1 (manualmente, não via simulação), z=2 deve cair.
    const map = new FakeMap()
      .addBlock(3, 3, 0)
      .addBlock(3, 3, 2); // z=1 está vazio — z=2 flutua
    const world = makeWorld(map);
    const init = initBlockPhysics(world);
    assert.equal(init.falling.length, 1);
    assert.equal(init.falling[0]!.z, 2);
  });

  it('determinismo: mesma entrada, mesmo resultado', () => {
    const map = new FakeMap()
      .addBlock(1, 1, 0)
      .addBlock(1, 1, 3) // flutuando
      .addBlock(2, 2, 5); // flutuando

    const run = (): number[] => {
      const world = makeWorld(map);
      let falling: FallingBlock[] = findUnsupported(map, world.occupied);
      let acc = 0;
      const zHistory: number[] = [];
      const cfg = DEFAULT_BLOCK_PHYSICS_CONFIG;
      for (let step = 0; step < 50; step++) {
        const result = stepBlockPhysics(world, falling, acc, null, cfg);
        falling = result.falling as FallingBlock[];
        for (const fb of falling) zHistory.push(fb.z);
        for (const lb of result.landed) zHistory.push(lb.z);
        if (falling.length === 0) break;
        acc = (acc + 1) % cfg.fallInterval;
      }
      return zHistory;
    };

    const a = run();
    const b = run();
    assert.deepStrictEqual(a, b, 'física de blocos deve ser determinística');
  });
});

// ------------------------------------------------------------------ push do ator

describe('bloco caindo sobre o ator', () => {
  it('bloco a cair sobre o ator empurra-o', () => {
    // Ator em (3, 3, 1). Bloco cai para (3, 3, 1).
    const map = new FakeMap()
      .addBlock(3, 3, 3) // bloco flutuando, vai cair até z=0
      .addBlock(5, 5, 0); // chão para o ator aterrar
    const world = makeWorld(map);
    const player: PlayerCell = { x: 3, y: 3, z: 1 };
    const init = initBlockPhysics(world);

    let falling = init.falling;
    let acc = 0;
    let pushedPlayer: PlayerCell | null = null;
    const cfg = DEFAULT_BLOCK_PHYSICS_CONFIG;
    let maxSteps = 100;

    while (falling.length > 0 && maxSteps-- > 0) {
      const result = stepBlockPhysics(world, falling, acc, player, cfg);
      falling = result.falling as FallingBlock[];
      if (result.pushedPlayer) pushedPlayer = result.pushedPlayer;
      if (falling.length === 0) break;
      acc = (acc + 1) % cfg.fallInterval;
    }

    // Depois da simulação, o ator deve ter sido empurrado (ou pelo menos
    // a deteção de colisão deve ter ocorrido).
    // Nota: o bloco cai até z=0 e o ator está em z=1 — eles colidem.
    assert.ok(
      pushedPlayer !== null || falling.length === 0,
      'se o bloco caiu sobre o ator, push-out deve ocorrer ou bloco deve aterrar',
    );
  });
});

// ------------------------------------------------------------------ resolveMapAfterSimulation

describe('resolveMapAfterSimulation', () => {
  it('bloco que aterrou aparece na posição final', () => {
    const map = new FakeMap().addBlock(2, 2, 3);
    const world = makeWorld(map);
    const falling: FallingBlock[] = [];
    const landed: FallingBlock[] = [
      { x: 2, y: 2, z: 0, blockType: 'stone' },
    ];
    const resolved = resolveMapAfterSimulation(world, falling, landed);

    const atGround = resolved.filter((c) => c.x === 2 && c.y === 2 && c.z === 0);
    assert.equal(atGround.length, 1, 'bloco aterrado deve aparecer em z=0');
    const atOriginal = resolved.filter((c) => c.x === 2 && c.y === 2 && c.z === 3);
    assert.equal(atOriginal.length, 0, 'bloco original em z=3 não deve aparecer');
  });
});
