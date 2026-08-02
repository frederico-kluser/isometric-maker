/**
 * Testes do controlador ao vivo com colisão (`stepWithMap`) e da regra nova da
 * beirada.
 *
 * ## O que estes testes fixam
 *
 * 1. **Sair da beirada é cair.** Andar para fora de uma plataforma leva o
 *    personagem ao topo sólido de baixo — com o `z` exacto, não `>=`. Se não
 *    houver nada por baixo, o plano de chão (`z = 0`) é o fundo.
 * 2. **Bater continua a bater.** Bloco no destino e parede na aresta continuam
 *    a recusar a travessia; a célula não muda.
 * 3. **O pulo atravessa vãos** e aterra do outro lado.
 * 4. **O pulo não vence dois níveis** — bloqueia e o `z` volta ao de origem.
 * 5. **Não há duas colisões.** `stepWithMap` chamado N vezes com `dt =
 *    fixedDt` devolve **exactamente** o mesmo estado que `runTrace` com N
 *    quadros equivalentes. Este é o teste que falha se alguém duplicar o miolo
 *    em vez de o partilhar.
 * 6. **O pulo sobrevive ao quadro.** Um pulo iniciado no quadro 1 continua no
 *    ar nos quadros seguintes mesmo com o botão largado — o que só é possível
 *    porque o `JumpState` vive no `MovementState` e não numa variável local de
 *    quem simula.
 *
 * Execute com: node --test src/simulate.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canCross, edgesAllowCross, type CollisionMap } from './collision.ts';
import type { EdgeSide } from './map.ts';
import {
  createMovementState,
  DEFAULT_CONFIG,
  type MovementConfig,
  type MovementInput,
  type MovementState,
} from './movement.ts';
import { stepWithMap } from './simulate.ts';
import {
  runTrace,
  dirInput,
  jumpInput,
  NO_INPUT,
  type TraceFrame,
} from './trace.ts';

// ------------------------------------------------------------------ mapa de teste

class FakeMap implements CollisionMap {
  readonly #blocks = new Set<string>();
  readonly #edges = new Set<string>();

  hasBlock(x: number, y: number, z: number): boolean {
    return this.#blocks.has(`${x}:${y}:${z}`);
  }

  hasEdge(x: number, y: number, z: number, lado: EdgeSide): boolean {
    return this.#edges.has(`${x}:${y}:${z}:${lado}`);
  }

  /** Empilha `count` blocos a partir de z=0. O topo sólido fica em `count`. */
  addColumn(x: number, y: number, count: number): this {
    for (let z = 0; z < count; z++) this.#blocks.add(`${x}:${y}:${z}`);
    return this;
  }

  /** Empilha `count` blocos em cada coluna de `fromX..toX` na linha `y`. */
  addRow(fromX: number, toX: number, y: number, count: number): this {
    for (let x = fromX; x <= toX; x++) this.addColumn(x, y, count);
    return this;
  }

  addEdge(x: number, y: number, z: number, lado: EdgeSide): this {
    this.#edges.add(`${x}:${y}:${z}:${lado}`);
    return this;
  }
}

// ------------------------------------------------------------------ helpers

const CONFIG: MovementConfig = DEFAULT_CONFIG;

/** Corre `inputs` um por quadro, com `dt` igual ao passo fixo. */
function runLive(
  map: CollisionMap,
  x: number,
  y: number,
  z: number,
  inputs: readonly MovementInput[],
  config: MovementConfig = CONFIG,
  stopWhenBlocked = false,
): MovementState {
  let state = createMovementState(x, y, z);
  for (const input of inputs) {
    state = stepWithMap(state, input, config.fixedDt, config, map);
    if (stopWhenBlocked && state.blocked) break;
  }
  return state;
}

/** `n` cópias do mesmo input, para descrever um quadro por passo fixo. */
function hold(input: MovementInput, n: number): MovementInput[] {
  return Array.from({ length: n }, () => input);
}

function cellX(state: MovementState): number {
  return Math.floor(state.pos.x);
}

// ------------------------------------------------------------------ 1. sair da beirada

describe('sair da beirada é uma queda, não um muro', () => {
  it('andar para fora de uma plataforma de altura 3 pára no topo sólido de baixo (z=1)', () => {
    // Plataforma de 3 blocos em x=0..1 (topo z=3); chão baixo de 1 bloco em
    // x=2..8 (topo z=1). O personagem anda para leste e sai da plataforma.
    const map = new FakeMap().addRow(0, 1, 0, 3).addRow(2, 8, 0, 1);

    const state = runLive(map, 0.5, 0.5, 3, hold(dirInput(1, 0), 60));

    assert.strictEqual(state.z, 1, 'devia ter caído até ao topo sólido de baixo');
    assert.strictEqual(state.falling, false, 'a queda já acabou');
    assert.strictEqual(state.blocked, false, 'a beirada não é um bloqueio');
    assert.strictEqual(cellX(state), 4, 'x = 0,5 + 60·(4/60) = 4,5 → célula 4');
    assert.ok(Math.abs(state.pos.x - 4.5) < 1e-9, `x = ${state.pos.x}`);
  });

  it('sem nada por baixo, a queda pára no plano de chão (z=0)', () => {
    // A mesma plataforma, e o vazio absoluto a partir de x=2.
    const map = new FakeMap().addRow(0, 1, 0, 3);

    const state = runLive(map, 0.5, 0.5, 3, hold(dirInput(1, 0), 60));

    assert.strictEqual(state.z, 0, 'o plano de chão é o fundo');
    assert.strictEqual(state.falling, false);
    assert.strictEqual(state.blocked, false);
  });

  it('a queda leva tempo — o meio dela é observável', () => {
    const map = new FakeMap().addRow(0, 1, 0, 3).addRow(2, 8, 0, 1);

    // 24 passos = 1,6 unidades → x = 2,1: acabou de atravessar para (2,0).
    // A 12 níveis/s, um passo de 1/60 s consome 0,2 de nível: ainda não desceu.
    const state = runLive(map, 0.5, 0.5, 3, hold(dirInput(1, 0), 24));

    assert.strictEqual(cellX(state), 2, 'devia ter atravessado para (2,0)');
    assert.strictEqual(state.z, 3, 'a queda não pode ser instantânea');
    assert.strictEqual(state.falling, true, 'falling tem de ser observável');
  });

  it('descer uma plataforma de altura 3 gasta exactamente 3 níveis, um a um', () => {
    const map = new FakeMap().addRow(0, 1, 0, 3);

    // Amostra o z quadro a quadro: nunca salta um nível nem toma um valor
    // fraccionário. O z é discreto em todo o instante.
    let state = createMovementState(0.5, 0.5, 3);
    const vistos = new Set<number>();
    for (let i = 0; i < 60; i++) {
      state = stepWithMap(state, dirInput(1, 0), CONFIG.fixedDt, CONFIG, map);
      assert.ok(Number.isInteger(state.z), `z fraccionário no passo ${i}: ${state.z}`);
      vistos.add(state.z);
    }
    assert.deepStrictEqual([...vistos].sort((a, b) => b - a), [3, 2, 1, 0]);
    assert.strictEqual(state.z, 0);
  });
});

// ------------------------------------------------------------------ 2. paredes continuam a bloquear

describe('a parede continua a ser uma parede', () => {
  it('andar contra um bloco bloqueia e a célula não muda', () => {
    // Chão de topo z=1 em x=0..8, e uma coluna de 2 blocos em x=2: a célula
    // (2,0,1) está ocupada.
    const map = new FakeMap().addRow(0, 8, 0, 1).addColumn(2, 0, 2);

    const state = runLive(map, 0.5, 0.5, 1, hold(dirInput(1, 0), 60));

    assert.strictEqual(state.blocked, true, 'devia estar bloqueado pelo bloco');
    assert.strictEqual(cellX(state), 1, 'não pode entrar na célula do bloco');
    assert.ok(state.pos.x < 2, `x=${state.pos.x} entrou na célula ocupada`);
    assert.strictEqual(state.z, 1, 'bater não muda o nível');
    assert.deepStrictEqual(state.vel, { x: 0, y: 0 }, 'a velocidade zera ao bater');
  });

  it('a parede de aresta bloqueia mesmo com a célula de destino ocupável', () => {
    // Chão liso: (2,0,1) é perfeitamente entrável. O que impede é a parede na
    // aresta leste de (1,0,1).
    const map = new FakeMap().addRow(0, 8, 0, 1).addEdge(1, 0, 1, 'L');

    const state = runLive(map, 0.5, 0.5, 1, hold(dirInput(1, 0), 60));

    assert.strictEqual(state.blocked, true, 'a parede de aresta tem de bloquear');
    assert.strictEqual(cellX(state), 1);
    assert.strictEqual(state.z, 1);
  });

  it('a parede de aresta bloqueia mesmo na borda de uma plataforma', () => {
    // A regra nova permite sair da beirada; uma parede na beirada continua a
    // não permitir. As duas regras são independentes e esta prova-o.
    const map = new FakeMap()
      .addRow(0, 1, 0, 3)
      .addRow(2, 8, 0, 1)
      .addEdge(1, 0, 3, 'L');

    const state = runLive(map, 0.5, 0.5, 3, hold(dirInput(1, 0), 60));

    assert.strictEqual(state.blocked, true, 'a parede ganha à queda');
    assert.strictEqual(state.z, 3, 'não caiu — foi travado na aresta');
    assert.strictEqual(cellX(state), 1);
  });

  it('`canEnter` continua a ser a mesma pergunta — só a resolução mudou', () => {
    // A permissão de queda entrou no ponto de resolução. A regra base, de que
    // `canStepUp`/`canStepDown` dependem, tem de continuar a recusar uma
    // célula sem suporte.
    const map = new FakeMap().addRow(0, 1, 0, 3);
    assert.strictEqual(
      canCross(map, { x: 1, y: 0, z: 3 }, { x: 2, y: 0, z: 3 }),
      false,
      'canCross continua a exigir destino apoiado',
    );
    assert.strictEqual(
      edgesAllowCross(map, { x: 1, y: 0, z: 3 }, { x: 2, y: 0, z: 3 }),
      true,
      'a metade da aresta diz que não há parede — e é essa que a queda usa',
    );
  });
});

// ------------------------------------------------------------------ 3. pular um vão

describe('o pulo atravessa um vão', () => {
  it('pular sobre um vão de 1 célula aterra do outro lado em z=1', () => {
    // x=0 e x=2 têm 1 bloco (topo z=1); x=1 é o vão, coluna vazia.
    const map = new FakeMap().addColumn(0, 0, 1).addColumn(2, 0, 1);

    const inputs = [...hold(jumpInput(1, 0), 30), ...hold(NO_INPUT, 60)];
    const state = runLive(map, 0.5, 0.5, 1, inputs);

    assert.strictEqual(state.z, 1, 'devia ter aterrado no bloco do outro lado');
    assert.strictEqual(cellX(state), 2, 'devia estar na célula do outro lado');
    assert.strictEqual(state.airborne, false, 'o pulo acabou');
    assert.strictEqual(state.falling, false);
    assert.strictEqual(state.blocked, false, 'o vão não é um obstáculo');
  });

  it('atravessar o mesmo vão a andar cai lá para dentro (z=0)', () => {
    // O contraste que dá sentido ao teste acima: sem pulo, o vão é um buraco.
    const map = new FakeMap().addColumn(0, 0, 1).addColumn(2, 0, 1);

    // 15 passos: x = 1,5 (dentro do vão) e tempo de sobra para descer o nível.
    const state = runLive(map, 0.5, 0.5, 1, hold(dirInput(1, 0), 15));

    assert.strictEqual(cellX(state), 1, 'está por cima do vão');
    assert.strictEqual(state.z, 0, 'caiu para o fundo do vão');
  });
});

// ------------------------------------------------------------------ 4. dois níveis não se pulam

describe('o pulo não vence dois níveis', () => {
  it('pular contra uma parede de dois níveis bloqueia e o z volta ao de origem', () => {
    // Plano de chão em z=0; coluna de 2 blocos em x=1 (topo z=2).
    const map = new FakeMap().addColumn(1, 0, 2);

    const inputs = [...hold(jumpInput(1, 0), 30), ...hold(NO_INPUT, 60)];
    const state = runLive(map, 0.5, 0.5, 0, inputs);

    assert.strictEqual(state.z, 0, 'devia ter voltado ao z de origem');
    assert.strictEqual(cellX(state), 0, 'devia ter parado antes da parede');
    assert.strictEqual(state.airborne, false);
  });

  it('o bloqueio é observável no quadro em que acontece', () => {
    const map = new FakeMap().addColumn(1, 0, 2);

    let state = createMovementState(0.5, 0.5, 0);
    let primeiroBloqueio = -1;
    for (let i = 0; i < 30; i++) {
      state = stepWithMap(state, jumpInput(1, 0), CONFIG.fixedDt, CONFIG, map);
      if (state.blocked && primeiroBloqueio < 0) primeiroBloqueio = i;
    }

    // x cruza 1,0 no passo 8 (0,5 + 8·4/60 = 1,033…); é aí que a travessia é
    // proposta e recusada.
    assert.strictEqual(primeiroBloqueio, 7, 'o bloqueio tem um quadro exacto');
  });

  it('pular sobre um degrau de um nível aterra em cima dele (z=1)', () => {
    const map = new FakeMap().addColumn(1, 0, 1);

    // 12 quadros de avanço = 0,8 unidades: entra em (1,0) e pára lá. Mais do
    // que isso e o personagem sai do degrau pelo outro lado, que é chão vazio.
    const inputs = [...hold(jumpInput(1, 0), 12), ...hold(NO_INPUT, 60)];
    const state = runLive(map, 0.5, 0.5, 0, inputs);

    assert.strictEqual(state.z, 1, 'um nível é saltável');
    assert.strictEqual(cellX(state), 1);
    assert.strictEqual(state.blocked, false);
  });
});

// ------------------------------------------------------------------ 5. uma só colisão

describe('stepWithMap e runTrace são a MESMA simulação', () => {
  /**
   * Corre a mesma sequência pelos dois caminhos e exige estados idênticos.
   *
   * `deepStrictEqual` sobre o estado inteiro, e não sobre uma lista escolhida
   * de campos: um campo esquecido é precisamente onde uma duplicação
   * divergente se esconderia.
   */
  function assertEquivalent(
    nome: string,
    map: CollisionMap,
    start: readonly [number, number, number],
    inputs: readonly MovementInput[],
    config: MovementConfig = CONFIG,
  ): void {
    const [x, y, z] = start;
    const frames: TraceFrame[] = inputs.map((input) => ({
      duration: config.fixedDt,
      input,
    }));
    const trace = runTrace(map, x, y, z, frames, config);
    const live = runLive(map, x, y, z, inputs, config, true);

    assert.deepStrictEqual(live, trace.finalState, nome);
    assert.strictEqual(live.blocked, trace.blocked, `${nome}: blocked`);
  }

  it('andar em terreno plano', () => {
    const map = new FakeMap().addRow(0, 12, 0, 1);
    assertEquivalent('plano', map, [0.5, 0.5, 1], hold(dirInput(1, 0), 40));
  });

  it('sair da beirada de uma plataforma de altura 3', () => {
    const map = new FakeMap().addRow(0, 1, 0, 3).addRow(2, 8, 0, 1);
    assertEquivalent('beirada', map, [0.5, 0.5, 3], hold(dirInput(1, 0), 60));
  });

  it('subir um degrau na travessia', () => {
    const map = new FakeMap().addRow(0, 12, 0, 1).addRow(3, 12, 0, 2);
    assertEquivalent(
      'degrau',
      map,
      [0.5, 0.5, 1],
      hold({ ...dirInput(1, 0), stepUp: true }, 60),
    );
  });

  it('bater numa parede', () => {
    const map = new FakeMap().addRow(0, 8, 0, 1).addColumn(2, 0, 2);
    assertEquivalent('parede', map, [0.5, 0.5, 1], hold(dirInput(1, 0), 60));
  });

  it('um pulo inteiro, do arranque à aterragem', () => {
    const map = new FakeMap().addColumn(0, 0, 1).addColumn(2, 0, 1);
    assertEquivalent('pulo', map, [0.5, 0.5, 1], [
      ...hold(jumpInput(1, 0), 30),
      ...hold(NO_INPUT, 60),
    ]);
  });

  it('marchas: andar e agachar', () => {
    const map = new FakeMap().addRow(0, 12, 0, 1);
    assertEquivalent('andar', map, [0.5, 0.5, 1], [
      ...hold({ ...dirInput(1, 0), walk: true }, 20),
      ...hold({ ...dirInput(0, 1), crouch: true }, 20),
    ]);
  });

  it('uma `fallSpeed` diferente também tem de coincidir', () => {
    const map = new FakeMap().addRow(0, 1, 0, 3).addRow(2, 8, 0, 1);
    const config: MovementConfig = { ...DEFAULT_CONFIG, fallSpeed: 3 };
    assertEquivalent(
      'fallSpeed=3',
      map,
      [0.5, 0.5, 3],
      hold(dirInput(1, 0), 60),
      config,
    );
  });

  it('igual em CADA passo, e não só no fim', () => {
    // Comparar só o estado final deixa passar divergências que se fecham
    // sozinhas — um campo transitório errado a meio de uma queda, por exemplo,
    // volta ao valor certo quando a queda acaba. Este caso compara os 60
    // estados intermédios, um a um.
    const map = new FakeMap().addRow(0, 1, 0, 3).addRow(2, 8, 0, 1);
    const inputs = hold(dirInput(1, 0), 60);

    for (let k = 1; k <= inputs.length; k++) {
      assertEquivalent(`passo ${k}`, map, [0.5, 0.5, 3], inputs.slice(0, k));
    }
  });

  it('igual em CADA passo também a bater numa parede', () => {
    const map = new FakeMap().addRow(0, 8, 0, 1).addColumn(2, 0, 2);
    const inputs = hold(dirInput(1, 0), 40);

    for (let k = 1; k <= inputs.length; k++) {
      assertEquivalent(`passo ${k}`, map, [0.5, 0.5, 1], inputs.slice(0, k));
    }
  });
});

// ------------------------------------------------------------------ 6. o pulo sobrevive ao quadro

describe('o pulo continua entre quadros', () => {
  it('um pulo iniciado no quadro 1 continua no ar com o botão largado', () => {
    const map = new FakeMap().addRow(0, 12, 0, 1);

    // Quadro 1: pulo. Do quadro 2 em diante o botão está LARGADO — se o estado
    // do pulo morresse no fim da chamada, o personagem voltava ao chão aqui.
    let state = stepWithMap(
      createMovementState(0.5, 0.5, 1),
      jumpInput(1, 0),
      CONFIG.fixedDt,
      CONFIG,
      map,
    );

    assert.strictEqual(state.airborne, true, 'o quadro 1 tem de deixar o ar');
    assert.strictEqual(state.jump.zOrigin, 1);
    assert.strictEqual(state.jump.zDest, 2, 'o pulo sobe exactamente um nível');

    let progressoAnterior = state.jump.progress;
    assert.ok(progressoAnterior > 0, 'o pulo já avançou no quadro 1');

    // 24 quadros sem tocar no botão: o pulo tem de continuar e progredir.
    for (let i = 2; i <= 25; i++) {
      state = stepWithMap(state, dirInput(1, 0), CONFIG.fixedDt, CONFIG, map);
      assert.strictEqual(state.airborne, true, `quadro ${i}: caiu do ar sozinho`);
      assert.ok(
        state.jump.progress > progressoAnterior,
        `quadro ${i}: o progresso do pulo não avançou`,
      );
      assert.strictEqual(state.jump.zOrigin, 1, `quadro ${i}: origem do pulo mudou`);
      assert.strictEqual(state.jump.zDest, 2, `quadro ${i}: destino do pulo mudou`);
      progressoAnterior = state.jump.progress;
    }

    // O z é discreto: 1 até meio do pulo, 2 daí em diante.
    assert.strictEqual(state.z, 2, 'passado o meio do pulo, o z é o de destino');

    // Deixa o pulo acabar. Sobre chão liso de topo z=1, a gravidade traz-no de volta.
    for (let i = 0; i < 40; i++) {
      state = stepWithMap(state, NO_INPUT, CONFIG.fixedDt, CONFIG, map);
    }
    assert.strictEqual(state.airborne, false, 'o pulo tem de acabar');
    assert.strictEqual(state.z, 1, 'aterrou no chão liso');
    assert.strictEqual(state.jump.progress, 1, 'o pulo está concluído');
  });

  it('o z troca a meio do pulo e nunca é fraccionário', () => {
    const map = new FakeMap().addRow(0, 12, 0, 1);

    let state = createMovementState(0.5, 0.5, 1);
    const zPorQuadro: number[] = [];
    for (let i = 0; i < 30; i++) {
      const input = i === 0 ? jumpInput(1, 0) : dirInput(1, 0);
      state = stepWithMap(state, input, CONFIG.fixedDt, CONFIG, map);
      assert.ok(Number.isInteger(state.z), `quadro ${i}: z fraccionário`);
      zPorQuadro.push(state.z);
    }

    // O passo lê o `effectiveZ` do pulo **antes** de o avançar, portanto o
    // quadro k vê o progresso (k−1)/30 e a troca cai no quadro cujo progresso
    // de entrada já é ≥ 0,5.
    //
    // Esse quadro é o 17.º (índice 16) e não o 16.º: `advanceJump` soma
    // 1/60 ÷ 0,5 quinze vezes e chega a 0,49999999999999994, que é menor que
    // 0,5 por um bit. É aritmética IEEE 754 determinística — o valor é o mesmo
    // em qualquer máquina —, e o que importa fixar é que a troca é única e o z
    // nunca fica entre os dois.
    assert.deepStrictEqual(zPorQuadro.slice(0, 16), Array(16).fill(1));
    assert.deepStrictEqual(zPorQuadro.slice(16), Array(14).fill(2));
  });

  it('agachado não pula — nem no primeiro quadro', () => {
    const map = new FakeMap().addRow(0, 12, 0, 1);

    const state = stepWithMap(
      createMovementState(0.5, 0.5, 1),
      { dir: { x: 0, y: 0 }, jump: true, stepUp: false, stepDown: false, crouch: true },
      CONFIG.fixedDt,
      CONFIG,
      map,
    );

    assert.strictEqual(state.airborne, false);
    assert.strictEqual(state.z, 1);
    assert.strictEqual(state.gait, 'crouch');
  });
});

// ------------------------------------------------------------------ dt real, variável

describe('o dt é real e variável; o passo interno continua fixo', () => {
  it('um dt menor que o passo fixo não avança nada e fica no acumulador', () => {
    const map = new FakeMap().addRow(0, 12, 0, 1);
    const s0 = createMovementState(0.5, 0.5, 1);

    const s1 = stepWithMap(s0, dirInput(1, 0), 0.005, CONFIG, map);

    assert.strictEqual(s1.pos.x, 0.5, 'meio passo não move nada');
    assert.strictEqual(s1.accumulator, 0.005);
    assert.strictEqual(s1.blocked, false);
  });

  it('um quadro longo consome vários passos fixos de uma vez', () => {
    const map = new FakeMap().addRow(0, 12, 0, 1);
    const s0 = createMovementState(0.5, 0.5, 1);

    // 0,25 s = 15 passos → 15 · 4/60 = 1 unidade.
    const s1 = stepWithMap(s0, dirInput(1, 0), 0.25, CONFIG, map);

    assert.ok(Math.abs(s1.pos.x - 1.5) < 1e-9, `x = ${s1.pos.x}`);
    assert.ok(s1.accumulator < CONFIG.fixedDt);
  });

  it('dt irregular chega ao mesmo sítio que dt regular — o acumulador é que decide', () => {
    const map = new FakeMap().addRow(0, 12, 0, 1);

    // 30 passos fixos, servidos de duas formas diferentes.
    const regular = runLive(map, 0.5, 0.5, 1, hold(dirInput(1, 0), 30));

    let irregular = createMovementState(0.5, 0.5, 1);
    for (const dt of [0.1, 0.05, 0.2, 0.15]) {
      irregular = stepWithMap(irregular, dirInput(1, 0), dt, CONFIG, map);
    }

    assert.ok(
      Math.abs(irregular.pos.x - regular.pos.x) < 1e-9,
      `irregular=${irregular.pos.x} regular=${regular.pos.x}`,
    );
    assert.strictEqual(irregular.z, regular.z);
  });

  it('`blocked` descreve a chamada, não o personagem', () => {
    const map = new FakeMap().addRow(0, 8, 0, 1).addColumn(2, 0, 2);

    // Anda até bater.
    let state = createMovementState(0.5, 0.5, 1);
    for (let i = 0; i < 30; i++) {
      state = stepWithMap(state, dirInput(1, 0), CONFIG.fixedDt, CONFIG, map);
    }
    assert.strictEqual(state.blocked, true, 'está encostado à parede');

    // Vira-se e anda para norte: a chamada seguinte já não é bloqueada.
    const virou = stepWithMap(state, dirInput(0, 1), CONFIG.fixedDt, CONFIG, map);
    assert.strictEqual(virou.blocked, false, '`blocked` não é permanente');
  });
});
