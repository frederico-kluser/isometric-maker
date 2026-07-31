/**
 * Traço de entrada — execução determinística de uma sequência de entradas
 * contra o motor de movimento com verificação de colisão.
 *
 * Um "traço" (trace) é uma sequência de "quadros de entrada" (trace frames).
 * Cada quadro tem uma duração (em segundos) e um input. O motor processa
 * cada quadro e produz um estado final determinístico.
 *
 * ## Regras
 *
 * - xy move-se continuamente com velocidade constante.
 * - z só muda por degrau (step up/down) ou pulo.
 * - Colisão de célula e aresta é verificada a cada passo.
 * - Se o movimento horizontal colidir com uma parede ou célula ocupada,
 *   o personagem PARA na posição antes da colisão.
 * - Determinismo: mesma sequência de entradas no mesmo mapa → mesmo resultado.
 */

import {
  createMovementState,
  DEFAULT_CONFIG,
  type MovementState,
  type MovementInput,
  type MovementConfig,
} from './movement.ts';
import { canEnter, canCross, type CollisionMap } from './collision.ts';
import { canStepUp, canStepDown } from './step-up.ts';
import {
  createJump,
  advanceJump,
  effectiveZ,
  isJumpComplete,
  type JumpState,
  NO_JUMP,
} from './jump.ts';

// ------------------------------------------------------------------ tipos

/** Um quadro de entrada: input mantido por `duration` segundos. */
export interface TraceFrame {
  /** Duração em segundos durante a qual o input é mantido. */
  readonly duration: number;
  /** Entrada do jogador neste quadro. */
  readonly input: MovementInput;
}

/** Resultado da execução de um traço. */
export interface TraceResult {
  /** Estado final do movimento após o traço. */
  readonly finalState: MovementState;
  /** Número total de passos de lógica executados. */
  readonly totalSteps: number;
  /** Tempo total simulado (soma das durações). */
  readonly totalTime: number;
  /** true se o traço foi bloqueado por colisão no último quadro. */
  readonly blocked: boolean;
  /** Posição onde o traço foi bloqueado (se blocked=true). */
  readonly blockedAt?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
}

// ------------------------------------------------------------------ movimento horizontal puro

function applyHorizontal(
  state: MovementState,
  input: MovementInput,
  config: MovementConfig,
): MovementState {
  const hasInput = input.dir.x !== 0 || input.dir.y !== 0;
  let vel: { x: number; y: number };
  let facing: number;

  if (hasInput) {
    const len = Math.sqrt(
      input.dir.x * input.dir.x + input.dir.y * input.dir.y,
    );
    const nx = input.dir.x / len;
    const ny = input.dir.y / len;
    vel = { x: nx * config.speed, y: ny * config.speed };
    facing = Math.atan2(ny, nx);
  } else {
    vel = { x: 0, y: 0 };
    facing = state.facing;
  }

  return {
    ...state,
    pos: {
      x: state.pos.x + vel.x * config.fixedDt,
      y: state.pos.y + vel.y * config.fixedDt,
    },
    vel,
    facing,
  };
}

// ------------------------------------------------------------------ resolução de colisão

function resolveCollision(
  map: CollisionMap,
  prevPos: { x: number; y: number },
  nextState: MovementState,
  z: number,
  airborne: boolean,
): { blocked: boolean; state: MovementState } {
  const prevCellX = Math.floor(prevPos.x);
  const prevCellY = Math.floor(prevPos.y);
  const nextCellX = Math.floor(nextState.pos.x);
  const nextCellY = Math.floor(nextState.pos.y);

  if (prevCellX === nextCellX && prevCellY === nextCellY) {
    return { blocked: false, state: nextState };
  }

  // Célula de destino ocupada por bloco → sempre bloqueado
  if (map.hasBlock(nextCellX, nextCellY, z)) {
    return {
      blocked: true,
      state: { ...nextState, pos: prevPos, vel: { x: 0, y: 0 } },
    };
  }

  // Se não estiver no ar, verifica suporte (walkability completa)
  if (!airborne && !canEnter(map, nextCellX, nextCellY, z)) {
    return {
      blocked: true,
      state: { ...nextState, pos: prevPos, vel: { x: 0, y: 0 } },
    };
  }

  // Verifica aresta
  const fromCell = { x: prevCellX, y: prevCellY, z };
  const toCell = { x: nextCellX, y: nextCellY, z };

  if (!canCross(map, fromCell, toCell)) {
    return {
      blocked: true,
      state: { ...nextState, pos: prevPos, vel: { x: 0, y: 0 } },
    };
  }

  return { blocked: false, state: nextState };
}

// ------------------------------------------------------------------ step up / down

/**
 * Tenta subir ou descer um degrau a partir da célula actual.
 *
 * Prioriza a direcção do input. Se o input tiver direção, verifica
 * apenas as direções que fazem sentido (cardinal mais próximo).
 * Se não houver direção, verifica as 4.
 */
function tryStep(
  map: CollisionMap,
  cellX: number,
  cellY: number,
  z: number,
  input: MovementInput,
): number {
  // Determina direções prioritárias baseadas no input
  const dirs: [number, number][] = [];
  if (input.dir.x !== 0 || input.dir.y !== 0) {
    // Prioriza a direção do input e direções próximas
    const angle = Math.atan2(input.dir.y, input.dir.x);
    // Converte ângulo para direção cardeal mais próxima
    const octant = Math.round(angle / (Math.PI / 4));
    const cardinalDirs: [number, number][] = [
      [1, 0],   // leste (0°)
      [0, 1],   // norte (90°)
      [-1, 0],  // oeste (180°)
      [0, -1],  // sul (270°)
    ];
    // Adiciona a direção cardeal mais próxima primeiro
    const idx = ((octant % 4) + 4) % 4;
    dirs.push(cardinalDirs[idx]!);
    // Depois as outras
    for (let i = 1; i < 4; i++) {
      dirs.push(cardinalDirs[(idx + i) % 4]!);
    }
  } else {
    dirs.push([0, 1], [0, -1], [1, 0], [-1, 0]);
  }

  if (input.stepUp) {
    for (const [dx, dy] of dirs) {
      const from = { x: cellX, y: cellY, z };
      const to = { x: cellX + dx!, y: cellY + dy!, z: z + 1 };
      if (canStepUp(map, from, to)) {
        return z + 1;
      }
    }
  }

  if (input.stepDown) {
    for (const [dx, dy] of dirs) {
      const from = { x: cellX, y: cellY, z };
      const to = { x: cellX + dx!, y: cellY + dy!, z: z - 1 };
      if (canStepDown(map, from, to)) {
        return z - 1;
      }
    }
  }

  return z;
}

// ------------------------------------------------------------------ execução

export function runTrace(
  map: CollisionMap,
  startX: number,
  startY: number,
  startZ: number,
  frames: readonly TraceFrame[],
  config: MovementConfig = DEFAULT_CONFIG,
): TraceResult {
  let state = createMovementState(startX, startY, startZ);
  let jump: JumpState = NO_JUMP;
  let totalSteps = 0;
  let totalTime = 0;
  let blocked = false;
  let blockedAt: { x: number; y: number; z: number } | undefined;

  for (const frame of frames) {
    if (blocked) break;

    let remaining = frame.duration;
    totalTime += frame.duration;

    while (remaining >= config.fixedDt && !blocked) {
      remaining -= config.fixedDt;

      const z = isJumpComplete(jump) ? state.z : effectiveZ(jump);
      const cellX = Math.floor(state.pos.x);
      const cellY = Math.floor(state.pos.y);

      // Step up/down (só no chão, sem pulo activo)
      let newZ = z;
      if (isJumpComplete(jump) && !frame.input.jump) {
        newZ = tryStep(map, cellX, cellY, z, frame.input);
      }

      // Inicia pulo
      if (frame.input.jump && isJumpComplete(jump)) {
        jump = createJump(z, z + config.jumpHeight);
      }

      // Avança pulo
      if (!isJumpComplete(jump)) {
        jump = advanceJump(jump, config.fixedDt, config.jumpDuration);
      }

      // Movimento horizontal
      const prevPos = state.pos;
      state = applyHorizontal({ ...state, z: newZ }, frame.input, config);

      // Colisão
      // Durante o pulo, usa o z de destino para permitir pular sobre obstáculos.
      const zForCollision = isJumpComplete(jump) ? newZ : jump.zDest;
      const airborne = !isJumpComplete(jump);
      const resolved = resolveCollision(map, prevPos, state, zForCollision, airborne);

      if (resolved.blocked) {
        blocked = true;
        blockedAt = {
          x: Math.floor(prevPos.x),
          y: Math.floor(prevPos.y),
          z: zForCollision,
        };
        state = resolved.state;
        break;
      }

      state = resolved.state;
      totalSteps++;
    }
  }

  const finalZ = isJumpComplete(jump) ? state.z : jump.zDest;

  return {
    finalState: { ...state, z: finalZ },
    totalSteps,
    totalTime,
    blocked,
    blockedAt,
  };
}

// ------------------------------------------------------------------ utilitários

export const NO_DIR = { x: 0, y: 0 };

export const NO_INPUT: MovementInput = {
  dir: NO_DIR,
  jump: false,
  stepUp: false,
  stepDown: false,
};

export function dirInput(dx: number, dy: number): MovementInput {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { ...NO_INPUT };
  return {
    dir: { x: dx / len, y: dy / len },
    jump: false,
    stepUp: false,
    stepDown: false,
  };
}

export function jumpInput(dx: number, dy: number): MovementInput {
  const base = dirInput(dx, dy);
  return { ...base, jump: true };
}

export function stepUpInput(dx: number, dy: number): MovementInput {
  const base = dirInput(dx, dy);
  return { ...base, stepUp: true };
}

export function stepDownInput(dx: number, dy: number): MovementInput {
  const base = dirInput(dx, dy);
  return { ...base, stepDown: true };
}
