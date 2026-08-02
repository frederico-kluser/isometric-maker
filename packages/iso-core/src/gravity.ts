/**
 * Gravidade e queda — resolução do solo de uma coluna.
 *
 * O motor de movimento sabe subir (degrau, pulo) mas até aqui não sabia
 * descer sozinho: quem pulasse ficava preso em `z + jumpHeight` para sempre.
 * Este módulo é a metade que faltava — e é resolvido **sempre contra o
 * {@link CollisionMap}**, nunca contra píxeis de ecrã.
 *
 * ## Regras
 *
 * - O solo de uma coluna é o **maior `z` entrável** menor ou igual ao `z`
 *   actual. "Entrável" é exactamente `canEnter`: célula livre **e** com
 *   suporte (bloco em `z−1`, ou `z = 0`, que é o plano de chão).
 * - `z` é discreto em todo o instante. A queda desce **níveis inteiros**;
 *   o que acumula fraccionariamente é o progresso da queda, nunca o `z`.
 * - Ar interior existe: `setBlock(x, y, 5, …)` numa coluna vazia empurra ar
 *   para `z = 0..4`. Por isso a busca é célula a célula com `canEnter` e não
 *   `heightAt − 1` — quem cair dentro dessa coluna aterra em `z = 0`, sob o
 *   bloco flutuante, que é o único sítio com suporte.
 *
 * ## Caso degenerado
 *
 * Se nenhuma célula entre `0` e `fromZ` for entrável, o personagem está
 * dentro de sólido. Não há resposta física correcta e {@link groundZAt}
 * devolve o próprio `fromZ` — ou seja, **não cai**. É uma posição inválida
 * que o mapa criou, e este módulo recusa-se a inventar uma saída.
 */

import { canEnter, type CollisionMap } from './collision.ts';

// ------------------------------------------------------------------ constantes

/** Velocidade de queda padrão, em níveis de z por segundo. */
export const DEFAULT_FALL_SPEED = 12;

// ------------------------------------------------------------------ solo

/**
 * Devolve o maior `z` entrável da coluna `(x, y)` que seja `≤ fromZ`.
 *
 * É o nível onde o personagem aterra se cair a partir de `fromZ`.
 *
 * @param fromZ - Nível de onde a queda começa. Valores fraccionários são
 *   truncados; valores negativos são elevados a 0.
 * @returns Um inteiro `≥ 0`. Devolve `fromZ` quando nenhuma célula abaixo é
 *   entrável (personagem dentro de sólido — ver nota do módulo).
 */
export function groundZAt(
  map: CollisionMap,
  x: number,
  y: number,
  fromZ: number,
): number {
  const start = Math.max(0, Math.trunc(fromZ));
  for (let z = start; z >= 0; z--) {
    if (canEnter(map, x, y, z)) return z;
  }
  return start;
}

/**
 * Verifica se a célula `(x, y, z)` tem suporte para o personagem ficar parado.
 *
 * Atalho legível sobre `canEnter` — existe para que o código de queda leia
 * "não está apoiado" em vez de "não pode entrar".
 */
export function isSupported(
  map: CollisionMap,
  x: number,
  y: number,
  z: number,
): boolean {
  return canEnter(map, x, y, z);
}

// ------------------------------------------------------------------ passo de queda

/** Resultado de um passo de queda. */
export interface FallResult {
  /** Novo nível z. **Sempre inteiro.** */
  readonly z: number;
  /** true se ainda está a cair depois deste passo. */
  readonly falling: boolean;
  /**
   * Níveis de queda acumulados e ainda não consumidos (0 ≤ valor < 1).
   *
   * **Não é z, e nunca é somado a z.** É o acumulador que transforma uma
   * velocidade contínua em descidas de nível inteiro.
   */
  readonly fallProgress: number;
  /** Nível de solo calculado para esta coluna. */
  readonly groundZ: number;
}

/**
 * Avança a queda um passo de lógica.
 *
 * Se a célula actual tem suporte, não há queda: devolve o mesmo `z` com
 * `falling: false` e o acumulador zerado.
 *
 * @param fallProgress - Acumulador devolvido pelo passo anterior (0 no início).
 * @param dt - Passo fixo de lógica (s).
 * @param fallSpeed - Velocidade de queda em níveis por segundo.
 */
export function fallStep(
  map: CollisionMap,
  x: number,
  y: number,
  z: number,
  fallProgress: number,
  dt: number,
  fallSpeed: number = DEFAULT_FALL_SPEED,
): FallResult {
  const groundZ = groundZAt(map, x, y, z);

  // Já apoiado — nada a fazer.
  if (groundZ >= z) {
    return { z, falling: false, fallProgress: 0, groundZ };
  }

  const advanced = fallProgress + Math.max(0, fallSpeed) * dt;
  const levels = Math.floor(advanced);
  const nextZ = Math.max(groundZ, z - levels);
  const stillFalling = nextZ > groundZ;

  return {
    z: nextZ,
    falling: stillFalling,
    fallProgress: stillFalling ? advanced - levels : 0,
    groundZ,
  };
}
