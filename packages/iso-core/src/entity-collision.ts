/**
 * Colisão entre entidades — bloco caindo atinge o ator, caixa empurra caixa.
 *
 * ## O que este módulo adiciona
 *
 * Até aqui a colisão era só entidade-vs-mundo: o ator contra os blocos do mapa
 * ({@link resolveMovement}), e o bloco contra o grid ({@link stepBlockPhysics}).
 *
 * Este módulo acrescenta entidade-vs-entidade:
 *
 * - Um bloco que cai sobre o ator empurra-o para fora (MTV).
 * - Duas caixas que se intersectam são separadas na menor distância.
 * - Prepara a base para empurrar caixas no futuro (bloco deslizante).
 *
 * ## Regras
 *
 * - O ator é uma {@link EntityBox} com `half = PLAYER_HALF`.
 * - Um bloco é uma {@link EntityBox} com `half = 0.5` (exatamente uma célula).
 * - A separação devolve as duas caixas na posição pós-colisão, ou `null` se
 *   a penetração for maior que {@link MAX_PUSH}.
 * - Um bloco que cai sobre o ator resolve-se com push-out do ator (o bloco
 *   não é empurrado — ele é mais massivo).
 */

import {
  entityAabb,
  PLAYER_HALF,
  pushOutOf,
  solidAtOf,
  type EntityBox,
  type PlayerCell,
  type SolidAt,
} from './collision-box.ts';
import type { CollisionMap } from './collision.ts';
import { aabbOverlaps, type GridAabb } from './map-instances.ts';
import type { FallingBlock } from './block-physics.ts';

// ------------------------------------------------------------------ detecção

/**
 * Um bloco a cair intersecta o ator?
 *
 * Compara a célula do bloco com a caixa do ator. O bloco ocupa exatamente uma
 * célula `(bx, by, bz)` e o ator ocupa uma caixa centrada em `(px+0.5, py+0.5)`
 * com meia-largura `PLAYER_HALF` no nível `pz`.
 */
export function fallingBlockHitsPlayer(
  block: { x: number; y: number; z: number },
  player: PlayerCell,
): boolean {
  return (
    block.x === player.x &&
    block.y === player.y &&
    block.z === player.z
  );
}

/** Cria uma {@link EntityBox} para o ator a partir da sua célula. */
export function playerEntityBox(player: PlayerCell): EntityBox {
  return {
    cx: player.x + 0.5,
    cy: player.y + 0.5,
    z: player.z,
    half: PLAYER_HALF,
  };
}

/** Cria uma {@link EntityBox} para um bloco (ocupa exatamente uma célula). */
export function blockEntityBox(
  x: number,
  y: number,
  z: number,
): EntityBox {
  return {
    cx: x + 0.5,
    cy: y + 0.5,
    z,
    half: 0.5,
  };
}

// ------------------------------------------------------------------ empurrar

/**
 * Empurra o ator para fora do caminho de um bloco a cair.
 *
 * O ator é empurrado na direção de menor penetração (MTV). O bloco não se move
 * — a suposição é que o bloco é mais massivo e aterra onde cai.
 *
 * @param block - Bloco que está a cair (ou aterrou).
 * @param player - Posição actual do ator.
 * @param solidAt - Função que diz se uma célula barra o ator.
 * @returns Nova posição do ator, ou `null` se o push-out falhar (penetração
 *   além do limite ou ator sem saída).
 */
export function pushPlayerFromFallingBlock(
  block: { x: number; y: number; z: number },
  player: PlayerCell,
  solidAt: SolidAt,
): PlayerCell | null {
  // Se o bloco não está na mesma célula que o ator, não há o que empurrar.
  if (!fallingBlockHitsPlayer(block, player)) return null;

  const playerBox = playerEntityBox(player);
  const pushed = pushOutOf(solidAt, playerBox);
  if (!pushed) return null;

  return {
    x: Math.floor(pushed.cx),
    y: Math.floor(pushed.cy),
    z: pushed.z,
  };
}

// ------------------------------------------------------------------ intersecção

/** Resultado da separação de duas caixas que se intersectam. */
export interface SeparationResult {
  /** Caixa A na nova posição. */
  readonly a: EntityBox;
  /** Caixa B na nova posição. */
  readonly b: EntityBox;
}

/**
 * Separa duas caixas que se intersectam, movendo a caixa A.
 *
 * A caixa A é empurrada na direção de menor penetração. A caixa B não se move.
 * Se as caixas não se intersectam, devolve `null`.
 *
 * @param a - Caixa a ser empurrada (ex: ator).
 * @param b - Caixa que fica parada (ex: bloco).
 * @param solidAt - Função de sólido para validar a posição final.
 * @returns Caixas separadas, ou `null` se já estiverem separadas ou se o
 *   push-out falhar.
 */
export function separateBoxes(
  a: EntityBox,
  b: EntityBox,
  solidAt: SolidAt,
): SeparationResult | null {
  const aabbA = entityAabb(a);
  const aabbB = entityAabb(b);

  if (!aabbOverlaps(aabbA, aabbB)) return null;

  const pushed = pushOutOf(solidAt, a);
  if (!pushed) return null;

  return { a: pushed, b };
}

/**
 * Verifica se duas entidades se intersectam, usando seus AABBs de grid.
 *
 * Encapsula `aabbOverlaps` com a convenção de `EntityBox`.
 */
export function entitiesOverlap(a: EntityBox, b: EntityBox): boolean {
  return aabbOverlaps(entityAabb(a), entityAabb(b));
}

// ------------------------------------------------------------------ batch

/**
 * Aplica push-out do ator contra todos os blocos que estão a cair e que
 * intersectam a sua célula.
 *
 * Processa os blocos em ordem determinística (por z). O ator pode ser empurrado
 * várias vezes se múltiplos blocos o atingirem — cada push-out resolve uma
 * penetração.
 *
 * @param player - Posição do ator.
 * @param falling - Blocos que estão a cair.
 * @param solidAt - Função de sólido.
 * @returns Nova posição do ator, ou `null` se o push-out falhar.
 */
export function pushPlayerFromFallingBlocks(
  player: PlayerCell,
  falling: readonly FallingBlock[],
  solidAt: SolidAt,
): PlayerCell | null {
  let current = player;
  // Ordena por z (de cima para baixo) para processar primeiro os blocos mais
  // altos — um bloco em z=5 empurra o ator para uma posição que pode depois
  // ser atingida por um bloco em z=4.
  const sorted = [...falling].sort((a, b) => b.z - a.z);

  for (const fb of sorted) {
    if (!fallingBlockHitsPlayer(fb, current)) continue;
    const pushed = pushPlayerFromFallingBlock(fb, current, solidAt);
    if (pushed) current = pushed;
  }
  return current;
}
