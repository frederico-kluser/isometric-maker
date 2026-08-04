/**
 * Testes do personagem no mapa: direção, entrada, escolha de animação, e o
 * contrato de pulo que o usuário pediu — **sobe um bloco, nunca dois**.
 *
 * O teste de pulo roda a física de verdade (`stepWithMap` do iso-core) contra o
 * adaptador de colisão de verdade (`buildCollisionMap`), montando o mapa no
 * mesmo formato que o editor salva. É a única forma de a asserção significar
 * alguma coisa: um duplo de teste provaria só que o duplo funciona.
 *
 * Execute com: node --test src/map/actor.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_FALLBACK,
  DIRECTION_NAMES,
  actionFor,
  buildActorVisual,
  directionIndexFromAngle,
  directionNameFor,
  frameUrl,
  viewDirectionIndex,
  worldDirectionFromKeys,
  type ActorFrames,
} from './actor.ts';
import { buildCollisionMap, spawnZAt } from './collision-map.ts';
import {
  DEFAULT_CONFIG,
  createMovementState,
  type MovementInput,
  type MovementState,
} from '../../../../packages/iso-core/src/movement.ts';
import { stepWithMap } from '../../../../packages/iso-core/src/simulate.ts';
import type { MapData } from '../../../../packages/iso-core/src/map.ts';

// ------------------------------------------------------------------ direção

test('sul é (+1,+1): descer na tela é vir na direção de quem olha', () => {
  assert.equal(directionIndexFromAngle(Math.atan2(1, 1)), 0);
  assert.equal(directionNameFor(0), 'south');
});

test('as oito direções saem na ordem canônica, de π/4 em π/4', () => {
  const esperado = [...DIRECTION_NAMES];
  const obtido = Array.from({ length: 8 }, (_, i) =>
    directionNameFor(directionIndexFromAngle(Math.PI / 4 + (i * Math.PI) / 4)),
  );
  assert.deepStrictEqual(obtido, esperado);
});

test('oeste é (-1,+1): esquerda na tela', () => {
  assert.equal(directionNameFor(directionIndexFromAngle(Math.atan2(1, -1))), 'west');
});

test('o índice é estável no meio de cada setor, não só no centro exato', () => {
  // ±π/9 é menos que meio setor (π/8): tem que continuar no mesmo índice.
  for (let i = 0; i < 8; i += 1) {
    const centro = Math.PI / 4 + (i * Math.PI) / 4;
    assert.equal(directionIndexFromAngle(centro - Math.PI / 9), i, `setor ${i} à esquerda`);
    assert.equal(directionIndexFromAngle(centro + Math.PI / 9), i, `setor ${i} à direita`);
  }
});

test('girar a câmera 90° reindexa a direção do sprite', () => {
  const sul = Math.atan2(1, 1);
  const semGiro = viewDirectionIndex(sul, 0);
  assert.equal(directionNameFor(semGiro), 'south');
  // Quatro giros de 90° voltam ao começo — a propriedade que importa.
  assert.equal(viewDirectionIndex(sul, 4), semGiro);
  // E cada giro muda de fato a direção mostrada.
  const vistos = new Set([0, 1, 2, 3].map((t) => viewDirectionIndex(sul, t)));
  assert.equal(vistos.size, 4, 'cada vista mostra uma direção diferente');
});

// ------------------------------------------------------------------ entrada

test('sem tecla, sem direção', () => {
  const d = worldDirectionFromKeys(
    { up: false, down: false, left: false, right: false },
    0,
  );
  assert.deepStrictEqual(d, { x: 0, y: 0 });
});

test('teclas opostas se cancelam', () => {
  const d = worldDirectionFromKeys(
    { up: true, down: true, left: false, right: false },
    0,
  );
  assert.deepStrictEqual(d, { x: 0, y: 0 });
});

test('a direção da entrada é sempre unitária, inclusive na diagonal', () => {
  const combos: readonly (keyof typeof base)[][] = [
    ['up'],
    ['down'],
    ['left'],
    ['right'],
    ['up', 'left'],
    ['up', 'right'],
    ['down', 'left'],
    ['down', 'right'],
  ];
  const base = { up: false, down: false, left: false, right: false };
  for (const teclas of combos) {
    for (const rot of [0, 1, 2, 3] as const) {
      const held = { ...base };
      for (const k of teclas) held[k] = true;
      const d = worldDirectionFromKeys(held, rot);
      assert.ok(
        Math.abs(Math.hypot(d.x, d.y) - 1) < 1e-9,
        `${teclas.join('+')} na vista ${rot} deveria ser unitário`,
      );
    }
  }
});

test('descer a tela anda para o sul quando a câmera não girou', () => {
  const d = worldDirectionFromKeys(
    { up: false, down: true, left: false, right: false },
    0,
  );
  // Sul é (+1,+1) normalizado.
  assert.ok(d.x > 0 && d.y > 0, `esperava (+,+), veio (${d.x}, ${d.y})`);
});

test('a mesma tecla vira direção de mundo diferente em cada vista', () => {
  const held = { up: false, down: true, left: false, right: false };
  const vistos = ([0, 1, 2, 3] as const).map((r) => {
    const d = worldDirectionFromKeys(held, r);
    return `${Math.round(d.x)}:${Math.round(d.y)}`;
  });
  assert.equal(new Set(vistos).size, 4, 'girar a câmera tem que remapear o W');
});

// ------------------------------------------------------------------ animação

function stateWith(over: Partial<MovementState>): MovementState {
  return { ...createMovementState(0, 0, 0), ...over };
}

test('a ação vem do gait, nunca da velocidade', () => {
  const andando = stateWith({ gait: 'walk', vel: { x: 1, y: 0 } });
  const correndo = stateWith({ gait: 'run', vel: { x: 1, y: 0 } });
  assert.equal(actionFor(andando), 'caminhando');
  assert.equal(actionFor(correndo), 'correndo');
  // A MESMA velocidade, gaits diferentes: se alguém inferir pela velocidade,
  // estes dois colapsam num só e o teste cai.
  assert.notEqual(actionFor(andando), actionFor(correndo));
});

test('parado é parado mesmo correndo de gait', () => {
  assert.equal(actionFor(stateWith({ gait: 'run', vel: { x: 0, y: 0 } })), 'parado');
});

test('agachado vence andar, e o ar vence tudo', () => {
  assert.equal(
    actionFor(stateWith({ gait: 'crouch', vel: { x: 1, y: 0 } })),
    'agachado',
  );
  assert.equal(
    actionFor(stateWith({ gait: 'crouch', vel: { x: 1, y: 0 }, airborne: true })),
    'pulando',
  );
  assert.equal(
    actionFor(stateWith({ gait: 'run', vel: { x: 1, y: 0 }, falling: true })),
    'pulando',
  );
});

test('correr sem quadros de correr cai para andar, e depois para parado', () => {
  const so_parado: ActorFrames = { parado: { south: ['/a/parado-s.png'] } };
  assert.equal(
    frameUrl(so_parado, undefined, 'correndo', 'south', 0),
    '/a/parado-s.png',
  );
  const com_andar: ActorFrames = {
    parado: { south: ['/a/parado-s.png'] },
    caminhando: { south: ['/a/andar-s.png'] },
  };
  assert.equal(
    frameUrl(com_andar, undefined, 'correndo', 'south', 0),
    '/a/andar-s.png',
    'andar é degrau melhor que parado para correr',
  );
});

test('sem pose nenhuma, cai para o quadro estático das 8 direções', () => {
  const base = { south: ['/a/dir-south-00.png'] };
  assert.equal(
    frameUrl({}, base, 'correndo', 'south', 7),
    '/a/dir-south-00.png',
  );
  assert.equal(frameUrl({}, undefined, 'correndo', 'south', 0), null);
});

test('o ciclo de quadros dá a volta e nunca sai da lista', () => {
  const frames: ActorFrames = {
    caminhando: { south: ['a', 'b', 'c'] },
  };
  const vistos = Array.from({ length: 7 }, (_, t) =>
    frameUrl(frames, undefined, 'caminhando', 'south', t),
  );
  assert.deepStrictEqual(vistos, ['a', 'b', 'c', 'a', 'b', 'c', 'a']);
});

test('toda ação tem cadeia de fallback e todas terminam em parado', () => {
  for (const [acao, cadeia] of Object.entries(ACTION_FALLBACK)) {
    assert.ok(cadeia.length > 0, `${acao} sem cadeia`);
    assert.equal(cadeia.at(-1), 'parado', `${acao} não termina em parado`);
  }
});

// ------------------------------------------------------------------ colisão

/** Coluna sólida de altura `h` em cada célula listada. */
function mapaDe(colunas: Record<string, number>): MapData {
  const blocks: Record<string, { block: string; count: number }[]> = {};
  for (const [chave, h] of Object.entries(colunas)) {
    if (h > 0) blocks[chave] = [{ block: 'pedra', count: h }];
  }
  return { blocks, edges: [] };
}

test('ar dentro da coluna não é sólido', () => {
  // Bloco solto em z=2, com ar explícito em z=0 e z=1 — é o que placeBlock
  // grava quando se coloca um bloco no vazio.
  const map: MapData = {
    blocks: { '0:0': [{ block: '', count: 2 }, { block: 'pedra', count: 1 }] },
    edges: [],
  };
  const c = buildCollisionMap(map);
  assert.equal(c.hasBlock(0, 0, 0), false, 'ar não é sólido');
  assert.equal(c.hasBlock(0, 0, 1), false);
  assert.equal(c.hasBlock(0, 0, 2), true);
  assert.equal(c.hasBlock(0, 0, 3), false, 'acima do topo não é sólido');
});

test('spawnZAt põe o personagem em cima da coluna, nunca dentro dela', () => {
  const c = buildCollisionMap(mapaDe({ '0:0': 1, '1:0': 3, '2:0': 0 }));
  assert.equal(spawnZAt(c, 0, 0), 1);
  assert.equal(spawnZAt(c, 1, 0), 3);
  assert.equal(spawnZAt(c, 2, 0), 0, 'coluna vazia assenta no plano de chão');
});

test('aresta registrada bloqueia', () => {
  const map: MapData = {
    blocks: { '0:0': [{ block: 'pedra', count: 1 }] },
    edges: [{ x: 0, y: 0, z: 1, lado: 'L', tipo: 'parede' }],
  };
  const c = buildCollisionMap(map);
  assert.equal(c.hasEdge(0, 0, 1, 'L'), true);
  assert.equal(c.hasEdge(0, 0, 1, 'N'), false);
});

// ------------------------------------------------------------------ o pulo

const CONFIG = DEFAULT_CONFIG;

function inputCom(over: Partial<MovementInput>): MovementInput {
  return { dir: { x: 0, y: 0 }, jump: false, stepUp: false, stepDown: false, ...over };
}

/**
 * Roda a física por `segundos`, em passos fixos, com a mesma entrada.
 * `jumpAt` dispara o pulo num passo só — segurar a tecla não deveria mudar
 * nada, mas o teste não depende disso.
 */
function simular(
  map: MapData,
  inicio: { x: number; y: number; z: number },
  input: MovementInput,
  segundos: number,
  opts: { readonly jumpNoPrimeiro?: boolean } = {},
): MovementState {
  const colisao = buildCollisionMap(map);
  let state = createMovementState(inicio.x, inicio.y, inicio.z);
  const passos = Math.round(segundos / CONFIG.fixedDt);
  for (let i = 0; i < passos; i += 1) {
    const entrada =
      opts.jumpNoPrimeiro === true && i === 0 ? { ...input, jump: true } : input;
    state = stepWithMap(state, entrada, CONFIG.fixedDt, CONFIG, colisao);
  }
  return state;
}

/**
 * Piso de altura 1 em toda a faixa, com um degrau de `altura` níveis a partir
 * de x = 2 para leste. O personagem começa em (0.5, 0.5) sobre o piso.
 */
function pisoComDegrau(altura: number): MapData {
  const colunas: Record<string, number> = {};
  for (let x = -2; x <= 8; x += 1) {
    for (let y = -2; y <= 2; y += 1) {
      colunas[`${x}:${y}`] = x >= 2 && y === 0 ? 1 + altura : 1;
    }
  }
  return mapaDe(colunas);
}

test('pulando, sobe UM bloco', () => {
  // Sul é (+1,+1); para andar só no +x a direção tem que ser (1,0).
  const state = simular(
    pisoComDegrau(1),
    { x: 0.5, y: 0.5, z: 1 },
    inputCom({ dir: { x: 1, y: 0 } }),
    3,
    { jumpNoPrimeiro: false },
  );
  // Sem pular, o degrau de 1 nível barra: o personagem para antes dele.
  assert.equal(state.z, 1, 'sem pulo e sem stepUp, não sobe');
  assert.ok(state.pos.x < 2, `deveria parar antes de x=2, parou em ${state.pos.x}`);
});

test('com pulo, alcança o degrau de um nível', () => {
  const map = pisoComDegrau(1);
  const colisao = buildCollisionMap(map);
  let state = createMovementState(1.5, 0.5, 1);
  // Pula e continua andando para leste: o pulo tem que levar para cima do degrau.
  for (let i = 0; i < Math.round(1.5 / CONFIG.fixedDt); i += 1) {
    state = stepWithMap(
      state,
      inputCom({ dir: { x: 1, y: 0 }, jump: i === 0 }),
      CONFIG.fixedDt,
      CONFIG,
      colisao,
    );
  }
  assert.equal(state.z, 2, 'o pulo tem que pousar em cima do degrau de 1 nível');
  assert.ok(state.pos.x >= 2, `deveria ter entrado no degrau, parou em ${state.pos.x}`);
});

test('com pulo, NÃO alcança o degrau de dois níveis', () => {
  const map = pisoComDegrau(2);
  const colisao = buildCollisionMap(map);
  let state = createMovementState(1.5, 0.5, 1);
  for (let i = 0; i < Math.round(1.5 / CONFIG.fixedDt); i += 1) {
    state = stepWithMap(
      state,
      inputCom({ dir: { x: 1, y: 0 }, jump: i === 0 }),
      CONFIG.fixedDt,
      CONFIG,
      colisao,
    );
  }
  assert.equal(state.z, 1, 'dois níveis é parede, não degrau');
  assert.ok(state.pos.x < 2, `não deveria entrar no degrau, entrou até ${state.pos.x}`);
});

test('agachado não pula', () => {
  const map = pisoComDegrau(1);
  const colisao = buildCollisionMap(map);
  let state = createMovementState(1.5, 0.5, 1);
  for (let i = 0; i < Math.round(1.5 / CONFIG.fixedDt); i += 1) {
    state = stepWithMap(
      state,
      inputCom({ dir: { x: 1, y: 0 }, jump: true, crouch: true }),
      CONFIG.fixedDt,
      CONFIG,
      colisao,
    );
  }
  assert.equal(state.z, 1, 'agachado recusa o pulo, então o degrau continua barrando');
});

test('correr é mais rápido que andar, e andar mais que agachar', () => {
  const map = mapaDe(
    Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`${i - 4}:0`, 1] as const),
    ),
  );
  const dist = (input: MovementInput): number =>
    simular(map, { x: 0.5, y: 0.5, z: 1 }, input, 1).pos.x - 0.5;

  const correndo = dist(inputCom({ dir: { x: 1, y: 0 } }));
  const andando = dist(inputCom({ dir: { x: 1, y: 0 }, walk: true }));
  const agachado = dist(inputCom({ dir: { x: 1, y: 0 }, crouch: true }));

  assert.ok(correndo > andando, `correr ${correndo} deveria passar andar ${andando}`);
  assert.ok(andando > agachado, `andar ${andando} deveria passar agachar ${agachado}`);
  // E correr é o PADRÃO: sem modificador nenhum, é a marcha rápida.
  assert.ok(correndo > 0);
});

test('andar para fora da plataforma cai até o chão', () => {
  // Plataforma de altura 3 até x=1; de x=2 em diante, nada.
  const colunas: Record<string, number> = {};
  for (let x = -2; x <= 1; x += 1) for (let y = -2; y <= 2; y += 1) colunas[`${x}:${y}`] = 3;
  const state = simular(
    mapaDe(colunas),
    { x: 0.5, y: 0.5, z: 3 },
    inputCom({ dir: { x: 1, y: 0 } }),
    3,
  );
  assert.equal(state.z, 0, 'sem coluna embaixo, cai até o plano de chão');
  assert.ok(state.pos.x > 2, `deveria ter saído da plataforma, parou em ${state.pos.x}`);
});

// ------------------------------------------------------------------ visual do ator (sombra + seta)

test('sombra: plena no chão, some no ápice do pulo e volta no pouso', () => {
  assert.equal(buildActorVisual(0, 0, 0).shadowOpacity, 1, 'início do pulo, ainda no chão');
  assert.equal(buildActorVisual(0, 0, 0.5).shadowOpacity, 0, 'ápice — a sombra some');
  assert.equal(buildActorVisual(0, 0, 1).shadowOpacity, 1, 'pousou — a sombra volta');
});

test('sombra: em pé o personagem TEM sombra — opacidade não pode vir do relógio do pulo', () => {
  // NO_JUMP (personagem parado) tem progress = 1.0; a fórmula "1 − progress"
  // apagaria a sombra de quem está parado.
  assert.equal(buildActorVisual(0, 0, 1).shadowOpacity, 1);
});

test('sombra: opacidade acompanha a ALTURA da parábola, simétrica em torno de 0.5', () => {
  const p = buildActorVisual(0, 0, 0.25).shadowOpacity;
  const q = buildActorVisual(0, 0, 0.75).shadowOpacity;
  assert.equal(p, q, 'subir e descer na mesma altura têm a mesma sombra');
});

test('sombra: progresso fora de [0,1] fica preso no intervalo válido', () => {
  for (const p of [-1, 2, 3]) {
    const v = buildActorVisual(0, 0, p).shadowOpacity;
    assert.ok(v >= 0 && v <= 1, `progresso ${p} deu opacidade ${v}`);
  }
});

test('a sombra assenta no piso informado — o z do iso-core, sem o offset do pulo', () => {
  assert.equal(buildActorVisual(0, 3, 1).floorY, 3);
  assert.equal(buildActorVisual(2, 0, 0.5).floorY, 0);
});

test('o raio da sombra é proporcional ao personagem (~0.3 unidade)', () => {
  assert.equal(buildActorVisual(0, 0, 1).shadowRadius, 0.3);
});

test('seta: sul (índice 0) é π/4 e cada índice soma π/4', () => {
  assert.equal(buildActorVisual(0, 0, 1).directionAngle, Math.PI / 4);
  assert.equal(buildActorVisual(1, 0, 1).directionAngle, Math.PI / 2, 'sudoeste');
  assert.equal(buildActorVisual(4, 0, 1).directionAngle, (5 * Math.PI) / 4, 'norte');
});

test('seta: dá a volta — sudeste (índice 7) é o mesmo ângulo de sul, menos um setor', () => {
  assert.equal(buildActorVisual(7, 0, 1).directionAngle, 0);
});

test('seta: o ângulo reconverte para o índice de direção original (round-trip)', () => {
  for (let i = 0; i < 8; i += 1) {
    const angle = buildActorVisual(i, 0, 1).directionAngle;
    assert.equal(directionIndexFromAngle(angle), i, `índice ${i} → ângulo ${angle}`);
  }
});

test('seta: índice fora de 0..7 dá a volta, como a numeração de direções', () => {
  assert.equal(
    buildActorVisual(-1, 0, 1).directionAngle,
    buildActorVisual(7, 0, 1).directionAngle,
  );
  assert.equal(
    buildActorVisual(8, 0, 1).directionAngle,
    buildActorVisual(0, 0, 1).directionAngle,
  );
});

test('seta: cada giro da câmera desloca o ângulo de mundo do sul de tela', () => {
  // O "sul" de tela (índice 0) é π/4 no mundo só na vista 0. Cada giro de
  // 90° da câmera o desloca por −π/2 no plano XZ — sem a compensação a seta
  // apontaria errado nas vistas 1, 2 e 3.
  assert.equal(buildActorVisual(0, 0, 1, 0).directionAngle, Math.PI / 4, 'vista 0');
  assert.equal(buildActorVisual(0, 0, 1, 1).directionAngle, (7 * Math.PI) / 4, 'vista 1');
  assert.equal(buildActorVisual(0, 0, 1, 2).directionAngle, (5 * Math.PI) / 4, 'vista 2');
  assert.equal(buildActorVisual(0, 0, 1, 3).directionAngle, (3 * Math.PI) / 4, 'vista 3');
});

test('seta: quatro giros da câmera voltam ao ângulo original', () => {
  for (let i = 0; i < 8; i += 1) {
    assert.equal(
      buildActorVisual(i, 0, 1, 4).directionAngle,
      buildActorVisual(i, 0, 1, 0).directionAngle,
      `índice ${i}`,
    );
  }
});

test('seta: com o giro da câmera, o ângulo ainda reconverte para o índice de tela', () => {
  for (const turn of [0, 1, 2, 3] as const) {
    for (let i = 0; i < 8; i += 1) {
      const angle = buildActorVisual(i, 0, 1, turn).directionAngle;
      assert.equal(
        directionIndexFromAngle(angle + turn * (Math.PI / 2)),
        i,
        `índice ${i} na vista ${turn}`,
      );
    }
  }
});
