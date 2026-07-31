/**
 * Chave de profundidade x+y+z para ordenação de desenho isométrica.
 *
 * A ordenação de desenho no espaço isométrico usa uma chave simples:
 * `depthKey(célula) = x + y + z`.  Objectos com chave maior são desenhados
 * por cima dos de chave menor — estão "mais perto" da câmara.
 *
 * ## Paredes (arestas)
 *
 * Uma parede na aresta de uma célula fica **a meia-célula**: visualmente,
 * está entre a célula dona e a célula vizinha.  A chave de profundidade
 * reflecte isto com um deslocamento de ±0.5:
 *
 *   - N (norte) e L (leste): **+0.5** — a parede é desenhada DEPOIS da
 *     célula dona (está entre esta e a célula seguinte em y ou x).
 *   - S (sul) e O (oeste): **−0.5** — a parede é desenhada ANTES da
 *     célula dona (está entre esta e a célula anterior em y ou x).
 *
 * ## Empate (tie-breaking)
 *
 * Quando duas entidades têm a mesma chave de profundidade, o empate é
 * resolvido por uma regra declarada e estável: y, depois x, depois z.
 *
 * ## Limitação conhecida: sprite alto
 *
 * Um sprite que ocupa várias células visualmente (ex.: uma árvore de 3
 * níveis de altura) mas está ancorado numa única célula `(x,y,z)` recebe
 * uma única chave `x+y+z`.  O topo do sprite deve ser desenhado por cima
 * de células com `z` maior, mas a chave não reflecte isso — ela só vê a
 * base.
 *
 * Esta limitação é **conhecida e documentada**.  A mitigação correcta
 * depende de metadata de altura do sprite (não disponível neste módulo,
 * que só olha para coordenadas de grid).  Ver o teste `sprite alto` em
 * `depth.test.ts`.
 */
import type { EdgeSide } from './map.ts';

// ------------------------------------------------------------------ tipos

export interface DepthCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface DepthEdge {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lado: EdgeSide;
}

/** Entidade que pode ser ordenada por profundidade. */
export type DepthItem =
  | { kind: 'cell'; x: number; y: number; z: number }
  | { kind: 'edge'; x: number; y: number; z: number; lado: EdgeSide };

// ------------------------------------------------------------------ chaves

/**
 * Chave de profundidade para uma célula: `x + y + z`.
 *
 * Células com chave maior são desenhadas por cima.
 */
export function depthKey(cell: DepthCell): number {
  return cell.x + cell.y + cell.z;
}

/**
 * Chave de profundidade para uma aresta (parede): `x + y + z ± 0.5`.
 *
 * - N (norte) e L (leste): +0.5 — a parede está entre esta célula e a
 *   seguinte em y ou x, portanto é desenhada depois.
 * - S (sul) e O (oeste): −0.5 — a parede está entre esta célula e a
 *   anterior em y ou x, portanto é desenhada antes.
 *
 * Duas células vizinhas que partilham uma aresta produzem a **mesma**
 * chave para essa aresta:
 *
 *   - Norte de (x,y,z) = `x+y+z+0.5`
 *   - Sul de (x,y+1,z) = `x+(y+1)+z−0.5` = `x+y+z+0.5` ✓
 *
 *   - Leste de (x,y,z) = `x+y+z+0.5`
 *   - Oeste de (x+1,y,z) = `(x+1)+y+z−0.5` = `x+y+z+0.5` ✓
 */
export function depthKeyForEdge(edge: DepthEdge): number {
  const base = edge.x + edge.y + edge.z;
  return edge.lado === 'N' || edge.lado === 'L' ? base + 0.5 : base - 0.5;
}

// ------------------------------------------------------------------ ordenação

/**
 * Comparador de profundidade para ordenação estável.
 *
 * Ordena por chave de profundidade (crescente).  Em caso de empate,
 * resolve por y (crescente), depois x (crescente), depois z (crescente).
 *
 * Esta regra é declarada e determinística — duas execuções com os mesmos
 * dados produzem a mesma ordem.
 */
export function compareDepth(a: DepthItem, b: DepthItem): number {
  const ka = a.kind === 'cell' ? depthKey(a) : depthKeyForEdge(a);
  const kb = b.kind === 'cell' ? depthKey(b) : depthKeyForEdge(b);

  if (ka !== kb) return ka - kb;

  // Empate: y, depois x, depois z
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  if (a.z !== b.z) return a.z - b.z;
  return 0;
}

/**
 * Ordena um array de itens de profundidade in-place e devolve-o.
 *
 * A ordenação é estável (itens com a mesma chave e mesmas coordenadas
 * mantêm a ordem relativa) e determinística.
 */
export function sortByDepth<T extends DepthItem>(items: T[]): T[] {
  return items.sort(compareDepth);
}
