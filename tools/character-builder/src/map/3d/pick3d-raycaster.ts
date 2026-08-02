/**
 * Picking 3D com Raycaster do Three.js.
 *
 * Substitui `pick3d.ts` (aritmética diagonal) por raycasting real:
 * o raio parte da câmera, atravessa a cena e acerta as faces dos cubos.
 * O resultado inclui qual face foi atingida para calcular a posição
 * adjacente (Minecraft-style block placement).
 *
 * ## Duas respostas (mesmo contrato do pick3d.ts)
 *
 *   - **hit** — a célula OCUPADA sob o cursor (alvo de remover/pintar)
 *   - **placement** — a célula VAZIA adjacente onde a peça assenta
 *
 * ## Face normal → posição adjacente
 *
 * Quando o raio atinge um cubo, `face.normal` (em world space, via
 * `transformDirection`) indica a direção da face. Somar o normal à
 * posição do cubo dá a célula adjacente — exatamente como no Minecraft.
 */
import * as THREE from 'three';
import { findGroundPlane } from './scene3d.ts';

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
}

// ------------------------------------------------------------------ raycaster

const raycaster = new THREE.Raycaster();

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
    -((clientY - rect.top) / rect.height) * 2 + 1, // Y invertido no NDC
  );
}

/**
 * Converte um ponto de interseção no mundo 3D para coordenadas de célula
 * do mapa (grid).
 *
 * No Three.js: X = x do mapa, Y = altura (z do mapa), Z = y do mapa.
 *
 * Para blocos unitários com posição inteira, `Math.round` na coordenada
 * dá a célula correta. O ponto de interseção está na superfície do cubo,
 * então para achar a posição adjacente usamos a normal.
 */
function worldToCell(point: THREE.Vector3): Pick3DCell {
  return {
    x: Math.round(point.x),
    y: Math.round(point.z), // Z do Three.js → Y do mapa
    z: Math.round(point.y), // Y do Three.js → Z do mapa (altura)
  };
}

/**
 * Converte coordenadas de célula do mapa para world position do Three.js.
 */
function cellToWorld(cell: Pick3DCell): THREE.Vector3 {
  return new THREE.Vector3(cell.x, cell.z, cell.y);
  //                              ↑ altura  ↑ Y do mapa → Z
}

// ------------------------------------------------------------------ picking

/**
 * Executa o raycasting e devolve hit + placement.
 *
 * Algoritmo:
 * 1. Converte mouse → NDC
 * 2. Dispara raio da câmera
 * 3. Intersecta com os meshes de bloco
 * 4. Se acertou um bloco:
 *    a. hit = célula do bloco atingido
 *    b. placement = hit + faceNormal (célula adjacente)
 * 5. Se não acertou bloco:
 *    a. Intersecta com o ground plane
 *    b. hit = null
 *    c. placement = ponto no chão arredondado para grid
 */
export function pick3d(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  scene: THREE.Scene,
  blockMeshes: readonly THREE.Mesh[],
): Pick3DResult {
  const ndc = mouseToNDC(clientX, clientY, canvas);
  raycaster.setFromCamera(ndc, camera);

  // 1. Tenta acertar blocos
  const hits = raycaster.intersectObjects(blockMeshes as unknown as THREE.Object3D[], false);

  if (hits.length > 0) {
    const first = hits[0]!;
    const blockMesh = first.object as THREE.Mesh;
    const blockPos = blockMesh.position;

    // Normal da face em world space
    const normal = first.face!.normal.clone();
    // Transforma do espaço local do mesh para world
    normal.transformDirection(blockMesh.matrixWorld);

    // Arredonda a normal para direção cardeal (0, ±1, 0)
    const dir = new THREE.Vector3(
      Math.round(normal.x),
      Math.round(normal.y),
      Math.round(normal.z),
    );

    const hitCell: Pick3DCell & { block: string } = {
      x: Math.round(blockPos.x),
      y: Math.round(blockPos.z), // Z do Three.js → Y do mapa
      z: Math.round(blockPos.y), // Y do Three.js → Z do mapa
      block: (blockMesh.userData as { blockId?: string }).blockId ?? '',
    };

    // Célula adjacente: hitCell + normal (mapeada para o sistema do mapa)
    const placement: Pick3DCell = {
      x: Math.round(blockPos.x + dir.x),
      y: Math.round(blockPos.z + dir.z), // Z do Three.js → Y do mapa
      z: Math.round(blockPos.y + dir.y), // Y do Three.js → Z do mapa
    };

    return { hit: hitCell, placement };
  }

  // 2. Não acertou bloco — tenta o ground plane
  const groundPlane = findGroundPlane(scene);
  if (groundPlane) {
    const groundHits = raycaster.intersectObject(groundPlane, false);
    if (groundHits.length > 0) {
      const point = groundHits[0]!.point;
      const cell: Pick3DCell = {
        x: Math.round(point.x),
        y: Math.round(point.z),
        z: 0,
      };
      return { hit: null, placement: cell };
    }
  }

  // 3. Fallback: origem (não deveria chegar aqui com ground plane)
  return { hit: null, placement: { x: 0, y: 0, z: 0 } };
}

/**
 * Versão para ferramenta de empilhar: o placement é sempre no topo da coluna.
 *
 * Diferente de `pick3d`, o placement é no topo da coluna sob o cursor,
 * não na face adjacente. Útil para empilhar blocos sem mirar a face de cima.
 */
export function pickColumnTop(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  scene: THREE.Scene,
  blockMeshes: readonly THREE.Mesh[],
  columnHeight: (x: number, y: number) => number,
): Pick3DResult {
  const base = pick3d(clientX, clientY, canvas, camera, scene, blockMeshes);
  if (base.hit === null) return base;

  const height = columnHeight(base.hit.x, base.hit.y);
  return {
    hit: base.hit,
    placement: { x: base.hit.x, y: base.hit.y, z: height },
  };
}
