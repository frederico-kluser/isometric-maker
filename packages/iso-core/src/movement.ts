/**
 * Movimento contínuo em xy, discreto em z.
 *
 * `step(estado, entrada, dt)` é uma função pura: sem DOM, sem rede, sem PixiJS.
 * Opera com passo fixo de lógica e acumulador de tempo, garantindo que a mesma
 * sequência de entradas produz exactamente o mesmo resultado.
 *
 * ## Regras
 *
 * - xy move-se continuamente com velocidade **do modo de locomoção actual**.
 * - z só muda por **degrau** (subir/descer um nível), **pulo** (sobe no
 *   máximo um bloco) ou **gravidade** (queda). Nunca muda continuamente.
 * - O passo de lógica é fixo (1/60 s por padrão). O `dt` real é acumulado
 *   e consumido em passos discretos.
 *
 * ## Correr é o padrão; andar é o modificador
 *
 * `config.speed` continua a ser a velocidade **base**, e base aqui quer dizer
 * *a correr*. O utilizador do editor segura Shift para **andar**, e o Shift
 * chega cá como `input.walk`. Agachar (`input.crouch`) é mais lento ainda e
 * **impede o pulo**. A ordem é sempre `correr > andar > agachado`, e quem
 * desenha lê o modo em `state.gait` em vez de o adivinhar pela velocidade.
 *
 * ## Gravidade exige mapa
 *
 * `step` aceita um {@link CollisionMap} **opcional**. Sem mapa não existe
 * "topo sólido da coluna" — a queda não é uma opção desligada, é uma
 * pergunta sem resposta —, portanto o comportamento vertical fica o que
 * sempre foi. Com mapa, a queda é resolvida contra o mapa a cada passo e o
 * pulo deixa de ficar preso em `z + jumpHeight`.
 *
 * ## Contrato determinístico
 *
 * `step` é uma função pura do estado anterior, da entrada e do dt acumulado.
 * Duas chamadas com os mesmos argumentos produzem o mesmo estado seguinte.
 * Isto é verificável: grave uma sequência de entradas, alimente-a ao motor,
 * e o estado final será idêntico em qualquer plataforma.
 */

import type { CollisionMap } from './collision.ts';
import { fallStep, DEFAULT_FALL_SPEED } from './gravity.ts';
import { stepZOnCross } from './step-up.ts';

// ------------------------------------------------------------------ tipos

/** Vector 2D. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * Modo de locomoção resolvido a partir da entrada.
 *
 * É o campo que o renderizador lê para escolher a animação — não deve
 * inferir o modo comparando velocidades, porque `config.speed` é
 * configurável e a comparação partiria com qualquer valor novo.
 */
export type Gait = 'run' | 'walk' | 'crouch';

/** Estado completo do movimento. */
export interface MovementState {
  /** Posição no plano xy (contínua). */
  readonly pos: Vec2;
  /** Nível z actual (discreto). */
  readonly z: number;
  /** Velocidade horizontal (unidades/s). */
  readonly vel: Vec2;
  /** Velocidade vertical durante um pulo (unidades/s). Null quando no chão. */
  readonly vz: number | null;
  /** Tempo restante do pulo (s). 0 quando no chão. */
  readonly jumpTime: number;
  /** true se está no ar (pulo activo). */
  readonly airborne: boolean;
  /** Direcção para a qual o personagem está virado (8 direcções). */
  readonly facing: number; // ângulo em radianos
  /** Acumulador de dt ainda não consumido (para passo fixo). */
  readonly accumulator: number;
  /** Modo de locomoção deste passo. Observável por quem desenha. */
  readonly gait: Gait;
  /** true se está agachado. Enquanto for true, o pulo é recusado. */
  readonly crouching: boolean;
  /** true se está a cair por gravidade (célula sem suporte por baixo). */
  readonly falling: boolean;
  /**
   * Níveis de queda acumulados e ainda não consumidos (0 ≤ valor < 1).
   *
   * **Nunca é somado a `z`.** É o acumulador que converte a velocidade de
   * queda contínua em descidas de nível inteiro; `z` continua discreto.
   */
  readonly fallProgress: number;
}

/** Entrada do jogador num dado instante. */
export interface MovementInput {
  /** Direcção horizontal (-1..1 em x e y). Normalizada pelo caller. */
  readonly dir: Vec2;
  /** true se o botão de pulo está pressionado neste frame. */
  readonly jump: boolean;
  /** true se o botão de subir degrau está pressionado. */
  readonly stepUp: boolean;
  /** true se o botão de descer degrau está pressionado. */
  readonly stepDown: boolean;
  /**
   * Modificador de andar (Shift no editor). Omisso ou `false` → **corre**.
   *
   * Correr é o padrão; andar é o que se pede explicitamente.
   */
  readonly walk?: boolean;
  /**
   * true enquanto o personagem está agachado. Omisso ou `false` → de pé.
   *
   * Agachado é mais lento do que a andar **e não pula**.
   */
  readonly crouch?: boolean;
}

/** Configuração do motor de movimento. */
export interface MovementConfig {
  /**
   * Velocidade horizontal base (unidades/s) — a velocidade **a correr**.
   *
   * Andar e agachar são fracções desta, não constantes próprias.
   */
  readonly speed: number;
  /** Passo fixo de lógica (s). Padrão: 1/60. */
  readonly fixedDt: number;
  /** Duração total do pulo (s). */
  readonly jumpDuration: number;
  /**
   * Altura do pulo em níveis de z.
   *
   * **Fica limitada a {@link MAX_JUMP_RISE}.** Um valor maior não sobe mais:
   * ver {@link jumpRise}.
   */
  readonly jumpHeight: number;
  /** Tempo de cooldown entre degraus (s). */
  readonly stepCooldown: number;
  /** Multiplicador de `speed` ao andar. Padrão: {@link DEFAULT_WALK_FACTOR}. */
  readonly walkFactor?: number;
  /** Multiplicador de `speed` ao agachar. Padrão: {@link DEFAULT_CROUCH_FACTOR}. */
  readonly crouchFactor?: number;
  /** Velocidade de queda em níveis de z por segundo. Padrão: {@link DEFAULT_FALL_SPEED}. */
  readonly fallSpeed?: number;
}

// ------------------------------------------------------------------ constantes

/** Fracção de `speed` usada ao andar (Shift). */
export const DEFAULT_WALK_FACTOR = 0.5;

/** Fracção de `speed` usada ao agachar. */
export const DEFAULT_CROUCH_FACTOR = 0.35;

/**
 * Subida máxima de um pulo, em níveis de z. **Um bloco, nunca dois.**
 *
 * É um limite estrutural, não um valor de configuração: `jumpHeight` maior
 * do que isto é silenciosamente reduzido por {@link jumpRise}. Quem quiser
 * alcançar dois níveis usa dois degraus, e essa é a decisão do projecto —
 * não um esquecimento.
 */
export const MAX_JUMP_RISE = 1;

export const DEFAULT_CONFIG: MovementConfig = {
  speed: 4, // unidades/s, a correr
  fixedDt: 1 / 60,
  jumpDuration: 0.5, // meio segundo
  jumpHeight: 1, // sobe 1 nível de z
  stepCooldown: 0.3, // 300 ms entre degraus
  walkFactor: DEFAULT_WALK_FACTOR,
  crouchFactor: DEFAULT_CROUCH_FACTOR,
  fallSpeed: DEFAULT_FALL_SPEED,
};

// ------------------------------------------------------------------ locomoção

/**
 * Resolve o modo de locomoção a partir da entrada.
 *
 * Agachar ganha a andar, que ganha a correr — o modificador mais restritivo
 * vence, de modo que segurar Shift agachado não devolve velocidade nenhuma.
 */
export function resolveGait(input: MovementInput): Gait {
  if (input.crouch === true) return 'crouch';
  if (input.walk === true) return 'walk';
  return 'run';
}

/** Velocidade horizontal (unidades/s) para o modo dado. */
export function speedFor(gait: Gait, config: MovementConfig): number {
  if (gait === 'crouch') {
    return config.speed * (config.crouchFactor ?? DEFAULT_CROUCH_FACTOR);
  }
  if (gait === 'walk') {
    return config.speed * (config.walkFactor ?? DEFAULT_WALK_FACTOR);
  }
  return config.speed;
}

/**
 * Subida efectiva de um pulo, em níveis de z.
 *
 * Trunca para inteiro, corta negativos e limita a {@link MAX_JUMP_RISE}.
 * É aqui que "o pulo sobe no máximo um bloco" deixa de ser uma promessa da
 * documentação e passa a ser aritmética.
 */
export function jumpRise(config: MovementConfig): number {
  const requested = Math.trunc(config.jumpHeight);
  if (!Number.isFinite(requested) || requested < 0) return 0;
  return Math.min(MAX_JUMP_RISE, requested);
}

// ------------------------------------------------------------------ fábrica

/** Cria um estado inicial de movimento na posição dada. */
export function createMovementState(
  x: number,
  y: number,
  z: number,
): MovementState {
  return {
    pos: { x, y },
    z,
    vel: { x: 0, y: 0 },
    vz: null,
    jumpTime: 0,
    airborne: false,
    facing: 0,
    accumulator: 0,
    gait: 'run',
    crouching: false,
    falling: false,
    fallProgress: 0,
  };
}

// ------------------------------------------------------------------ step

const VEC2_ZERO: Vec2 = { x: 0, y: 0 };

/**
 * Avança o estado de movimento um passo de lógica (fixedDt).
 *
 * Esta função é a unidade determinística do motor. É chamada tantas vezes
 * quantas o acumulador permitir.
 *
 * @param map - Mapa de colisão. Quando omitido não há gravidade: sem mapa
 *   não existe topo sólido de coluna para onde cair.
 */
function fixedStep(
  state: MovementState,
  input: MovementInput,
  config: MovementConfig,
  map: CollisionMap | undefined,
): MovementState {
  let { pos, z, vel, vz, jumpTime, airborne, facing, accumulator, fallProgress } =
    state;

  // --- modo de locomoção ---
  const gait = resolveGait(input);
  const crouching = gait === 'crouch';
  const speed = speedFor(gait, config);

  // --- direcção horizontal ---
  const hasInput = input.dir.x !== 0 || input.dir.y !== 0;
  if (hasInput) {
    // Normaliza e aplica velocidade
    const len = Math.sqrt(input.dir.x * input.dir.x + input.dir.y * input.dir.y);
    const nx = input.dir.x / len;
    const ny = input.dir.y / len;
    vel = { x: nx * speed, y: ny * speed };
    facing = Math.atan2(ny, nx);
  } else {
    vel = VEC2_ZERO;
  }

  // --- movimento horizontal (contínuo) ---
  const prevCellX = Math.floor(pos.x);
  const prevCellY = Math.floor(pos.y);
  pos = {
    x: pos.x + vel.x * config.fixedDt,
    y: pos.y + vel.y * config.fixedDt,
  };

  const cellX = Math.floor(pos.x);
  const cellY = Math.floor(pos.y);
  const crossing = cellX !== prevCellX || cellY !== prevCellY;

  // --- pulo (balístico, discreto em z) ---
  if (airborne) {
    jumpTime -= config.fixedDt;

    if (jumpTime <= 0) {
      // Pulo terminou. Sem mapa, o personagem fica onde parou; com mapa,
      // a gravidade logo abaixo trá-lo para o topo sólido da coluna.
      z = Math.round(z); // garante que z é inteiro
      vz = null;
      jumpTime = 0;
      airborne = false;
    }
    // Durante o pulo, z não muda — o pulo é um arco visual,
    // mas z só muda na aterragem (discreto).
  } else if (input.jump && !crouching) {
    // Agachado não pula: a recusa é aqui, não no chamador.
    const rise = jumpRise(config);
    const target = z + rise;
    // Um bloco em `target` é um tecto: impede a subida em vez de a permitir
    // e deixar o personagem dentro da pedra. Sem mapa não há tecto a consultar.
    if (map === undefined || !map.hasBlock(cellX, cellY, target)) {
      airborne = true;
      jumpTime = config.jumpDuration;
      vz = rise / config.jumpDuration; // velocidade média
      z = target; // z sobe IMEDIATAMENTE (discreto)
    }
  }

  // --- degrau (discreto em z) ---
  //
  // Com mapa, o degrau usa a mesma regra que `runTrace`: acontece na travessia
  // da aresta, contra a célula de destino. É isso que impede a gravidade de o
  // desfazer — as duas regras passam a avaliar a mesma célula. Sem mapa não há
  // destino a consultar e o degrau continua a ser o incremento cego que sempre
  // foi, que é o único comportamento possível sem saber o que há à volta.
  if (!airborne) {
    if (map !== undefined) {
      if (crossing) {
        z = stepZOnCross(
          map,
          { x: prevCellX, y: prevCellY, z },
          cellX,
          cellY,
          input.stepUp,
          input.stepDown,
        );
      }
    } else if (input.stepUp) {
      z = z + 1;
    } else if (input.stepDown) {
      z = Math.max(0, z - 1);
    }
  }

  // --- gravidade (só com mapa, e só fora do pulo) ---
  //
  // Avalia a célula onde o personagem está, com o z que ele tem depois do
  // degrau. Como o degrau só acontece na travessia, esse z já corresponde a
  // esta célula — as duas regras nunca julgam células diferentes. Deixar o
  // degrau subir antes da travessia era o que punha a gravidade a desfazê-lo.
  let falling = false;
  if (map !== undefined && !airborne) {
    const fall = fallStep(
      map,
      cellX,
      cellY,
      z,
      fallProgress,
      config.fixedDt,
      config.fallSpeed ?? DEFAULT_FALL_SPEED,
    );
    z = fall.z;
    falling = fall.falling;
    fallProgress = fall.fallProgress;
  } else {
    fallProgress = 0;
  }

  // --- actualiza acumulador ---
  // (já foi consumido um fixedDt — o caller trata disso)

  return {
    pos,
    z,
    vel,
    vz,
    jumpTime,
    airborne,
    facing,
    accumulator, // mantido pelo caller
    gait,
    crouching,
    falling,
    fallProgress,
  };
}

/**
 * Avança o estado de movimento com um `dt` real (em segundos).
 *
 * O dt é acumulado e consumido em passos fixos de `config.fixedDt`.
 * Qualquer excedente fica no acumulador para a próxima chamada.
 *
 * @param map - Mapa de colisão **opcional**. Com mapa há gravidade e o pulo
 *   aterra no topo sólido da coluna; sem mapa o comportamento vertical é o
 *   histórico (o pulo sobe e não desce), porque não há solo a consultar.
 *   Colisão horizontal continua a **não** ser tratada aqui — é `runTrace`
 *   que junta movimento e colisão.
 * @returns Novo estado de movimento.
 */
export function step(
  state: MovementState,
  input: MovementInput,
  dt: number,
  config: MovementConfig = DEFAULT_CONFIG,
  map?: CollisionMap,
): MovementState {
  // Acumula o dt real
  const total = state.accumulator + dt;

  // Calcula quantos passos fixos cabem no acumulador.
  // Usamos floor para evitar o problema de precisão do while com
  // subtracção repetida de 1/60 em floating point.
  const stepsToRun = Math.floor(total / config.fixedDt);

  let current = state;
  for (let i = 0; i < stepsToRun; i++) {
    current = fixedStep(current, input, config, map);
  }

  // O acumulador restante é o que sobrou depois dos passos inteiros
  const remainder = total - stepsToRun * config.fixedDt;

  return { ...current, accumulator: remainder };
}
