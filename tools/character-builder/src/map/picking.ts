/**
 * Diagonal picking — selecção de célula isométrica sob o cursor (F2-06).
 *
 * ## Propriedade da diagonal
 *
 * Em projecção dimétrica 2:1, a conversão screen→world tem a propriedade:
 *
 * ```
 * screenToWorld(sx, sy, z+1, geom) ≡ screenToWorld(sx, sy, z, geom) + (0.5, 0.5)
 * ```
 *
 * Isto significa que cada nível de Z avança exactamente meia célula em x e em y.
 * O picking é ARITMÉTICA: percorremos os níveis de Z do mais alto ao mais baixo,
 * e cada passo desce (-0.5, -0.5) em coordenadas de mundo. Sem hit-test, sem
 * ray casting — apenas arredondamento para a célula e consulta de ocupação.
 *
 * ## Algoritmo
 *
 * 1. Calcula `zMax` — o maior z com blocos no mapa.
 * 2. Para cada z de `zMax` até 0:
 *    a. Converte `(sx, sy, z)` → coordenada de mundo → célula.
 *    b. Se a célula tem bloco em `z`, devolve-a.
 * 3. Se nenhuma célula ocupada for encontrada, devolve `null` ("nenhuma").
 *
 * ## Realce
 *
 * `pickWithHighlight(sx, sy, map, geom)` devolve a célula seleccionada e a
 * célula de piso (a primeira abaixo da seleccionada) para realce visual.
 */

import type { MapData } from '../../../../packages/iso-core/src/map.ts';

// ------------------------------------------------------------------ geometria inline

/** Geometria da projecção isométrica. */
export interface ProjectGeometry {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly zStep: number;
}

/** Geometria padrão: dimétrica 2:1, passo de altura = tileHeight/2. */
export const DEFAULT_GEOMETRY: ProjectGeometry = {
  tileWidth: 64,
  tileHeight: 32,
  zStep: 16,
};

interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

interface CellPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Converte coordenadas de ecrã para mundo (grid contínuo).
 *
 * Inversa exacta de worldToScreen. Com geometria padrão, o resultado
 * avança (0.5, 0.5) por nível de z.
 */
function screenToWorld(
  sx: number,
  sy: number,
  z: number,
  geom: ProjectGeometry,
): WorldPoint {
  const halfW = geom.tileWidth / 2;
  const halfH = geom.tileHeight / 2;
  const a = sx / halfW;
  const b = (sy + z * geom.zStep) / halfH;
  return { x: (b + a) / 2, y: (b - a) / 2 };
}

/** Arredonda world → cell usando Math.floor (regra canónica). */
function worldToCell(w: WorldPoint): CellPoint {
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}

/** Atalho: screen → cell num dado nível de z. */
function screenToCell(
  sx: number,
  sy: number,
  z: number,
  geom: ProjectGeometry,
): CellPoint {
  return worldToCell(screenToWorld(sx, sy, z, geom));
}

// ------------------------------------------------------------------ tipos

/** Resultado do picking. */
export interface PickResult {
  /** Célula seleccionada: a primeira ocupada no raio, ou o piso. */
  readonly cell: CellPoint & { readonly z: number };
  /** Tipo de bloco na célula, ou 'piso' se for o chão. */
  readonly blockType: string;
  /** true se é o piso (nenhuma célula ocupada acima). */
  readonly isFloor: boolean;
}

// ------------------------------------------------------------------ cálculo de zMax

/**
 * Devolve o maior z que contém pelo menos um bloco.
 */
function maxZ(map: MapData): number {
  let max = 0;
  for (const runs of Object.values(map.blocks)) {
    let z = 0;
    for (const run of runs) {
      if (run.block !== '') {
        const top = z + run.count - 1;
        if (top > max) max = top;
      }
      z += run.count;
    }
  }
  return max;
}

// ------------------------------------------------------------------ consulta de bloco

/**
 * Verifica se a célula (x, y, z) tem um bloco não-ar.
 * Devolve o tipo de bloco ou undefined.
 */
function getBlockAt(map: MapData, x: number, y: number, z: number): string | undefined {
  const runs = map.blocks[`${x}:${y}`];
  if (!runs) return undefined;

  let currentZ = 0;
  for (const run of runs) {
    const top = currentZ + run.count - 1;
    if (z >= currentZ && z <= top) {
      return run.block === '' ? undefined : run.block;
    }
    currentZ += run.count;
  }
  return undefined;
}

// ------------------------------------------------------------------ pick

/**
 * Selecciona a célula sob o cursor em coordenadas de ecrã.
 *
 * Caminha do z máximo ao z mínimo pela diagonal. A primeira célula ocupada
 * encontrada é devolvida. Se nenhuma célula tiver bloco, devolve o piso (z=0).
 *
 * @param sx - Coordenada x do ecrã (píxeis).
 * @param sy - Coordenada y do ecrã (píxeis).
 * @param map - O mapa (blocos + arestas).
 * @param geom - Geometria da projecção (padrão: {@link DEFAULT_GEOMETRY}).
 * @returns A célula seleccionada, ou null se o clique estiver fora dos limites.
 */
export function pick(
  sx: number,
  sy: number,
  map: MapData,
  geom: ProjectGeometry = DEFAULT_GEOMETRY,
): PickResult | null {
  const zMax = maxZ(map);

  // --- Caminha do z máximo ao mínimo pela diagonal ---
  // A propriedade da diagonal garante que cada nível de z cai numa célula
  // que está na mesma linha diagonal. Sem hit-test — apenas aritmética.
  for (let z = zMax; z >= 0; z -= 1) {
    const cell = screenToCell(sx, sy, z, geom);
    const block = getBlockAt(map, cell.x, cell.y, z);

    if (block) {
      return {
        cell: { x: cell.x, y: cell.y, z },
        blockType: block,
        isFloor: false,
      };
    }
  }

  // --- Nenhuma célula ocupada: devolve o piso em z=0 ---
  const floorCell = screenToCell(sx, sy, 0, geom);

  // Falha por AUSÊNCIA: clique fora dos limites.
  // Verificamos se a célula de piso tem alguma coluna no mapa.
  // Se não houver nenhuma coluna na posição, o clique está fora do mapa.
  const floorRuns = map.blocks[`${floorCell.x}:${floorCell.y}`];
  if (!floorRuns || floorRuns.length === 0) {
    return null; // "nenhuma"
  }

  return {
    cell: { x: floorCell.x, y: floorCell.y, z: 0 },
    blockType: 'piso',
    isFloor: true,
  };
}

// ------------------------------------------------------------------ realce

/**
 * Resultado do picking com informação de realce.
 */
export interface HighlightResult extends PickResult {
  /** Célula de piso (para realce), mesmo quando a seleccionada está acima. */
  readonly floorCell: CellPoint & { readonly z: 0 };
}

/**
 * Selecciona a célula sob o cursor E devolve a célula de piso para realce.
 *
 * O realce usa UMA célula só. A célula de piso é a célula em z=0 na mesma
 * diagonal — útil para mostrar onde o objecto "cairia" se fosse largado.
 */
export function pickWithHighlight(
  sx: number,
  sy: number,
  map: MapData,
  geom: ProjectGeometry = DEFAULT_GEOMETRY,
): HighlightResult | null {
  const result = pick(sx, sy, map, geom);
  if (!result) return null;

  const floorCell = screenToCell(sx, sy, 0, geom);

  return {
    ...result,
    floorCell: { x: floorCell.x, y: floorCell.y, z: 0 },
  };
}
