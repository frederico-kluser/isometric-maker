/**
 * Testes do motor de movimento (F3-01).
 *
 * Verifica:
 *   1. Movimento contínuo em xy com velocidade constante.
 *   2. z só muda por degrau ou pulo — nunca continuamente.
 *   3. Determinismo: mesma sequência de entradas → mesmo estado final.
 *   4. Passo fixo com acumulador: dt grande é partido em passos fixos.
 *
 * Execute com: node --test src/movement.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  step,
  createMovementState,
  DEFAULT_CONFIG,
  type MovementInput,
  type MovementState,
} from './movement.ts';

// ------------------------------------------------------------------ helpers

const EPS = 1e-9;

function noInput(): MovementInput {
  return { dir: { x: 0, y: 0 }, jump: false, stepUp: false, stepDown: false };
}

function dirInput(x: number, y: number): MovementInput {
  return { dir: { x, y }, jump: false, stepUp: false, stepDown: false };
}

function jumpInput(): MovementInput {
  return { dir: { x: 0, y: 0 }, jump: true, stepUp: false, stepDown: false };
}

function stepUpInput(): MovementInput {
  return { dir: { x: 0, y: 0 }, jump: false, stepUp: true, stepDown: false };
}

function stepDownInput(): MovementInput {
  return { dir: { x: 0, y: 0 }, jump: false, stepUp: false, stepDown: true };
}

/** Aplica a mesma entrada vários passos e devolve o estado final. */
function simulate(
  initialState: MovementState,
  input: MovementInput,
  steps: number,
  config = DEFAULT_CONFIG,
): MovementState {
  let state = initialState;
  for (let i = 0; i < steps; i++) {
    state = step(state, input, config.fixedDt, config);
  }
  return state;
}

// ------------------------------------------------------------------ xy contínuo

describe('movimento xy contínuo', () => {
  it('sem entrada → posição não muda', () => {
    const s0 = createMovementState(5, 3, 0);
    const s1 = step(s0, noInput(), 1 / 60);
    assert.strictEqual(s1.pos.x, 5);
    assert.strictEqual(s1.pos.y, 3);
  });

  it('direita (1,0) move em +x', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, dirInput(1, 0), 1);
    // speed=4, dt=1 → 4 unidades em x
    assert.ok(Math.abs(s1.pos.x - 4) < EPS, `x=${s1.pos.x}`);
    assert.ok(Math.abs(s1.pos.y) < EPS, `y=${s1.pos.y}`);
  });

  it('esquerda (-1,0) move em -x', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, dirInput(-1, 0), 1);
    assert.ok(Math.abs(s1.pos.x - (-4)) < EPS, `x=${s1.pos.x}`);
  });

  it('cima (0,-1) move em -y', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, dirInput(0, -1), 1);
    assert.ok(Math.abs(s1.pos.y - (-4)) < EPS, `y=${s1.pos.y}`);
  });

  it('baixo (0,1) move em +y', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, dirInput(0, 1), 1);
    assert.ok(Math.abs(s1.pos.y - 4) < EPS, `y=${s1.pos.y}`);
  });

  it('diagonal (1,1): velocidade é normalizada', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, dirInput(1, 1), 1);
    // (1,1) normalizado = (1/√2, 1/√2); distância percorrida = speed * 1
    const dist = Math.sqrt(s1.pos.x * s1.pos.x + s1.pos.y * s1.pos.y);
    assert.ok(Math.abs(dist - DEFAULT_CONFIG.speed) < EPS, `distância=${dist}`);
  });

  it('velocidade é armazenada no estado', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, dirInput(1, 0), 1 / 60);
    assert.ok(Math.abs(s1.vel.x - DEFAULT_CONFIG.speed) < EPS);
    assert.ok(Math.abs(s1.vel.y) < EPS);
  });

  it('parar zera a velocidade', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, dirInput(1, 0), 1 / 60);
    assert.ok(s1.vel.x > 0);
    const s2 = step(s1, noInput(), 1 / 60);
    assert.strictEqual(s2.vel.x, 0);
    assert.strictEqual(s2.vel.y, 0);
  });
});

// ------------------------------------------------------------------ z discreto

describe('z discreto', () => {
  it('z não muda sem entrada de degrau ou pulo', () => {
    const s0 = createMovementState(0, 0, 3);
    const s1 = step(s0, dirInput(1, 0), 10); // muito dt
    assert.strictEqual(s1.z, 3);
  });

  it('stepUp sobe um nível IMEDIATAMENTE', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, stepUpInput(), 1 / 60);
    assert.strictEqual(s1.z, 1);
  });

  it('stepDown desce um nível', () => {
    const s0 = createMovementState(0, 0, 2);
    const s1 = step(s0, stepDownInput(), 1 / 60);
    assert.strictEqual(s1.z, 1);
  });

  it('stepDown não desce abaixo de z=0', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, stepDownInput(), 1 / 60);
    assert.strictEqual(s1.z, 0);
  });

  it('stepUp durante pulo é ignorado (airborne)', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, jumpInput(), 1 / 60); // inicia pulo, z vai a 1
    assert.strictEqual(s1.z, 1);
    assert.strictEqual(s1.airborne, true);

    // stepUp durante o pulo não deve mudar z
    const s2 = step(s1, stepUpInput(), 1 / 60);
    assert.strictEqual(s2.z, 1); // ainda 1
  });

  it('z nunca muda continuamente — só em saltos discretos', () => {
    const s0 = createMovementState(0, 0, 0);
    // Move-se muito tempo sem input de z
    let state = s0;
    for (let i = 0; i < 1000; i++) {
      state = step(state, dirInput(1, 0), 1 / 60);
    }
    assert.strictEqual(state.z, 0, 'z deve continuar 0');

    // Agora stepUp
    state = step(state, stepUpInput(), 1 / 60);
    assert.strictEqual(state.z, 1, 'z deve ser 1 (um salto discreto)');
  });
});

// ------------------------------------------------------------------ pulo

describe('pulo (jump)', () => {
  it('pulo sobe z IMEDIATAMENTE', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, jumpInput(), 1 / 60);
    assert.strictEqual(s1.z, 1);
    assert.strictEqual(s1.airborne, true);
    assert.ok(s1.jumpTime > 0);
  });

  it('durante o pulo, z não volta ao chão', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, jumpInput(), 1 / 60);
    assert.strictEqual(s1.z, 1);

    // Avança parte do pulo
    const s2 = simulate(s1, noInput(), 10);
    assert.strictEqual(s2.z, 1); // ainda no ar
    assert.strictEqual(s2.airborne, true);
  });

  it('pulo termina e aterra (airborne → false)', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, jumpInput(), 1 / 60);
    assert.strictEqual(s1.z, 1);

    // Avança até ao fim do pulo
    const stepsToFinish = Math.ceil(DEFAULT_CONFIG.jumpDuration / DEFAULT_CONFIG.fixedDt) + 5;
    const s2 = simulate(s1, noInput(), stepsToFinish);
    assert.strictEqual(s2.airborne, false);
    assert.strictEqual(s2.jumpTime, 0);
    assert.strictEqual(s2.vz, null);
    // z permanece no nível 1 (a altura do pulo)
    // Na verdade, num jogo real a colisão traria de volta, mas o motor
    // de movimento não tem colisão — F3-02 trata disso.
  });

  it('pulo não pode ser iniciado durante outro pulo', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, jumpInput(), 1 / 60);
    assert.strictEqual(s1.airborne, true);
    assert.strictEqual(s1.z, 1);

    // Tentar pular de novo durante o pulo
    const s2 = step(s1, jumpInput(), 1 / 60);
    // z não deve subir para 2
    assert.strictEqual(s2.z, 1);
  });

  it('pulo pode ser iniciado após aterrar', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, jumpInput(), 1 / 60);
    assert.strictEqual(s1.z, 1);

    // Termina o pulo
    const steps = Math.ceil(DEFAULT_CONFIG.jumpDuration / DEFAULT_CONFIG.fixedDt) + 5;
    const s2 = simulate(s1, noInput(), steps);
    assert.strictEqual(s2.airborne, false);

    // Novo pulo
    const s3 = step(s2, jumpInput(), 1 / 60);
    assert.strictEqual(s3.z, 2); // sobe para 2
    assert.strictEqual(s3.airborne, true);
  });
});

// ------------------------------------------------------------------ passo fixo com acumulador

describe('passo fixo com acumulador', () => {
  it('dt pequeno (menor que fixedDt) é acumulado', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, dirInput(1, 0), 1 / 120); // metade do passo fixo
    // Não deve ter havido passo lógico ainda
    assert.ok(s1.accumulator > 0, `acumulador=${s1.accumulator}`);
    assert.strictEqual(s1.pos.x, 0); // não se moveu
  });

  it('dt acumulado dispara passo lógico', () => {
    const s0 = createMovementState(0, 0, 0);
    // Dois meios passos = um passo completo
    const s1 = step(s0, dirInput(1, 0), 1 / 120);
    const s2 = step(s1, dirInput(1, 0), 1 / 120);
    // Deve ter andado um passo
    const expected = DEFAULT_CONFIG.speed * DEFAULT_CONFIG.fixedDt;
    assert.ok(Math.abs(s2.pos.x - expected) < EPS, `x=${s2.pos.x}, expected=${expected}`);
  });

  it('dt grande (maior que vários fixedDt) consome vários passos', () => {
    const s0 = createMovementState(0, 0, 0);
    const dt = 1; // 1 segundo
    const s1 = step(s0, dirInput(1, 0), dt);
    // Deve ter-se movido ~ speed * 1 (com pequeno erro do acumulador residual)
    const dist = s1.pos.x;
    assert.ok(Math.abs(dist - DEFAULT_CONFIG.speed) < 0.1, `distância=${dist}`);
  });

  it('acumulador residual preserva-se entre chamadas', () => {
    const s0 = createMovementState(0, 0, 0);
    // dt = 2.5 * fixedDt → 2 passos completos + 0.5 residual
    const dt = 2.5 * DEFAULT_CONFIG.fixedDt;
    const s1 = step(s0, dirInput(1, 0), dt);
    // Deve ter ~0.5 * fixedDt no acumulador
    assert.ok(s1.accumulator > 0 && s1.accumulator < DEFAULT_CONFIG.fixedDt,
      `acumulador=${s1.accumulator}`);
  });
});

// ------------------------------------------------------------------ determinismo

describe('determinismo', () => {
  it('mesma sequência de entradas → mesmo estado final', () => {
    const run = (): MovementState => {
      let s = createMovementState(10, 20, 1);

      // Sequência de entradas variada
      s = step(s, dirInput(1, 0), 0.1);
      s = step(s, dirInput(1, 0), 0.1);
      s = step(s, dirInput(0, 1), 0.05);
      s = step(s, jumpInput(), 0.016);
      s = step(s, noInput(), 0.2);
      s = step(s, dirInput(-1, 0), 0.15);
      s = step(s, stepUpInput(), 0.016);
      s = step(s, dirInput(0, -1), 0.3);
      s = step(s, noInput(), 0.5);

      return s;
    };

    const a = run();
    const b = run();

    // Todas as propriedades devem ser idênticas
    assert.ok(Math.abs(a.pos.x - b.pos.x) < EPS);
    assert.ok(Math.abs(a.pos.y - b.pos.y) < EPS);
    assert.strictEqual(a.z, b.z);
    assert.ok(Math.abs(a.vel.x - b.vel.x) < EPS);
    assert.ok(Math.abs(a.vel.y - b.vel.y) < EPS);
    assert.strictEqual(a.airborne, b.airborne);
    assert.ok(Math.abs(a.jumpTime - b.jumpTime) < EPS);
    assert.ok(Math.abs(a.facing - b.facing) < EPS);
    assert.ok(Math.abs(a.accumulator - b.accumulator) < EPS);
  });

  it('estado inicial determinístico', () => {
    const a = createMovementState(1, 2, 3);
    const b = createMovementState(1, 2, 3);
    assert.deepStrictEqual(a, b);
  });
});

// ------------------------------------------------------------------ facing

describe('facing (direcção de visualização)', () => {
  it('sem entrada mantém facing anterior', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, dirInput(1, 0), 1 / 60);
    const angle = s1.facing;
    const s2 = step(s1, noInput(), 1 / 60);
    assert.strictEqual(s2.facing, angle);
  });

  it('direita (1,0) → facing 0', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, dirInput(1, 0), 1);
    assert.ok(Math.abs(s1.facing - 0) < EPS, `facing=${s1.facing}`);
  });

  it('cima (0,-1) → facing -π/2', () => {
    const s0 = createMovementState(0, 0, 0);
    const s1 = step(s0, dirInput(0, -1), 1);
    assert.ok(Math.abs(s1.facing - (-Math.PI / 2)) < EPS, `facing=${s1.facing}`);
  });
});
