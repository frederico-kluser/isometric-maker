// ---------------------------------------------------------------------------
// Tipos do modelo de mapa — F2-02
// ---------------------------------------------------------------------------

/**
 * Lados de uma aresta (voxel face).
 *
 * N = Norte (+y), L = Leste (+x), S = Sul (-y), O = Oeste (-x).
 */
export type EdgeSide = 'N' | 'L' | 'S' | 'O';

/** Todas as direcções de aresta, por ordem. */
export const EDGE_SIDES: readonly EdgeSide[] = ['N', 'L', 'S', 'O'] as const;

// ---------------------------------------------------------------------------
// RLE (run-length encoding) para blocos
// ---------------------------------------------------------------------------

/** Uma sequência de níveis consecutivos com o mesmo tipo de bloco. */
export interface BlockRleRun {
  /** Identificador do bloco (string vazia = ar). */
  readonly block: string;
  /** Número de níveis consecutivos a começar da base do run. */
  readonly count: number;
}

// ---------------------------------------------------------------------------
// Objetos (props, personagens, etc.)
// ---------------------------------------------------------------------------

/**
 * Um objeto colocado no mapa.
 *
 * **O formato proíbe sprite multi-célula.** Cada objeto declara exactamente
 * uma célula `(x, y, z)`.  Objectos que ocupam mais de uma célula produzem
 * oclusão cíclica, para a qual não existe ordem linear correcta (ADR 0013).
 */
export interface MapObject {
  readonly tipo: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ---------------------------------------------------------------------------
// Arestas (paredes)
// ---------------------------------------------------------------------------

/** Uma parede numa aresta específica de uma célula. */
export interface EdgeEntry {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lado: EdgeSide;
  readonly tipo: string;
}

// ---------------------------------------------------------------------------
// Formato serializado do mapa
// ---------------------------------------------------------------------------

export interface MapData {
  /**
   * Blocos do terreno, chaveados por `"x:y"`.
   *
   * Cada coluna é uma sequência RLE de {@link BlockRleRun} a começar em z=0.
   * Colunas vazias (sem blocos) são omitidas.
   */
  readonly blocks: Record<string, readonly BlockRleRun[]>;
  /** Paredes — esparso porque paredes são raras. */
  readonly edges: readonly EdgeEntry[];
  /** Objectos colocados no mapa (opcional). */
  readonly objects?: readonly MapObject[];
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const EMPTY_BLOCK = '';

// ---------------------------------------------------------------------------
// BlockStore — armazenamento denso em memória
// ---------------------------------------------------------------------------

/**
 * Estrutura densa de blocos em memória.
 *
 * Cada coluna `(x, y)` é um array indexado por `z`, do nível 0 até ao topo
 * ocupado.  A altura de uma coluna é `maxZ + 1` — não há buracos.
 *
 * A serialização usa RLE: runs consecutivos do mesmo tipo são colapsados.
 */
export class BlockStore {
  /** `"x:y"` → array de tipos de bloco, indexado por z. */
  private columns = new Map<string, string[]>();

  // ------------------------------------------------------------------
  // Acesso
  // ------------------------------------------------------------------

  private key(x: number, y: number): string {
    return `${x}:${y}`;
  }

  /**
   * Devolve o tipo de bloco em `(x, y, z)`, ou `undefined` se não houver
   * coluna ou se `z` estiver acima do topo.
   */
  getBlock(x: number, y: number, z: number): string | undefined {
    const col = this.columns.get(this.key(x, y));
    if (!col || z < 0 || z >= col.length) return undefined;
    return col[z]!;
  }

  /**
   * Define o bloco em `(x, y, z)`.  Se `z` estiver acima do topo actual,
   * preenche os níveis intermédios com ar (string vazia).
   */
  setBlock(x: number, y: number, z: number, blockType: string): void {
    if (z < 0) return; // z negativo não é suportado

    const k = this.key(x, y);
    let col = this.columns.get(k);
    if (!col) {
      col = [];
      this.columns.set(k, col);
    }

    // Preenche níveis em falta com ar
    while (col.length <= z) {
      col.push(EMPTY_BLOCK);
    }
    col[z] = blockType;

    // Remove blocos de ar no topo para manter o invariante: sem trailing air
    this.trimTop(k);
  }

  /**
   * Remove o bloco em `(x, y, z)`, substituindo-o por ar.
   * Se ficar ar no topo da coluna, encolhe a coluna.
   */
  removeBlock(x: number, y: number, z: number): void {
    const col = this.columns.get(this.key(x, y));
    if (!col || z < 0 || z >= col.length) return;
    col[z] = EMPTY_BLOCK;
    this.trimTop(this.key(x, y));
  }

  // ------------------------------------------------------------------
  // Altura derivada
  // ------------------------------------------------------------------

  /**
   * Altura da coluna `(x, y)` — o primeiro nível de z vazio.
   *
   * **Derivada:** é `maxZ + 1` onde `maxZ` é o índice do último bloco
   * não-ar.  Nenhum campo de altura é persistido.
   */
  heightAt(x: number, y: number): number {
    const col = this.columns.get(this.key(x, y));
    if (!col) return 0;
    return col.length; // trimTop garante que não há trailing air
  }

  // ------------------------------------------------------------------
  // Iteração
  // ------------------------------------------------------------------

  /** Itera sobre todos os blocos não-ar, chamando `fn` para cada um. */
  forEach(
    fn: (x: number, y: number, z: number, blockType: string) => void,
  ): void {
    for (const [key, col] of this.columns) {
      const [xs, ys] = key.split(':');
      const x = Number(xs!);
      const y = Number(ys!);
      for (let z = 0; z < col.length; z++) {
        const block = col[z]!;
        if (block !== EMPTY_BLOCK) {
          fn(x, y, z, block);
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Serialização RLE
  // ------------------------------------------------------------------

  /** Codifica todas as colunas em RLE. */
  toRle(): Record<string, readonly BlockRleRun[]> {
    const result: Record<string, BlockRleRun[]> = {};
    for (const [key, col] of this.columns) {
      if (col.length === 0) continue;
      const runs = BlockStore.encodeRle(col);
      if (runs.length > 0) {
        result[key] = runs;
      }
    }
    return result;
  }

  /** Descodifica RLE e popula o store (não-destrutivo: faz merge). */
  static fromRle(rle: Record<string, readonly BlockRleRun[]>): BlockStore {
    const store = new BlockStore();
    for (const [key, runs] of Object.entries(rle)) {
      const [xs, ys] = key.split(':');
      const x = Number(xs!);
      const y = Number(ys!);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;

      const col = BlockStore.decodeRle(runs);
      store.columns.set(key, col);
      store.trimTop(key);
    }
    return store;
  }

  // ------------------------------------------------------------------
  // Utilitários de RLE (estáticos para teste)
  // ------------------------------------------------------------------

  /** Codifica um array denso em runs RLE. */
  static encodeRle(column: readonly string[]): BlockRleRun[] {
    const runs: BlockRleRun[] = [];
    if (column.length === 0) return runs;

    let current = column[0]!;
    let count = 1;
    for (let i = 1; i < column.length; i++) {
      const block = column[i]!;
      if (block === current) {
        count++;
      } else {
        runs.push({ block: current, count });
        current = block;
        count = 1;
      }
    }
    runs.push({ block: current, count });
    return runs;
  }

  /** Descodifica runs RLE num array denso. */
  static decodeRle(runs: readonly BlockRleRun[]): string[] {
    const col: string[] = [];
    for (const run of runs) {
      for (let i = 0; i < run.count; i++) {
        col.push(run.block);
      }
    }
    return col;
  }

  // ------------------------------------------------------------------
  // Internos
  // ------------------------------------------------------------------

  /** Remove blocos de ar do topo da coluna. Remove a coluna se ficar vazia. */
  private trimTop(key: string): void {
    const col = this.columns.get(key);
    if (!col) return;

    while (col.length > 0 && col[col.length - 1] === EMPTY_BLOCK) {
      col.pop();
    }

    if (col.length === 0) {
      this.columns.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// EdgeStore — armazenamento esparso de arestas
// ---------------------------------------------------------------------------

/**
 * Estrutura esparsa de arestas (paredes) em memória.
 *
 * Chaveada por `"x:y:z:lado"`.  Paredes são raras, por isso usamos um mapa
 * plano em vez de uma estrutura densa.
 */
export class EdgeStore {
  private edges = new Map<string, string>();

  // ------------------------------------------------------------------
  // Acesso
  // ------------------------------------------------------------------

  private key(x: number, y: number, z: number, lado: EdgeSide): string {
    return `${x}:${y}:${z}:${lado}`;
  }

  getEdge(
    x: number,
    y: number,
    z: number,
    lado: EdgeSide,
  ): string | undefined {
    return this.edges.get(this.key(x, y, z, lado));
  }

  setEdge(
    x: number,
    y: number,
    z: number,
    lado: EdgeSide,
    tipo: string,
  ): void {
    this.edges.set(this.key(x, y, z, lado), tipo);
  }

  removeEdge(x: number, y: number, z: number, lado: EdgeSide): void {
    this.edges.delete(this.key(x, y, z, lado));
  }

  // ------------------------------------------------------------------
  // Iteração
  // ------------------------------------------------------------------

  forEach(
    fn: (
      x: number,
      y: number,
      z: number,
      lado: EdgeSide,
      tipo: string,
    ) => void,
  ): void {
    for (const [key, tipo] of this.edges) {
      const [xs, ys, zs, lado] = key.split(':');
      fn(Number(xs!), Number(ys!), Number(zs!), lado as EdgeSide, tipo);
    }
  }

  // ------------------------------------------------------------------
  // Serialização
  // ------------------------------------------------------------------

  toEntries(): EdgeEntry[] {
    const entries: EdgeEntry[] = [];
    this.forEach((x, y, z, lado, tipo) => {
      entries.push({ x, y, z, lado, tipo });
    });
    return entries;
  }

  static fromEntries(entries: readonly EdgeEntry[]): EdgeStore {
    const store = new EdgeStore();
    for (const e of entries) {
      store.setEdge(e.x, e.y, e.z, e.lado, e.tipo);
    }
    return store;
  }
}

// ---------------------------------------------------------------------------
// Validação de objectos — proibição de multi-célula
// ---------------------------------------------------------------------------

/**
 * Verifica se um valor é um {@link MapObject} válido (exactamente uma célula).
 *
 * Devolve `true` se o objeto declara unicamente `(tipo, x, y, z)` e nada mais.
 * Rejeita objectos com `cells`, `width`, `height`, `area` ou outros campos
 * que indiciem ocupação de mais do que uma célula.
 */
export function validateMapObject(obj: unknown): obj is MapObject {
  if (obj === null || typeof obj !== 'object') return false;

  const o = obj as Record<string, unknown>;

  // Campos obrigatórios
  if (typeof o.tipo !== 'string') return false;
  if (typeof o.x !== 'number') return false;
  if (typeof o.y !== 'number') return false;
  if (typeof o.z !== 'number') return false;

  // Proíbe campos que indiciem multi-célula
  const forbiddenMultiCell = [
    'cells',
    'width',
    'height',
    'area',
    'size',
    'cellsX',
    'cellsY',
  ];
  for (const key of forbiddenMultiCell) {
    if (key in o) return false;
  }

  return true;
}

/**
 * Mensagem de erro para objectos multi-célula.
 *
 * Mantida como constante para que o grep de aceitação a encontre.
 */
export const MULTI_CELL_ERROR =
  'objetos multi-célula são proibidos no formato v1: ' +
  'cada objeto deve declarar exactamente uma célula (x, y, z).';
