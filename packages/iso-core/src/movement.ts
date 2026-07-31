/**
 * Movimento contínuo em xy, discreto em z.
 *
 * `step(estado, entrada, dt)` é uma função pura: sem DOM, sem rede, sem PixiJS.
 * Opera com passo fixo de lógica e acumulador de tempo, garantindo que a mesma
 * sequência de entradas produz exactamente o mesmo resultado.
 *
 * ## Regras
 *
 * - xy move-se continuamente com velocidade constante.
 * - z só muda por **degrau** (subir/descer um nível) ou **pulo** (salto
 *   balístico com altura fixa). Nunca muda continuamente.
 * - O passo de lógica é fixo (1/60 s por padrão). O `dt` real é acumulado
 *   e consumido em passos discretos.
 *
 * ## Contrato determinístico
 *
 * `step` é uma função pura do estado anterior, da entrada e do dt acumulado.
 * Duas chamadas com os mesmos argumentos produzem o mesmo estado seguinte.
 * Isto é verificável: grave uma sequência de entradas, alimente-a ao motor,
 * e o estado final será idêntico em qualquer plataforma.
 */

// ------------------------------------------------------------------ tipos

/** Vector 2D. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

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
}

/** Configuração do motor de movimento. */
export interface MovementConfig {
  /** Velocidade horizontal (unidades/s). */
  readonly speed: number;
  /** Passo fixo de lógica (s). Padrão: 1/60. */
  readonly fixedDt: number;
  /** Duração total do pulo (s). */
  readonly jumpDuration: number;
  /** Altura do pulo em níveis de z. */
  readonly jumpHeight: number;
  /** Tempo de cooldown entre degraus (s). */
  readonly stepCooldown: number;
}

// ------------------------------------------------------------------ constantes

export const DEFAULT_CONFIG: MovementConfig = {
  speed: 4, // unidades/s
  fixedDt: 1 / 60,
  jumpDuration: 0.5, // meio segundo
  jumpHeight: 1, // sobe 1 nível de z
  stepCooldown: 0.3, // 300 ms entre degraus
};

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
  };
}

// ------------------------------------------------------------------ step

const VEC2_ZERO: Vec2 = { x: 0, y: 0 };

/**
 * Avança o estado de movimento um passo de lógica (fixedDt).
 *
 * Esta função é a unidade determinística do motor. É chamada tantas vezes
 * quantas o acumulador permitir.
 */
function fixedStep(
  state: MovementState,
  input: MovementInput,
  config: MovementConfig,
): MovementState {
  let { pos, z, vel, vz, jumpTime, airborne, facing, accumulator } = state;

  // --- direcção horizontal ---
  const hasInput = input.dir.x !== 0 || input.dir.y !== 0;
  if (hasInput) {
    // Normaliza e aplica velocidade
    const len = Math.sqrt(input.dir.x * input.dir.x + input.dir.y * input.dir.y);
    const nx = input.dir.x / len;
    const ny = input.dir.y / len;
    vel = { x: nx * config.speed, y: ny * config.speed };
    facing = Math.atan2(ny, nx);
  } else {
    vel = VEC2_ZERO;
  }

  // --- movimento horizontal (contínuo) ---
  pos = {
    x: pos.x + vel.x * config.fixedDt,
    y: pos.y + vel.y * config.fixedDt,
  };

  // --- pulo (balístico, discreto em z) ---
  if (airborne) {
    jumpTime -= config.fixedDt;

    if (jumpTime <= 0) {
      // Pulo terminou — volta ao chão
      z = Math.round(z); // garante que z é inteiro
      vz = null;
      jumpTime = 0;
      airborne = false;
    }
    // Durante o pulo, z não muda — o pulo é um arco visual,
    // mas z só muda na aterragem (discreto).
  } else if (input.jump) {
    // Inicia pulo
    airborne = true;
    jumpTime = config.jumpDuration;
    vz = config.jumpHeight / config.jumpDuration; // velocidade média
    z = z + config.jumpHeight; // z sobe IMEDIATAMENTE (discreto)
  }

  // --- degrau (discreto em z) ---
  if (!airborne) {
    if (input.stepUp) {
      z = z + 1;
    } else if (input.stepDown) {
      z = Math.max(0, z - 1);
    }
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
  };
}

/**
 * Avança o estado de movimento com um `dt` real (em segundos).
 *
 * O dt é acumulado e consumido em passos fixos de `config.fixedDt`.
 * Qualquer excedente fica no acumulador para a próxima chamada.
 *
 * @returns Novo estado de movimento.
 */
export function step(
  state: MovementState,
  input: MovementInput,
  dt: number,
  config: MovementConfig = DEFAULT_CONFIG,
): MovementState {
  // Acumula o dt real
  const total = state.accumulator + dt;

  // Calcula quantos passos fixos cabem no acumulador.
  // Usamos floor para evitar o problema de precisão do while com
  // subtracção repetida de 1/60 em floating point.
  const stepsToRun = Math.floor(total / config.fixedDt);

  let current = state;
  for (let i = 0; i < stepsToRun; i++) {
    current = fixedStep(current, input, config);
  }

  // O acumulador restante é o que sobrou depois dos passos inteiros
  const remainder = total - stepsToRun * config.fixedDt;

  return { ...current, accumulator: remainder };
}
