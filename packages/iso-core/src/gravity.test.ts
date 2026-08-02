/**
 * Testes de gravidade e queda.
 *
 * Cobre:
 *   1. `groundZAt` — topo sólido, coluna vazia, já apoiado, ar interior,
 *      caso degenerado (dentro de sólido).
 *   2. `fallStep` — ritmo de descida, paragem no solo, z sempre inteiro.
 *   3. `step` com mapa — queda ao longo do tempo, e o pulo que deixa de
 *      ficar preso em `z + jumpHeight`.
 *   4. `step` sem mapa — comportamento histórico preservado.
 *
 * Execute com: node --test src/gravity.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groundZAt, fallStep, isSupported } from './gravity.ts';
import type { CollisionMap } from './collision.ts';
import type { EdgeSide } from './map.ts';
import {
  step,
  createMovementState,
  DEFAULT_CONFIG,
  type MovementInput,
  type MovementState,
} from './movement.ts';

// ------------------------------------------------------------------ fake map

class FakeGravityMap implements CollisionMap {
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

  /** Empilha `count` blocos a partir de z=0. Topo sólido fica em `count`. */
  addColumn(x: number, y: number, count: number): void {
    for (let z = 0; z < count; z++) this.addBlock(x, y, z);
  }
}

// ------------------------------------------------------------------ helpers

function noInput(): MovementInput {
  return { dir: { x: 0, y: 0 }, jump: false, stepUp: false, stepDown: false };
}

function jumpInput(): MovementInput {
  return { dir: { x: 0, y: 0 }, jump: true, stepUp: false, stepDown: false };
}

function simulate(
  initial: MovementState,
  input: MovementInput,
  steps: number,
  map?: CollisionMap,
): MovementState {
  let state = initial;
  for (let i = 0; i < steps; i++) {
    state = step(state, input, DEFAULT_CONFIG.fixedDt, DEFAULT_CONFIG, map);
  }
  return state;
}

// ------------------------------------------------------------------ groundZAt

describe('groundZAt — o solo de uma coluna', () => {
  it('cai até ao topo sólido: 2 blocos → aterra em z=2', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 2); // blocos em z=0 e z=1; topo sólido em z=2
    assert.strictEqual(groundZAt(map, 0, 0, 3), 2);
    assert.strictEqual(groundZAt(map, 0, 0, 9), 2);
  });

  it('coluna vazia → aterra em z=0 (plano de chão)', () => {
    const map = new FakeGravityMap();
    assert.strictEqual(groundZAt(map, 5, 5, 7), 0);
  });

  it('já apoiado → devolve o próprio z, não desce', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 1); // bloco em z=0
    assert.strictEqual(groundZAt(map, 0, 0, 1), 1);
    assert.strictEqual(isSupported(map, 0, 0, 1), true);
  });

  it('ar interior: bloco solto em z=5 não serve de solo — cai até z=0', () => {
    const map = new FakeGravityMap();
    map.addBlock(0, 0, 5); // z=0..4 são ar
    // `heightAt-1` diria 5; a resposta certa é 0, o único nível com suporte.
    assert.strictEqual(groundZAt(map, 0, 0, 3), 0);
    // Acima do bloco solto, z=6 é apoiado e não há queda.
    assert.strictEqual(groundZAt(map, 0, 0, 6), 6);
  });

  it('dentro de sólido (caso degenerado) → devolve fromZ, não inventa saída', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 2); // blocos em z=0 e z=1
    // z=1 está ocupado por bloco e z=0 também: nenhuma célula é entrável.
    assert.strictEqual(groundZAt(map, 0, 0, 1), 1);
  });

  it('z negativo é elevado a 0', () => {
    const map = new FakeGravityMap();
    assert.strictEqual(groundZAt(map, 0, 0, -4), 0);
  });
});

// ------------------------------------------------------------------ fallStep

describe('fallStep — a queda tem ritmo, não é teletransporte', () => {
  // dt e fallSpeed escolhidos para serem exactos em binário: 0.25 * 4 = 1.
  const DT = 0.25;
  const SPEED = 4; // 1 nível por chamada

  it('desce exactamente um nível por intervalo', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 1); // topo sólido em z=1

    const r1 = fallStep(map, 0, 0, 4, 0, DT, SPEED);
    assert.strictEqual(r1.z, 3);
    assert.strictEqual(r1.falling, true);
    assert.strictEqual(r1.groundZ, 1);

    const r2 = fallStep(map, 0, 0, r1.z, r1.fallProgress, DT, SPEED);
    assert.strictEqual(r2.z, 2);
    assert.strictEqual(r2.falling, true);
  });

  it('meio intervalo não desce nível nenhum — acumula progresso', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 1);

    const r = fallStep(map, 0, 0, 4, 0, 0.125, SPEED); // 0.5 nível
    assert.strictEqual(r.z, 4, 'z não pode mudar com meio nível acumulado');
    assert.strictEqual(r.falling, true);
    assert.strictEqual(r.fallProgress, 0.5);
  });

  it('pára no solo e zera o acumulador — nunca atravessa', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 1); // topo sólido em z=1

    let z = 3;
    let progress = 0;
    for (let i = 0; i < 20; i++) {
      const r = fallStep(map, 0, 0, z, progress, DT, SPEED);
      z = r.z;
      progress = r.fallProgress;
      assert.ok(z >= 1, `z=${z} passou abaixo do solo`);
      assert.ok(Number.isInteger(z), `z=${z} não é inteiro`);
    }
    assert.strictEqual(z, 1);
    assert.strictEqual(progress, 0);
    assert.strictEqual(fallStep(map, 0, 0, z, progress, DT, SPEED).falling, false);
  });

  it('célula apoiada não cai', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 1);
    const r = fallStep(map, 0, 0, 1, 0, DT, SPEED);
    assert.strictEqual(r.z, 1);
    assert.strictEqual(r.falling, false);
    assert.strictEqual(r.fallProgress, 0);
  });

  it('uma queda grande num único intervalo não passa do solo', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 2); // topo sólido em z=2
    // 10 níveis de progresso num só passo, mas só há 8 para descer.
    const r = fallStep(map, 0, 0, 10, 0, 1, 10);
    assert.strictEqual(r.z, 2);
    assert.strictEqual(r.falling, false);
  });
});

// ------------------------------------------------------------------ step com mapa

describe('step com mapa — gravidade no motor de movimento', () => {
  it('em z=3 sem suporte cai até ao topo sólido da coluna', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 2); // topo sólido em z=2

    const s0 = createMovementState(0, 0, 3);
    // A meio da queda ainda está em z=3 e já se sabe que está a cair.
    const meio = simulate(s0, noInput(), 2, map);
    assert.strictEqual(meio.z, 3, 'a queda não pode ser instantânea');
    assert.strictEqual(meio.falling, true, 'falling tem de ser observável');

    const fim = simulate(s0, noInput(), 60, map); // 1 s
    assert.strictEqual(fim.z, 2, 'devia ter aterrado no topo sólido');
    assert.strictEqual(fim.falling, false);
    assert.strictEqual(fim.fallProgress, 0);
  });

  it('sobre o vazio cai até z=0 (plano de chão) e pára lá', () => {
    const map = new FakeGravityMap();
    const s0 = createMovementState(0, 0, 5);

    const fim = simulate(s0, noInput(), 120, map); // 2 s
    assert.strictEqual(fim.z, 0);
    assert.strictEqual(fim.falling, false);
  });

  it('z é inteiro em todos os instantes da queda', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 1);

    let state = createMovementState(0, 0, 6);
    for (let i = 0; i < 90; i++) {
      state = step(state, noInput(), DEFAULT_CONFIG.fixedDt, DEFAULT_CONFIG, map);
      assert.ok(Number.isInteger(state.z), `z=${state.z} não é inteiro`);
    }
    assert.strictEqual(state.z, 1);
  });

  it('quem está apoiado não cai', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 1); // topo sólido em z=1

    const fim = simulate(createMovementState(0, 0, 1), noInput(), 60, map);
    assert.strictEqual(fim.z, 1);
    assert.strictEqual(fim.falling, false);
  });

  it('o pulo já não fica preso no ar — a gravidade devolve-o ao topo sólido', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 1); // topo sólido em z=1; personagem parte de z=1

    const s0 = createMovementState(0, 0, 1);
    const s1 = step(s0, jumpInput(), DEFAULT_CONFIG.fixedDt, DEFAULT_CONFIG, map);
    assert.strictEqual(s1.z, 2, 'o pulo sobe um nível');
    assert.strictEqual(s1.airborne, true);

    // A meio do pulo a gravidade não pode estar a puxá-lo para baixo.
    const meio = simulate(s1, noInput(), 15, map); // 0,25 s
    assert.strictEqual(meio.z, 2, 'a gravidade não actua durante o pulo');
    assert.strictEqual(meio.airborne, true);

    // Depois do pulo, cai de volta ao topo sólido. Era este o bug.
    const fim = simulate(s1, noInput(), 90, map); // 1,5 s
    assert.strictEqual(fim.airborne, false);
    assert.strictEqual(fim.z, 1, 'devia ter voltado a z=1, não ficar preso em z=2');
  });

  it('com mapa, o stepUp sem degrau ao lado não sobe — não há levitação', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 1); // topo sólido em z=1, e nenhuma coluna vizinha

    const s0 = createMovementState(0, 0, 1);
    const subida: MovementInput = {
      dir: { x: 0, y: 0 },
      jump: false,
      stepUp: true,
      stepDown: false,
    };
    const fim = simulate(s0, subida, 60, map);
    assert.strictEqual(fim.z, 1, 'sem degrau vizinho não há para onde subir');
  });

  it('com mapa, o stepUp sobe quando existe um degrau vizinho', () => {
    const map = new FakeGravityMap();
    map.addColumn(0, 0, 1); // personagem em (0,0,z=1)
    map.addColumn(1, 0, 2); // degrau a leste: topo sólido em z=2

    const s0 = createMovementState(0, 0, 1);
    const subida: MovementInput = {
      dir: { x: 0, y: 0 },
      jump: false,
      stepUp: true,
      stepDown: false,
    };
    // Um único passo: sobe para z=2 antes de a gravidade ter algo a dizer.
    const s1 = step(s0, subida, DEFAULT_CONFIG.fixedDt, DEFAULT_CONFIG, map);
    assert.strictEqual(s1.z, 2);
  });
});

// ------------------------------------------------------------------ step sem mapa

describe('step sem mapa — comportamento histórico preservado', () => {
  it('sem mapa não há queda: não existe solo a consultar', () => {
    const s0 = createMovementState(0, 0, 5);
    const fim = simulate(s0, noInput(), 120);
    assert.strictEqual(fim.z, 5);
    assert.strictEqual(fim.falling, false);
  });

  it('sem mapa o pulo continua a subir e a não descer (bug documentado)', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, jumpInput(), DEFAULT_CONFIG.fixedDt);
    assert.strictEqual(s1.z, 1);

    const fim = simulate(s1, noInput(), 120);
    assert.strictEqual(fim.airborne, false);
    assert.strictEqual(fim.z, 1, 'sem mapa não há para onde cair');
  });
});
