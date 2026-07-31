/**
 * Colisão de célula e de aresta (F3-02).
 *
 * Duas funções separadas:
 *   - `canEnter(map, x, y, z)` — o personagem pode estar nesta célula?
 *   - `canCross(map, from, to)` — o personagem pode atravessar a aresta
 *     entre duas células adjacentes?
 *
 * Movimento diagonal testa AS DUAS arestas envolvidas.  Se qualquer uma
 * das duas estiver bloqueada, o movimento diagonal é recusado.
 *
 * ## Regras de walkability
 *
 * Uma célula é "entrável" se:
 *   1. Não tem um bloco (está vazia).
 *   2. Tem suporte: para z=0, o chão é sempre suporte; para z>0, a
 *      célula em z−1 deve ter um bloco (estar a pisar algo).
 *
 * ## Regras de travessia
 *
 * Uma aresta é "atravessável" se:
 *   1. A célula de destino é entrável.
 *   2. Não existe uma parede na aresta entre as duas células.
 *
 * Para diagonais, ambas as arestas cardinais que compõem o movimento
 * são testadas.  Se qualquer uma estiver bloqueada, a diagonal falha.
 */
import type { EdgeSide } from './map.ts';
import type { BlockStore } from './map.ts';
import type { EdgeStore } from './map.ts';

// ------------------------------------------------------------------ tipos

export interface CollisionCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Interface mínima que o motor de colisão precisa do mapa.
 *
 * `BlockStore` e `EdgeStore` satisfazem esta interface, mas qualquer
 * objecto com `hasBlock` e `hasEdge` serve — facilita o teste.
 */
export interface CollisionMap {
  hasBlock(x: number, y: number, z: number): boolean;
  hasEdge(x: number, y: number, z: number, lado: EdgeSide): boolean;
}

// ------------------------------------------------------------------ canEnter

/**
 * Verifica se a célula `(x, y, z)` é entrável.
 *
 * Condições:
 *   1. A célula não está ocupada por um bloco.
 *   2. Para z > 0, a célula `(x, y, z−1)` tem um bloco (suporte).
 *      Para z = 0, o chão é sempre suporte.
 */
export function canEnter(
  map: CollisionMap,
  x: number,
  y: number,
  z: number,
): boolean {
  // z negativo não existe
  if (z < 0) return false;

  // Célula ocupada por bloco → não entrável
  if (map.hasBlock(x, y, z)) return false;

  // Suporte: z=0 é o chão; z>0 precisa de bloco em z-1
  if (z > 0 && !map.hasBlock(x, y, z - 1)) return false;

  return true;
}

// ------------------------------------------------------------------ arestas

/**
 * Verifica se existe uma parede na aresta entre duas células adjacentes.
 *
 * Uma parede pode estar registada em qualquer um dos lados da aresta:
 *   - Leste de `from` ≡ Oeste de `to`
 *   - Norte de `from` ≡ Sul de `to`
 *   - etc.
 *
 * Verificamos AMBOS os lados porque o editor pode registar a parede em
 * qualquer uma das duas células adjacentes.
 */
function hasWallBetween(
  map: CollisionMap,
  from: CollisionCell,
  to: CollisionCell,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Determina os dois lados da mesma aresta
  let fromSide: EdgeSide;
  let toSide: EdgeSide;
  if (dx === 1 && dy === 0) {
    fromSide = 'L'; // leste de from
    toSide = 'O';   // oeste de to
  } else if (dx === -1 && dy === 0) {
    fromSide = 'O'; // oeste de from
    toSide = 'L';   // leste de to
  } else if (dx === 0 && dy === 1) {
    fromSide = 'N'; // norte de from
    toSide = 'S';   // sul de to
  } else if (dx === 0 && dy === -1) {
    fromSide = 'S'; // sul de from
    toSide = 'N';   // norte de to
  } else {
    // Não são adjacentes cardinais
    return false;
  }

  // Verifica AMBOS os lados da aresta
  return (
    map.hasEdge(from.x, from.y, from.z, fromSide) ||
    map.hasEdge(to.x, to.y, to.z, toSide)
  );
}

// ------------------------------------------------------------------ canCross

/**
 * Verifica se um personagem pode mover-se de `from` para `to`.
 *
 * Condições:
 *   1. `to` é entrável (`canEnter`).
 *   2. Se o movimento for cardinal (N/S/L/O): não há parede na aresta.
 *   3. Se o movimento for diagonal: as DUAS arestas cardinais envolvidas
 *      são testadas.  Se qualquer uma estiver bloqueada, o movimento
 *      diagonal é recusado.
 *
 * Movimentos não-adjacentes (distância > 1 em x ou y) são sempre
 * recusados — este motor não faz pathfinding.
 */
export function canCross(
  map: CollisionMap,
  from: CollisionCell,
  to: CollisionCell,
): boolean {
  // Destinos com z diferente não são suportados por canCross —
  // mudanças de z são tratadas por stepUp/stepDown/jump.
  if (from.z !== to.z) return false;

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Movimento não-adjacente
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  // Sem movimento
  if (dx === 0 && dy === 0) return true;

  // O destino tem de ser entrável
  if (!canEnter(map, to.x, to.y, to.z)) return false;

  // --- cardinal ---
  if (dx === 0 || dy === 0) {
    return !hasWallBetween(map, from, to);
  }

  // --- diagonal: testa AS DUAS arestas ---
  // Diagonal (dx, dy) com |dx|=1 e |dy|=1.
  // Testamos ambos os caminhos cardinais:
  //   Caminho A: (x,y) → (x+dx, y) → (x+dx, y+dy)
  //   Caminho B: (x,y) → (x, y+dy) → (x+dx, y+dy)
  //
  // Cada caminho tem duas arestas, mas as arestas são as mesmas duas
  // independentemente do caminho:
  //   - aresta-x: a aresta entre x e x+dx na linha y (ou y+dy)
  //   - aresta-y: a aresta entre y e y+dy na coluna x (ou x+dx)
  //
  // Testamos ambas: se qualquer uma tiver parede, a diagonal falha.

  const midX: CollisionCell = { x: from.x + dx, y: from.y, z: from.z };
  const midY: CollisionCell = { x: from.x, y: from.y + dy, z: from.z };

  // Aresta na direcção x (entre from e midX)
  if (hasWallBetween(map, from, midX)) return false;

  // Aresta na direcção y (entre midX e to)
  if (hasWallBetween(map, midX, to)) return false;

  // NOTA: Não testamos o caminho alternativo (from→midY→to) porque as
  // arestas são as mesmas: a aresta-x testada acima é a mesma que entre
  // midY e to; a aresta-y testada acima é a mesma que entre from e midY.
  // Mas verificamos no teste que paredes em AMBAS as arestas bloqueiam.

  return true;
}
