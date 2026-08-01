/**
 * Instâncias de bloco — a visão do mapa que a física consome.
 *
 * O `BlockStore` guarda colunas RLE: compacto, sem buracos, ótimo para editar e
 * para salvar. Péssimo para escrever física em cima, porque nada ali diz o que
 * uma célula É — só qual string está nela.
 *
 * Este módulo faz a ponte: resolve cada célula ocupada contra o catálogo e
 * devolve um registro **autocontido** por bloco colocado, com identificador,
 * posição, tipo e material já dentro. Quem escreve colisão não precisa carregar
 * o catálogo junto.
 *
 * ## O identificador é derivado da posição, não sorteado
 *
 * `b:x:y:z`. Um contador exigiria estado persistido e sincronizado com desfazer
 * e refazer; um UUID mudaria a cada salvamento e tornaria o arquivo indiferível
 * no git. A posição já identifica a célula unicamente por construção do formato
 * — uma célula tem no máximo um bloco. Consequência a saber: **mover um bloco
 * muda o id dele**, porque o bloco não é uma entidade que anda, é o conteúdo de
 * uma célula.
 *
 * ## Caixa de colisão no espaço do GRID
 *
 * `aabbOf` devolve a caixa em coordenadas de célula, não de tela. Colisão em
 * pixel de tela num mapa isométrico é resolver em losango o que já era um cubo
 * — e é onde a rotação de câmera quebraria tudo, porque a tela muda de vista e o
 * mundo não.
 */
import { definitionOf, materialOf, type BlockCatalog, type BlockKind, type Material, type MaterialId } from './block-catalog.ts';
import type { MapData } from './map.ts';

// ---------------------------------------------------------------- instância

/** Um bloco colocado no mapa, com tudo que a física precisa, num registro só. */
export interface PlacedBlock {
  /** `b:x:y:z` — derivado da posição, estável entre salvamentos. */
  readonly id: string;
  /** Peça do catálogo que preenche esta célula. */
  readonly blockId: string;
  readonly kind: BlockKind;
  readonly material: MaterialId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function instanceId(x: number, y: number, z: number): string {
  return `b:${x}:${y}:${z}`;
}

/** Desfaz {@link instanceId}. `null` quando a string não tem essa forma. */
export function parseInstanceId(
  id: string,
): { x: number; y: number; z: number } | null {
  const parts = id.split(':');
  if (parts.length !== 4 || parts[0] !== 'b') return null;
  const [x, y, z] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return null;
  return { x, y, z };
}

// ---------------------------------------------------------------- enumeração

/**
 * Todas as células ocupadas, resolvidas contra o catálogo.
 *
 * A ordem é determinística — por x, depois y, depois z — e não a ordem de
 * inserção do `Map`. Exportação que muda de ordem a cada salvamento é
 * exportação que polui todo diff.
 */
export function enumerateBlocks(
  map: MapData,
  catalog: BlockCatalog,
): PlacedBlock[] {
  const colunas: Array<{ x: number; y: number; runs: MapData['blocks'][string] }> = [];
  for (const [key, runs] of Object.entries(map.blocks)) {
    const [xs, ys] = key.split(':');
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    colunas.push({ x, y, runs });
  }
  colunas.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

  const out: PlacedBlock[] = [];
  for (const col of colunas) {
    let z = 0;
    for (const run of col.runs) {
      if (run.block !== '') {
        for (let i = 0; i < run.count; i += 1) {
          const def = definitionOf(catalog, run.block);
          out.push({
            id: instanceId(col.x, col.y, z + i),
            blockId: run.block,
            kind: def.kind,
            material: def.material,
            x: col.x,
            y: col.y,
            z: z + i,
          });
        }
      }
      z += run.count;
    }
  }
  return out;
}

/** Índice `"x:y:z" → instância`, para consulta pontual em O(1). */
export function indexBlocks(placed: readonly PlacedBlock[]): Map<string, PlacedBlock> {
  const index = new Map<string, PlacedBlock>();
  for (const p of placed) index.set(p.id, p);
  return index;
}

// ---------------------------------------------------------------- física

/** Caixa alinhada aos eixos, em coordenadas de CÉLULA. */
export interface GridAabb {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/**
 * Caixa de uma instância: exatamente uma célula, do canto ao canto seguinte.
 *
 * Meio-aberta em cima (`maxX = x + 1`): dois blocos vizinhos se tocam sem se
 * sobrepor, que é a única convenção em que "encostar" não conta como "colidir".
 */
export function aabbOf(block: PlacedBlock): GridAabb {
  return {
    minX: block.x,
    minY: block.y,
    minZ: block.z,
    maxX: block.x + 1,
    maxY: block.y + 1,
    maxZ: block.z + 1,
  };
}

/** Duas caixas se interpenetram? Encostar não conta. */
export function aabbOverlaps(a: GridAabb, b: GridAabb): boolean {
  return (
    a.minX < b.maxX &&
    b.minX < a.maxX &&
    a.minY < b.maxY &&
    b.minY < a.maxY &&
    a.minZ < b.maxZ &&
    b.minZ < a.maxZ
  );
}

/** O material barra a passagem? É a pergunta que a colisão faz. */
export function blocksMovement(block: PlacedBlock): boolean {
  return block.kind !== 'decoration' && materialOf(block.material).solid;
}

/** Material resolvido de uma instância. */
export function materialFor(block: PlacedBlock): Material {
  return materialOf(block.material);
}

// ---------------------------------------------------------------- exportação

export interface ExportGeometry {
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Altura de um nível de z, em px. É a aresta do cubo. */
  readonly cubeHeight: number;
}

/**
 * Formato de exportação v2.
 *
 * Traz as três coisas separadas de propósito:
 *
 *   - `palette` — as definições, uma vez cada;
 *   - `materials` — só os materiais realmente usados, com suas propriedades;
 *   - `blocks` — as instâncias, autocontidas.
 *
 * Redundante? `kind` e `material` aparecem na paleta E em cada instância. É
 * deliberado: um consumidor de física lê `blocks` e pronto; um editor lê
 * `palette` e não precisa varrer as instâncias. Cada leitor tem um caminho
 * direto, e a redundância é derivada — nunca editada à mão.
 */
export interface MapExportV2 {
  readonly schemaVersion: 2;
  readonly geometry: ExportGeometry;
  readonly palette: readonly {
    readonly id: string;
    readonly label: string;
    readonly kind: BlockKind;
    readonly material: MaterialId;
    readonly sourceHash?: string;
  }[];
  readonly materials: Readonly<Record<string, Material>>;
  readonly blocks: readonly PlacedBlock[];
  /** Paredes, no formato original — não têm instância própria. */
  readonly edges: MapData['edges'];
  readonly objects?: MapData['objects'];
  /** Contagens derivadas, para conferência rápida ao abrir o arquivo. */
  readonly stats: {
    readonly blockCount: number;
    readonly columnCount: number;
    readonly maxZ: number;
  };
}

export function buildExport(
  map: MapData,
  catalog: BlockCatalog,
  geometry: ExportGeometry,
): MapExportV2 {
  const blocks = enumerateBlocks(map, catalog);

  const usados = new Set(blocks.map((b) => b.blockId));
  const palette = [...usados]
    .sort()
    .map((id) => {
      const d = definitionOf(catalog, id);
      return {
        id: d.id,
        label: d.label,
        kind: d.kind,
        material: d.material,
        ...(d.sourceHash ? { sourceHash: d.sourceHash } : {}),
      };
    });

  const materials: Record<string, Material> = {};
  for (const b of blocks) materials[b.material] = materialOf(b.material);

  return {
    schemaVersion: 2,
    geometry,
    palette,
    materials,
    blocks,
    edges: map.edges,
    ...(map.objects ? { objects: map.objects } : {}),
    stats: {
      blockCount: blocks.length,
      columnCount: Object.keys(map.blocks).length,
      maxZ: blocks.reduce((m, b) => Math.max(m, b.z), 0),
    },
  };
}
