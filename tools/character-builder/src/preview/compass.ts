/**
 * Rosa dos ventos — 8 botões dispostos espacialmente (F1-08).
 *
 * Disposição espacial, NUNCA select. Os botões são posicionados
 * como uma bússola: N no topo, S em baixo, E à direita, W à esquerda,
 * e as diagonais nos cantos.
 *
 * ## Uso
 *
 * ```ts
 * const compass = createCompass(document.getElementById('compass')!);
 * compass.onChange = (dir) => console.log('Direção:', dir);
 * compass.setDirection('south');
 * ```
 */

import { DIRECTIONS, DIR_SHORT, type Direction } from '../../server/model.ts';

// ------------------------------------------------------------------ tipos

export interface CompassEvents {
  onChange: ((direction: Direction) => void) | null;
}

export interface CompassControl {
  /** Elemento DOM raiz. */
  readonly elemento: HTMLElement;
  /** Define a direcção seleccionada (sem disparar onChange). */
  setDirection(dir: Direction): void;
  /** Devolve a direcção actual. */
  getDirection(): Direction;
  /** Callback chamado quando o utilizador clica num botão. */
  onChange: ((direction: Direction) => void) | null;
  /** Destrói o controlo. */
  destroy(): void;
}

// ------------------------------------------------------------------ posições espaciais

/**
 * Posições dos 8 botões no grid da rosa dos ventos (layout 3×3).
 *
 * ```
 *   NW    N    NE
 *    W    *     E
 *   SW    S    SE
 * ```
 */
const LAYOUT: Record<Direction, { row: number; col: number }> = {
  'north-west': { row: 0, col: 0 },
  north:        { row: 0, col: 1 },
  'north-east':  { row: 0, col: 2 },
  west:         { row: 1, col: 0 },
  south:        { row: 2, col: 1 },
  'south-west': { row: 2, col: 0 },
  'south-east': { row: 2, col: 2 },
  east:         { row: 1, col: 2 },
};

// ------------------------------------------------------------------ fábrica

export function createCompass(container: HTMLElement): CompassControl {
  let current: Direction = 'south';
  let onChange: ((direction: Direction) => void) | null = null;

  // --- estrutura ---
  const raiz = document.createElement('div');
  raiz.className = 'compass';
  raiz.style.display = 'grid';
  raiz.style.gridTemplateColumns = 'repeat(3, 1fr)';
  raiz.style.gridTemplateRows = 'repeat(3, 1fr)';
  raiz.style.gap = '4px';
  raiz.style.width = 'fit-content';

  const botoes = new Map<Direction, HTMLButtonElement>();

  for (const dir of DIRECTIONS) {
    const pos = LAYOUT[dir];
    const btn = document.createElement('button');
    btn.textContent = DIR_SHORT[dir];
    btn.title = dir;
    btn.style.gridRow = String(pos.row + 1);
    btn.style.gridColumn = String(pos.col + 1);
    btn.style.width = '36px';
    btn.style.height = '36px';
    btn.style.fontWeight = 'bold';
    btn.style.cursor = 'pointer';
    btn.setAttribute('data-direction', dir);
    btn.setAttribute('aria-label', dir);

    btn.addEventListener('click', () => {
      set(dir);
      onChange?.(dir);
    });

    botoes.set(dir, btn);
    raiz.appendChild(btn);
  }

  // Célula central vazia (posição 2,2 no grid 3×3)
  const centro = document.createElement('div');
  centro.style.gridRow = '2';
  centro.style.gridColumn = '2';
  centro.style.width = '36px';
  centro.style.height = '36px';
  // Substitui o botão central (West está errado na posição 2,2)
  raiz.appendChild(centro);

  // Corrige: West deveria estar em (1,0), não (2,2). O centro é (1,1).
  // Reorganiza: a posição central (2,2 no grid 1-indexed) é vazia.
  // West em (1,0) = row 2, col 1.
  // Vamos redefinir:
  // Row 0: NW, N, NE
  // Row 1: W, (vazio), E
  // Row 2: SW, S, SE

  // O centro vazio já está em (row=2, col=2) = grid-row:2, grid-column:2.
  // West já está em (row=1, col=0) → grid-row:2, grid-column:1.
  // Os botões já foram posicionados corretamente via LAYOUT.
  // Apenas garantimos que o centro vazio está no sítio certo.

  function set(dir: Direction): void {
    current = dir;
    for (const [d, btn] of botoes) {
      btn.classList.toggle('active', d === dir);
      btn.style.background = d === dir ? '#4a90d9' : '';
      btn.style.color = d === dir ? '#fff' : '';
    }
  }

  set(current);
  container.appendChild(raiz);

  return {
    elemento: raiz,
    setDirection(dir: Direction): void {
      set(dir);
    },
    getDirection(): Direction {
      return current;
    },
    set onChange(fn: ((direction: Direction) => void) | null) {
      onChange = fn;
    },
    destroy(): void {
      raiz.remove();
    },
  };
}
