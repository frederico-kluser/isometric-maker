/**
 * Testes de locomoção do personagem jogável.
 *
 * Cobre:
 *   1. Correr é o padrão; andar (Shift) é o modificador; agachado é o mais
 *      lento — com números concretos, não com comparações vagas.
 *   2. Agachado não pula, nem no motor de movimento nem no traço.
 *   3. O pulo sobe no máximo um bloco, mesmo com `jumpHeight` maior.
 *   4. Pular contra um degrau de um nível aterra em cima dele; pular contra
 *      uma parede de dois níveis bloqueia e devolve o personagem ao z de origem.
 *
 * Execute com: node --test src/locomotion.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  step,
  createMovementState,
  resolveGait,
  speedFor,
  jumpRise,
  DEFAULT_CONFIG,
  DEFAULT_WALK_FACTOR,
  DEFAULT_CROUCH_FACTOR,
  MAX_JUMP_RISE,
  type MovementInput,
  type MovementConfig,
} from './movement.ts';
import { runTrace, dirInput, jumpInput, NO_INPUT, type TraceFrame } from './trace.ts';
import type { CollisionMap } from './collision.ts';
import type { EdgeSide } from './map.ts';

// ------------------------------------------------------------------ fake map

class FakeLocomotionMap implements CollisionMap {
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

const EPS = 1e-9;

function runEast(): MovementInput {
  return { dir: { x: 1, y: 0 }, jump: false, stepUp: false, stepDown: false };
}

function walkEast(): MovementInput {
  return { ...runEast(), walk: true };
}

function crouchEast(): MovementInput {
  return { ...runEast(), crouch: true };
}

/** Distância percorrida em 1 segundo a partir da origem. */
function distanceInOneSecond(input: MovementInput, config = DEFAULT_CONFIG): number {
  const s0 = createMovementState(0, 0, 0);
  const s1 = step(s0, input, 1, config);
  return s1.pos.x;
}

// ------------------------------------------------------------------ velocidades

describe('correr > andar > agachado', () => {
  it('correr percorre 4 unidades num segundo (speed base)', () => {
    const d = distanceInOneSecond(runEast());
    assert.ok(Math.abs(d - 4) < EPS, `distância a correr = ${d}`);
  });

  it('andar percorre 2 unidades num segundo (metade da base)', () => {
    const d = distanceInOneSecond(walkEast());
    assert.ok(Math.abs(d - 2) < EPS, `distância a andar = ${d}`);
    assert.strictEqual(DEFAULT_WALK_FACTOR, 0.5);
  });

  it('agachado percorre 1,4 unidades num segundo', () => {
    const d = distanceInOneSecond(crouchEast());
    assert.ok(Math.abs(d - 1.4) < 1e-9, `distância agachado = ${d}`);
    assert.strictEqual(DEFAULT_CROUCH_FACTOR, 0.35);
  });

  it('a ordem é estrita: correr > andar > agachado', () => {
    const correr = distanceInOneSecond(runEast());
    const andar = distanceInOneSecond(walkEast());
    const agachado = distanceInOneSecond(crouchEast());
    assert.ok(correr > andar, `${correr} não é maior que ${andar}`);
    assert.ok(andar > agachado, `${andar} não é maior que ${agachado}`);
  });

  it('omitir `walk` corre — correr é o padrão, não o modificador', () => {
    const semCampo = distanceInOneSecond(runEast());
    const comFalse = distanceInOneSecond({ ...runEast(), walk: false });
    assert.strictEqual(semCampo, comFalse);
    assert.ok(Math.abs(semCampo - DEFAULT_CONFIG.speed) < EPS);
  });

  it('agachado ganha a andar quando os dois modificadores estão activos', () => {
    const ambos: MovementInput = { ...runEast(), walk: true, crouch: true };
    assert.strictEqual(resolveGait(ambos), 'crouch');
    const d = distanceInOneSecond(ambos);
    assert.ok(Math.abs(d - 1.4) < 1e-9, `distância = ${d}`);
  });

  it('`speed` continua a ser a velocidade base e escala as três marchas', () => {
    const rapido: MovementConfig = { ...DEFAULT_CONFIG, speed: 10 };
    assert.strictEqual(speedFor('run', rapido), 10);
    assert.strictEqual(speedFor('walk', rapido), 5);
    assert.ok(Math.abs(speedFor('crouch', rapido) - 3.5) < EPS);
  });

  it('os factores são configuráveis sem tocar em `speed`', () => {
    const config: MovementConfig = {
      ...DEFAULT_CONFIG,
      walkFactor: 0.25,
      crouchFactor: 0.1,
    };
    assert.strictEqual(speedFor('walk', config), 1);
    assert.ok(Math.abs(speedFor('crouch', config) - 0.4) < EPS);
  });
});

// ------------------------------------------------------------------ estado observável

describe('o modo de locomoção é observável por quem desenha', () => {
  it('gait e crouching acompanham a entrada', () => {
    const s0 = createMovementState(0, 0, 0);

    const correndo = step(s0, runEast(), DEFAULT_CONFIG.fixedDt);
    assert.strictEqual(correndo.gait, 'run');
    assert.strictEqual(correndo.crouching, false);

    const andando = step(s0, walkEast(), DEFAULT_CONFIG.fixedDt);
    assert.strictEqual(andando.gait, 'walk');
    assert.strictEqual(andando.crouching, false);

    const agachado = step(s0, crouchEast(), DEFAULT_CONFIG.fixedDt);
    assert.strictEqual(agachado.gait, 'crouch');
    assert.strictEqual(agachado.crouching, true);
  });

  it('o estado inicial corre e não está agachado nem a cair', () => {
    const s0 = createMovementState(3, 4, 2);
    assert.strictEqual(s0.gait, 'run');
    assert.strictEqual(s0.crouching, false);
    assert.strictEqual(s0.falling, false);
    assert.strictEqual(s0.fallProgress, 0);
  });

  it('parado agachado continua agachado — o modo não depende da velocidade', () => {
    const parado: MovementInput = {
      dir: { x: 0, y: 0 },
      jump: false,
      stepUp: false,
      stepDown: false,
      crouch: true,
    };
    const s1 = step(createMovementState(0, 0, 0), parado, DEFAULT_CONFIG.fixedDt);
    assert.strictEqual(s1.gait, 'crouch');
    assert.strictEqual(s1.crouching, true);
    assert.strictEqual(s1.vel.x, 0);
  });
});

// ------------------------------------------------------------------ agachado não pula

describe('agachado não pula', () => {
  it('step: agachado + pulo não sobe e não fica no ar', () => {
    const s0 = createMovementState(0, 0, 0);
    const agachadoPulando: MovementInput = {
      dir: { x: 0, y: 0 },
      jump: true,
      stepUp: false,
      stepDown: false,
      crouch: true,
    };
    const s1 = step(s0, agachadoPulando, DEFAULT_CONFIG.fixedDt);
    assert.strictEqual(s1.z, 0, 'agachado não pode subir');
    assert.strictEqual(s1.airborne, false);
    assert.strictEqual(s1.jumpTime, 0);
  });

  it('step: o mesmo input sem agachar pula — a diferença é o agachamento', () => {
    const s0 = createMovementState(0, 0, 0);
    const dePe: MovementInput = {
      dir: { x: 0, y: 0 },
      jump: true,
      stepUp: false,
      stepDown: false,
    };
    const s1 = step(s0, dePe, DEFAULT_CONFIG.fixedDt);
    assert.strictEqual(s1.z, 1);
    assert.strictEqual(s1.airborne, true);
  });

  it('runTrace: agachado bate no degrau em vez de o saltar', () => {
    // (0,0) é chão liso (z=0); (1,0) é um degrau de um nível.
    const map = new FakeLocomotionMap();
    map.addColumn(1, 0, 1);

    const agachadoPulando: MovementInput = {
      dir: { x: 1, y: 0 },
      jump: true,
      stepUp: false,
      stepDown: false,
      crouch: true,
    };
    const frames: TraceFrame[] = [
      { duration: 1.0, input: agachadoPulando },
      { duration: 0.6, input: NO_INPUT },
    ];

    const result = runTrace(map, 0.5, 0.5, 0, frames);

    assert.strictEqual(result.blocked, true, 'devia ter batido no degrau');
    assert.strictEqual(result.finalState.z, 0, 'agachado não sobe o degrau');
  });
});

// ------------------------------------------------------------------ o pulo sobe um bloco

describe('o pulo sobe no máximo um bloco', () => {
  it('jumpRise limita `jumpHeight` a MAX_JUMP_RISE', () => {
    assert.strictEqual(MAX_JUMP_RISE, 1);
    assert.strictEqual(jumpRise(DEFAULT_CONFIG), 1);
    assert.strictEqual(jumpRise({ ...DEFAULT_CONFIG, jumpHeight: 5 }), 1);
    assert.strictEqual(jumpRise({ ...DEFAULT_CONFIG, jumpHeight: 2 }), 1);
    assert.strictEqual(jumpRise({ ...DEFAULT_CONFIG, jumpHeight: 0 }), 0);
    assert.strictEqual(jumpRise({ ...DEFAULT_CONFIG, jumpHeight: -3 }), 0);
  });

  it('step: mesmo com jumpHeight=5 o pulo sobe um nível só', () => {
    const config: MovementConfig = { ...DEFAULT_CONFIG, jumpHeight: 5 };
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, jumpInput(0, 0), DEFAULT_CONFIG.fixedDt, config);
    assert.strictEqual(s1.z, 1, 'jumpHeight=5 não pode virar cinco níveis');
  });

  it('step com mapa: um tecto sólido impede a subida', () => {
    const map = new FakeLocomotionMap();
    map.addColumn(0, 0, 1); // personagem em z=1
    map.addBlock(0, 0, 2); // tecto imediatamente acima

    const s0 = createMovementState(0, 0, 1);
    const s1 = step(s0, jumpInput(0, 0), DEFAULT_CONFIG.fixedDt, DEFAULT_CONFIG, map);
    assert.strictEqual(s1.z, 1, 'não se pula para dentro de pedra');
    assert.strictEqual(s1.airborne, false);
  });

  it('runTrace: pular sobre um degrau de um nível aterra em cima dele (z=1)', () => {
    // (0,0) é chão liso (z=0); (1,0) tem um bloco, portanto o topo é z=1.
    const map = new FakeLocomotionMap();
    map.addColumn(1, 0, 1);

    const frames: TraceFrame[] = [
      { duration: 0.2, input: jumpInput(1, 0) }, // avança 0,8 → entra em (1,0)
      { duration: 0.6, input: NO_INPUT }, // deixa o pulo terminar
    ];

    const result = runTrace(map, 0.5, 0.5, 0, frames);

    assert.strictEqual(result.blocked, false, 'o degrau de um nível é saltável');
    assert.strictEqual(result.finalState.z, 1, 'devia ter aterrado em cima do degrau');
    assert.strictEqual(Math.floor(result.finalState.pos.x), 1, 'devia estar na célula do degrau');
  });

  it('runTrace: pular contra uma parede de dois níveis não sobe — bloqueia e volta a z=0', () => {
    // (0,0) é chão liso (z=0); (1,0) tem dois blocos, portanto o topo é z=2.
    const map = new FakeLocomotionMap();
    map.addColumn(1, 0, 2);

    const frames: TraceFrame[] = [
      { duration: 0.2, input: jumpInput(1, 0) },
      { duration: 0.6, input: NO_INPUT },
    ];

    const result = runTrace(map, 0.5, 0.5, 0, frames);

    assert.strictEqual(result.blocked, true, 'dois níveis bloqueiam o pulo');
    assert.strictEqual(result.finalState.z, 0, 'devia ter voltado ao z de origem');
    assert.strictEqual(
      Math.floor(result.finalState.pos.x),
      0,
      'devia ter parado antes da parede',
    );
  });

  it('runTrace: nem com jumpHeight=5 a parede de dois níveis é vencida', () => {
    const map = new FakeLocomotionMap();
    map.addColumn(1, 0, 2);

    const config: MovementConfig = { ...DEFAULT_CONFIG, jumpHeight: 5 };
    const frames: TraceFrame[] = [
      { duration: 0.2, input: jumpInput(1, 0) },
      { duration: 0.6, input: NO_INPUT },
    ];

    const result = runTrace(map, 0.5, 0.5, 0, frames, config);

    assert.strictEqual(result.blocked, true);
    assert.strictEqual(result.finalState.z, 0);
  });
});

// ------------------------------------------------------------------ traço com marchas

describe('runTrace respeita a marcha', () => {
  it('andar percorre metade da distância de correr no mesmo tempo', () => {
    const map = new FakeLocomotionMap();
    for (let x = 0; x < 12; x++) map.addColumn(x, 0, 1);

    const correndo = runTrace(map, 0.5, 0.5, 1, [
      { duration: 0.5, input: dirInput(1, 0) },
    ]);
    const andando = runTrace(map, 0.5, 0.5, 1, [
      { duration: 0.5, input: { ...dirInput(1, 0), walk: true } },
    ]);

    const distCorrendo = correndo.finalState.pos.x - 0.5;
    const distAndando = andando.finalState.pos.x - 0.5;

    assert.ok(distCorrendo > distAndando, `${distCorrendo} não é maior que ${distAndando}`);
    assert.ok(
      Math.abs(distCorrendo / 2 - distAndando) < 1e-9,
      `andar devia ser metade: ${distAndando} vs ${distCorrendo / 2}`,
    );
  });

  it('cair no traço: quem começa sem suporte desce até ao topo sólido', () => {
    const map = new FakeLocomotionMap();
    map.addColumn(0, 0, 1); // topo sólido em z=1

    const result = runTrace(map, 0.5, 0.5, 5, [
      { duration: 1.0, input: NO_INPUT },
    ]);

    assert.strictEqual(result.finalState.z, 1, 'devia ter aterrado no topo sólido');
    assert.strictEqual(result.finalState.falling, false);
  });

  it('cair no traço: sobre o vazio desce até z=0', () => {
    const map = new FakeLocomotionMap(); // nenhuma coluna

    const result = runTrace(map, 0.5, 0.5, 4, [
      { duration: 1.0, input: NO_INPUT },
    ]);

    assert.strictEqual(result.finalState.z, 0, 'o plano de chão é o fundo');
  });

  it('cair no traço: a queda leva tempo — um traço curto apanha-a a meio', () => {
    const map = new FakeLocomotionMap();
    map.addColumn(0, 0, 1);

    // 0,05 s = 3 passos de lógica; a 12 níveis/s ainda não completou um nível.
    const result = runTrace(map, 0.5, 0.5, 5, [
      { duration: 0.05, input: NO_INPUT },
    ]);

    assert.strictEqual(result.finalState.z, 5, 'a queda não pode ser instantânea');
    assert.strictEqual(result.finalState.falling, true, 'falling tem de ser observável');
  });
});
