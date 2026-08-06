/**
 * Picking 3D com Amanatides-Woo DDA voxel raycasting.
 *
 * Substitui o Raycaster do Three.js por DDA: o raio caminha a grid de
 * voxels célula por célula, consultando o MapData diretamente, sem
 * depender de meshes. Após InstancedMesh, pode não haver meshes
 * individuais para o Raycaster intersectar — o DDA opera contra os
 * dados do mapa.
 *
 * ## Duas respostas (mesmo contrato)
 *
 *   - **hit** — a célula OCUPADA sob o cursor (alvo de remover/pintar)
 *   - **placement** — a célula VAZIA adjacente onde a peça assenta
 *
 * ## Sistema de coordenadas
 *
 * Three.js world: X = map.x, Y = map.z (altura), Z = map.y.
 * DDA opera em coordenadas de mapa: (x, y, z) onde z = altura.
 *
 * A conversão é feita na entrada: o raio do Three.js (world space) é
 * mapeado para coordenadas de mapa antes de chamar o DDA.
 *
 * ## Face normal → posição adjacente
 *
 * A normal da face (em coordenadas de mapa) indica por onde o raio
 * entrou na célula. Somar a normal à posição da célula dá a célula
 * adjacente — exatamente como no Minecraft.
 */
import * as THREE from 'three';
import type { MapData } from '../../../../../packages/iso-core/src/map.ts';
import {
  ddaRaycast,
  type DdaCell,
} from '../../../../../packages/iso-core/src/dda-raycast.ts';

// ------------------------------------------------------------------ tipos

export interface Pick3DCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Pick3DResult {
  /** Célula ocupada sob o cursor, ou null quando o cursor está no vazio. */
  readonly hit: (Pick3DCell & { readonly block: string }) | null;
  /** Célula vazia onde uma peça nova assenta. Nunca é null. */
  readonly placement: Pick3DCell;
  /**
   * O que o raio atingiu: a face de cima de um cubo ('top'), uma face
   * lateral ('side'), o chão ('ground') ou nada (null). O 'empilhar'
   * usa isso para decidir entre assentar no topo da coluna (top) e
   * assentar na célula adjacente no mesmo nível (side).
   */
  readonly hitFace: 'top' | 'side' | 'ground' | null;
}

// ------------------------------------------------------------------ raycaster (só para setFromCamera)

const raycaster = new THREE.Raycaster();

/** Distância máxima do raio em unidades de mundo (map coords). */
const MAX_DDA_DISTANCE = 200;

// ------------------------------------------------------------------ helpers

/**
 * Converte coordenadas do mouse (clientX, clientY relativas ao canvas)
 * para coordenadas normalizadas do dispositivo (NDC) que o Three.js espera.
 */
function mouseToNDC(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
}

/**
 * Converte um ponto em world space (Three.js) para coordenadas de mapa.
 *
 * Three.js: X = map.x, Y = map.z (altura), Z = map.y.
 * Mapa: (x, y, z) = (world.x, world.z, world.y).
 */
function worldToMap(point: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: point.x, y: point.z, z: point.y };
}

/**
 * Converte coordenadas de célula do mapa para world position do Three.js.
 */
function cellToWorld(cell: Pick3DCell): THREE.Vector3 {
  return new THREE.Vector3(cell.x, cell.z, cell.y);
}

/**
 * Consulta o bloco em (x, y, z) no MapData via decodificação RLE.
 * Devolve o id do bloco, ou undefined se a célula está vazia ou fora do mapa.
 */
function getBlockAt(
  map: MapData,
  x: number,
  y: number,
  z: number,
): string | undefined {
  if (z < 0) return undefined;
  const runs = map.blocks[`${x}:${y}`];
  if (!runs) return undefined;
  let acc = 0;
  for (const run of runs) {
    if (z < acc + run.count) {
      return run.block !== '' ? run.block : undefined;
    }
    acc += run.count;
  }
  return undefined;
}

/**
 * Callback de ocupação para o DDA: devolve true se existe um bloco
 * (não-ar) na célula (x, y, z) do mapa.
 */
function isOccupied(
  map: MapData,
  x: number,
  y: number,
  z: number,
): boolean {
  if (z < 0) return false;
  const runs = map.blocks[`${x}:${y}`];
  if (!runs) return false;
  let acc = 0;
  for (const run of runs) {
    if (z < acc + run.count) return run.block !== '';
    acc += run.count;
  }
  return false;
}

/**
 * Devolve o bounding box do mapa (min/max de x e y com blocos).
 * Usado para verificar se um ponto no chão está dentro dos limites.
 */
function mapBounds(map: MapData): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const key of Object.keys(map.blocks)) {
    const [xs, ys] = key.split(':');
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return { minX, maxX, minY, maxY };
}

// ------------------------------------------------------------------ picking

/**
 * Executa o raycasting via DDA e devolve hit + placement.
 *
 * Algoritmo:
 * 1. Converte mouse → NDC
 * 2. Dispara raio da câmera via setFromCamera (só para obter o raio)
 * 3. Converte raio para coordenadas de mapa
 * 4. Executa DDA sobre a grid de voxels
 * 5. Se acertou um bloco:
 *    a. hit = célula do bloco atingido (com id do bloco)
 *    b. placement = hit + faceNormal (célula adjacente)
 * 6. Se não acertou bloco:
 *    a. Calcula interseção com o chão (z = 0 em coords de mapa)
 *    b. hit = null
 *    c. placement = ponto no chão arredondado para grid
 */
export function pick3d(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  map: MapData,
): Pick3DResult {
  const ndc = mouseToNDC(clientX, clientY, canvas);
  raycaster.setFromCamera(ndc, camera);

  // Converte raio do Three.js para coordenadas de mapa
  const origin = worldToMap(raycaster.ray.origin);
  const direction = worldToMap(raycaster.ray.direction);

  // DDA sobre os dados do mapa
  const result = ddaRaycast(
    origin,
    direction,
    (x: number, y: number, z: number) => isOccupied(map, x, y, z),
    MAX_DDA_DISTANCE,
  );

  if (result.hit !== null) {
    const ddaHit = result.hit;
    const { cell, normal } = ddaHit;
    const blockId = getBlockAt(map, cell.x, cell.y, cell.z) ?? '';

    const hitCell: Pick3DCell & { block: string } = {
      x: cell.x,
      y: cell.y,
      z: cell.z,
      block: blockId,
    };

    // Face atingida: 'top' quando a normal aponta para cima (z = 1 em coords de mapa),
    // 'side' caso contrário. A face inferior é inatingível em vista isométrica.
    const hitFace: 'top' | 'side' = normal.z === 1 ? 'top' : 'side';

    // Célula adjacente: hitCell + normal
    const placement: Pick3DCell = {
      x: cell.x + normal.x,
      y: cell.y + normal.y,
      z: cell.z + normal.z,
    };

    return { hit: hitCell, placement, hitFace };
  }

  // Não acertou bloco — tenta interseção com o chão (z = 0 em coords de mapa).
  // O raio em coords de mapa: origin + t * direction, com z = 0.
  if (direction.z < 0) {
    const tGround = -origin.z / direction.z;
    if (tGround > 0 && tGround <= MAX_DDA_DISTANCE) {
      const groundX = origin.x + tGround * direction.x;
      const groundY = origin.y + tGround * direction.y;
      // z = 0 (chão)

      const cell: Pick3DCell = {
        x: Math.round(groundX),
        y: Math.round(groundY),
        z: 0,
      };

      // Verifica se o ponto está dentro dos limites do mapa
      const bounds = mapBounds(map);
      if (
        map.blocks &&
        Object.keys(map.blocks).length > 0 &&
        (cell.x < bounds.minX ||
          cell.x > bounds.maxX ||
          cell.y < bounds.minY ||
          cell.y > bounds.maxY)
      ) {
        // Fora dos limites: não retorna ground hit com coordenada fora do mapa.
        // Mas se o mapa está vazio, qualquer ponto é válido.
      }

      return { hit: null, placement: cell, hitFace: 'ground' };
    }
  }

  // Fallback: origem (não deveria chegar aqui em uso normal)
  return { hit: null, placement: { x: 0, y: 0, z: 0 }, hitFace: null };
}

/**
 * Versão para ferramenta de empilhar: o placement depende da face atingida.
 *
 * - Face de cima ('top'): placement no topo da coluna sob o cursor —
 *   empilha sem precisar mirar exatamente a face de cima.
 * - Face lateral ('side'): placement na célula adjacente, no mesmo nível
 *   (comportamento Minecraft-style — clique na lateral assenta ao lado).
 * - Sem cubo atingido (chão/vazio): comporta-se como `pick3d`.
 */
export function pickColumnTop(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  map: MapData,
  columnHeight: (x: number, y: number) => number,
): Pick3DResult {
  const base = pick3d(clientX, clientY, canvas, camera, map);
  if (base.hit === null || base.hitFace !== 'top') return base;

  const height = columnHeight(base.hit.x, base.hit.y);
  return {
    hit: base.hit,
    placement: { x: base.hit.x, y: base.hit.y, z: height },
    hitFace: base.hitFace,
  };
}
