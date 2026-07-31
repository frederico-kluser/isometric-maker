/**
 * Pulo com parábola em espaço de tela (F3-04).
 *
 * ## Regras
 *
 * - `z` é DISCRETO em todo o instante. O modelo nunca vê um z fraccionário.
 * - A parábola é DECORAÇÃO visual: existe apenas em espaço de tela, não no modelo.
 * - O pulo tem 3 fases:
 *     1. **Subida** (progresso 0.0 → 0.5): `z` permanece no `zOrigin`.
 *        O sprite sobe visualmente via `visualOffsetY`.
 *     2. **Transição** (progresso = 0.5): `z` muda de `zOrigin` para `zDest`.
 *     3. **Descida** (progresso 0.5 → 1.0): `z` permanece no `zDest`.
 *        O sprite desce visualmente até `visualOffsetY` voltar a 0.
 * - `visualOffsetY(progresso)` devolve o deslocamento vertical em píxeis de
 *   ecrã. É uma parábola pura, independente do estado do modelo.
 *
 * ## Colisão durante o pulo
 *
 * **Regra declarada:** a colisão é verificada no `z` efectivo do modelo
 * (sempre inteiro). Durante a fase de subida (progresso < 0.5), as colisões
 * são testadas em `zOrigin`. Durante a fase de descida (progresso ≥ 0.5),
 * são testadas em `zDest`. O `visualOffsetY` NUNCA afecta a colisão — é
 * apenas uma transformação de ecrã.
 *
 * ## Invariante
 *
 * Em qualquer ponto da transição, `Number.isInteger(z)` é `true`. Este
 * invariante é testado para todos os passos de 0.0 a 1.0.
 */

// ------------------------------------------------------------------ tipos

/** Estado do pulo. */
export interface JumpState {
  /** Nível z de onde o pulo começou. */
  readonly zOrigin: number;
  /** Nível z de destino do pulo. */
  readonly zDest: number;
  /** Progresso da animação, de 0.0 a 1.0. */
  readonly progress: number;
}

// ------------------------------------------------------------------ constantes

/** Estado inicial: nenhum pulo activo. */
export const NO_JUMP: JumpState = {
  zOrigin: 0,
  zDest: 0,
  progress: 1.0,
};

// ------------------------------------------------------------------ fábrica

/**
 * Cria um estado de pulo.
 *
 * @param zOrigin - Nível de onde o pulo começa.
 * @param zDest - Nível de destino (pode ser maior, menor ou igual a zOrigin).
 */
export function createJump(zOrigin: number, zDest: number): JumpState {
  return { zOrigin, zDest, progress: 0.0 };
}

// ------------------------------------------------------------------ z efectivo

/**
 * Devolve o z efectivo do modelo no progresso actual.
 *
 * **Garantia:** o valor devolvido é SEMPRE inteiro.
 *
 * Regra:
 *   - progresso < 0.5  → `zOrigin`
 *   - progresso ≥ 0.5  → `zDest`
 *
 * Isto significa que a transição de z ocorre exactamente a meio do pulo,
 * quando o sprite está no ponto mais alto da parábola visual.
 */
export function effectiveZ(state: JumpState): number {
  if (state.progress < 0.5) return state.zOrigin;
  return state.zDest;
}

// ------------------------------------------------------------------ parábola visual

/**
 * Devolve o deslocamento vertical em píxeis de ecrã para o progresso dado.
 *
 * A parábola é simétrica: começa em 0, atinge o pico em progresso=0.5,
 * e volta a 0 em progresso=1.0.
 *
 * Fórmula: `offset = -4 * jumpHeightPx * progress * (1 - progress)`
 *
 * O sinal é **negativo** porque no ecrã o eixo Y cresce para baixo.
 * Um offset negativo move o sprite para CIMA.
 *
 * @param progress - Progresso da animação (0.0 a 1.0).
 * @param jumpHeightPx - Altura do salto em píxeis de ecrã.
 */
export function visualOffsetY(progress: number, jumpHeightPx: number): number {
  return -4 * jumpHeightPx * progress * (1 - progress);
}

// ------------------------------------------------------------------ avanço

/**
 * Avança o estado do pulo.
 *
 * @param state - Estado actual do pulo.
 * @param dt - Tempo decorrido (em segundos).
 * @param jumpDuration - Duração total do pulo (em segundos).
 * @returns Novo estado do pulo.
 */
export function advanceJump(
  state: JumpState,
  dt: number,
  jumpDuration: number,
): JumpState {
  if (state.progress >= 1.0) return state;

  const step = dt / jumpDuration;
  const newProgress = Math.min(1.0, state.progress + step);

  return {
    zOrigin: state.zOrigin,
    zDest: state.zDest,
    progress: newProgress,
  };
}

// ------------------------------------------------------------------ conclusão

/**
 * Verifica se o pulo terminou.
 */
export function isJumpComplete(state: JumpState): boolean {
  return state.progress >= 1.0;
}

/**
 * Verifica se o pulo está na fase de transição (mudança de z).
 *
 * A transição ocorre quando o progresso cruza 0.5.
 * Útil para o sistema de colisão saber quando actualizar o z do modelo.
 */
export function isJumpTransitioning(state: JumpState, prevProgress: number): boolean {
  return prevProgress < 0.5 && state.progress >= 0.5;
}
