/**
 * Degrau automático — F3-03.
 *
 * Uma função única e citável que decide se um personagem pode subir ou descer
 * um degrau entre duas células adjacentes com diferença de altura.
 *
 * ## Regra do degrau
 *
 * - **Sobe** se o piso de destino está exactamente `z+1` E `canEnter(destino)` E
 *   não há parede na aresta entre as duas células em NENHUM dos dois níveis.
 * - **Desce** se o piso de destino está `z−1` (ou mais) E `canEnter(destino)` E
 *   não há parede na aresta em NENHUM dos dois níveis.
 * - `z+2` ou superior NÃO sobe — precisa de dois degraus ou de um pulo.
 * - Parede na aresta bloqueia o degrau em qualquer direcção.
 *
 * ## Separação de responsabilidades
 *
 * `canStepUp` e `canStepDown` usam `canEnter` de F3-02 para walkability.
 * A travessia da aresta é verificada directamente (sem `canCross`) porque
 * `canCross` exige que a célula de destino ao mesmo z seja entrável — o que
 * nunca é verdade quando o destino tem um bloco de suporte em `from.z`.
 */

import { canEnter, type CollisionMap, type CollisionCell } from './collision.ts';
import type { EdgeSide } from './map.ts';

// ------------------------------------------------------------------ step up

/**
 * Determina os lados da aresta entre duas células adjacentes.
 *
 * Devolve os dois lados: `[fromSide, toSide]`.  Se as células não forem
 * adjacentes cardinais, devolve `null`.
 */
function edgeSides(
  from: CollisionCell,
  to: CollisionCell,
): [EdgeSide, EdgeSide] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 1 && dy === 0) return ['L', 'O'];
  if (dx === -1 && dy === 0) return ['O', 'L'];
  if (dx === 0 && dy === 1) return ['N', 'S'];
  if (dx === 0 && dy === -1) return ['S', 'N'];
  return null;
}

/**
 * Verifica se existe uma parede entre duas células adjacentes ao nível `z`.
 *
 * Consulta AMBOS os lados da aresta porque o editor pode registar a parede
 * em qualquer uma das duas células.
 */
function hasWallAt(
  map: CollisionMap,
  from: CollisionCell,
  to: CollisionCell,
  z: number,
): boolean {
  const sides = edgeSides(from, to);
  if (!sides) return false;

  const [fromSide, toSide] = sides;
  return (
    map.hasEdge(from.x, from.y, z, fromSide) ||
    map.hasEdge(to.x, to.y, z, toSide)
  );
}

// ------------------------------------------------------------------ canStepUp

/**
 * Verifica se um personagem pode subir de `from` para `to`.
 *
 * Condições:
 *   1. `to.z === from.z + 1` — exactamente um nível acima.
 *   2. `canEnter(map, to.x, to.y, to.z)` — a célula de destino é entrável.
 *   3. Não há parede na aresta em `from.z` nem em `to.z`.
 *
 * @returns `true` se o degrau para cima é possível.
 */
export function canStepUp(
  map: CollisionMap,
  from: CollisionCell,
  to: CollisionCell,
): boolean {
  // Posição de partida inválida (abaixo do chão)
  if (from.z < 0) return false;

  // Só sobe exactamente um nível
  if (to.z !== from.z + 1) return false;

  // O destino tem de ser entrável
  if (!canEnter(map, to.x, to.y, to.z)) return false;

  // Células têm de ser adjacentes
  if (!edgeSides(from, to)) return false;

  // Não pode haver parede na aresta em NENHUM dos dois níveis.
  if (hasWallAt(map, from, to, from.z)) return false;
  if (hasWallAt(map, from, to, to.z)) return false;

  return true;
}

// ------------------------------------------------------------------ stepZOnCross

/**
 * Resolve o `z` no instante em que o personagem **atravessa** para outra célula.
 *
 * ## Por que o degrau acontece na travessia, e não antes
 *
 * A versão anterior deste motor subia o `z` mal existisse um degrau numa
 * vizinha, com o personagem ainda em cima da célula baixa — uma aposta de que
 * ele ia atravessar a seguir. Enquanto não houve gravidade, ninguém contestou
 * a aposta. A gravidade é uma segunda opinião sobre o mesmo instante, e avalia
 * a célula onde o personagem **está**: ali, o `z` subido não tem suporte, e a
 * queda desfazia o degrau antes da travessia acontecer.
 *
 * As duas regras olhavam para células diferentes e a mais recente ganhava, o
 * que fazia depender "este degrau é escalável?" da fase do acumulador de queda
 * em vez da geometria. A correcção não é ensinar a gravidade a ignorar a
 * posição real — é tirar a especulação: o degrau passa a acontecer no único
 * instante em que as duas regras concordam sobre qual é a célula do chão, que
 * é a travessia da aresta.
 *
 * ## Regra
 *
 * - Sobe para `from.z + 1` se `canStepUp(from, destino)`.
 * - Desce para `from.z − 1` se `canStepDown(from, destino)`.
 * - Caso contrário devolve `from.z`, e a travessia é julgada pela colisão normal.
 *
 * Diagonais **não** sobem: `canStepUp` exige adjacência cardinal. Isto é
 * limitação herdada, não decisão nova — ver a nota em `trace.ts`.
 *
 * @param from - Célula de origem, com o `z` actual do personagem.
 * @param toX - Coluna x da célula para onde está a atravessar.
 * @param toY - Coluna y da célula para onde está a atravessar.
 * @param wantsUp - Botão de subir degrau pressionado.
 * @param wantsDown - Botão de descer degrau pressionado.
 */
export function stepZOnCross(
  map: CollisionMap,
  from: CollisionCell,
  toX: number,
  toY: number,
  wantsUp: boolean,
  wantsDown: boolean,
): number {
  if (wantsUp && canStepUp(map, from, { x: toX, y: toY, z: from.z + 1 })) {
    return from.z + 1;
  }
  if (wantsDown && canStepDown(map, from, { x: toX, y: toY, z: from.z - 1 })) {
    return from.z - 1;
  }
  return from.z;
}

// ------------------------------------------------------------------ canStepDown

/**
 * Verifica se um personagem pode descer de `from` para `to`.
 *
 * Condições:
 *   1. `to.z < from.z` — o destino está abaixo (não necessariamente só um nível).
 *   2. `canEnter(map, to.x, to.y, to.z)` — a célula de destino é entrável.
 *   3. Não há parede na aresta em `from.z` nem em `to.z`.
 *
 * Descidas de mais de um nível são permitidas (ex.: saltar de uma plataforma).
 * A física de dano de queda não é tratada aqui — pertence ao sistema de vida.
 *
 * @returns `true` se a descida é possível.
 */
export function canStepDown(
  map: CollisionMap,
  from: CollisionCell,
  to: CollisionCell,
): boolean {
  // Posição de partida inválida (abaixo do chão)
  if (from.z < 0) return false;

  // Só desce se o destino está abaixo
  if (to.z >= from.z) return false;

  // O destino tem de ser entrável
  if (!canEnter(map, to.x, to.y, to.z)) return false;

  // Células têm de ser adjacentes
  if (!edgeSides(from, to)) return false;

  // Não pode haver parede na aresta em NENHUM dos dois níveis.
  if (hasWallAt(map, from, to, from.z)) return false;
  if (hasWallAt(map, from, to, to.z)) return false;

  return true;
}
