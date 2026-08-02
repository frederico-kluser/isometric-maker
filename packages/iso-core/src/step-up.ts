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

// ------------------------------------------------------------------ resolveStepZ

/**
 * Resolve o `z` depois de um pedido de degrau a partir da célula actual.
 *
 * Um degrau precisa de uma célula **vizinha** para onde subir ou descer.
 * Esta função escolhe a candidata, dando prioridade à direcção do movimento
 * e caindo nas outras três cardinais a seguir; sem direcção, tenta as quatro
 * por uma ordem fixa (determinismo).
 *
 * Se nenhuma vizinha aceitar o degrau, devolve o `z` de entrada. É por isso
 * que segurar a tecla de subir no meio do nada não faz o personagem levitar:
 * a regra é a mesma que valida o degrau, não um incremento cego.
 *
 * @param dirX - Componente x da direcção do movimento (0 se parado).
 * @param dirY - Componente y da direcção do movimento (0 se parado).
 * @param wantsUp - Botão de subir degrau pressionado.
 * @param wantsDown - Botão de descer degrau pressionado.
 */
export function resolveStepZ(
  map: CollisionMap,
  cellX: number,
  cellY: number,
  z: number,
  dirX: number,
  dirY: number,
  wantsUp: boolean,
  wantsDown: boolean,
): number {
  if (!wantsUp && !wantsDown) return z;

  const dirs: [number, number][] = [];
  const cardinalDirs: [number, number][] = [
    [1, 0], // leste (0°)
    [0, 1], // norte (90°)
    [-1, 0], // oeste (180°)
    [0, -1], // sul (270°)
  ];

  if (dirX !== 0 || dirY !== 0) {
    // Prioriza a direcção do input e as direcções próximas.
    const angle = Math.atan2(dirY, dirX);
    const octant = Math.round(angle / (Math.PI / 4));
    const idx = ((octant % 4) + 4) % 4;
    dirs.push(cardinalDirs[idx]!);
    for (let i = 1; i < 4; i++) {
      dirs.push(cardinalDirs[(idx + i) % 4]!);
    }
  } else {
    dirs.push([0, 1], [0, -1], [1, 0], [-1, 0]);
  }

  if (wantsUp) {
    for (const [dx, dy] of dirs) {
      const from = { x: cellX, y: cellY, z };
      const to = { x: cellX + dx!, y: cellY + dy!, z: z + 1 };
      if (canStepUp(map, from, to)) {
        return z + 1;
      }
    }
  }

  if (wantsDown) {
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
