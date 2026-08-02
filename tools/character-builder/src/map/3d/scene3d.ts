/**
 * Cena 3D do editor — Three.js.
 *
 * Substitui `scene.ts` (PixiJS) para a versão 3D do map builder.
 * A cena vive fora do React, criada uma vez num useEffect e atualizada
 * por chamadas imperativas de `render(state)`.
 *
 * ## Diferenças fundamentais em relação ao editor 2D
 *
 * 1. **Projeção**: Three.js usa câmera ortográfica real, não fórmula 2:1.
 *    A posição da câmera (yaw 45°, elevação 30°) produz visual similar
 *    ao isométrico 2D, mas em 3D verdadeiro.
 *
 * 2. **Cubos**: BoxGeometry com materiais por face, não sprites 2D.
 *    Cada face recebe textura ou cor sólida.
 *
 * 3. **Picking**: Raycaster com interseção de mesh, não aritmética diagonal.
 *
 * 4. **Iluminação**: DirectionalLight + AmbientLight para shading.
 *
 * ## O que NÃO muda
 *
 * - O formato MapData (RLE) continua igual
 * - O estado (map-state.ts) continua igual
 * - A paleta (blocks-api.ts) continua igual
 * - A rotação (iso-core/rotation.ts) continua igual
 */
import * as THREE from 'three';
import type { MapData } from '../../../../../packages/iso-core/src/map.ts';
import type { Rotation } from '../../../../../packages/iso-core/src/rotation.ts';
import type { BlockDef } from '../scene.ts';
import type { Cell3D } from '../editor/map-state.ts';
import {
  createCubeMaterials,
  createCubeMesh,
  createPreviewMesh,
  createHighlightMesh,
  disposeCubeCache,
  type CubeMaterials,
} from './cube3d.ts';
import { createGrid, createGroundPlane, resizeGrid, resizeGroundPlane } from './grid3d.ts';
import {
  createEditorCamera,
  panCamera,
  pixelDeltaToWorld,
  setCameraRotation,
  zoomCamera,
} from './controls3d.ts';

// ------------------------------------------------------------------ tipos

export interface Scene3DState {
  readonly map: MapData;
  /** Célula de preview (onde a peça vai assentar). null = escondido. */
  readonly preview: Cell3D | null;
  /** true = preview vermelho (ação destrutiva). */
  readonly previewInvalid?: boolean;
  /** Célula ocupada sob o cursor para realce. */
  readonly highlight: Cell3D | null;
  /** Rotação da câmera (0-3). */
  readonly rotation: Rotation;
}

export interface IsoScene3D {
  /** Acesso direto ao renderer para o raycaster e controles. */
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  /** Registra as peças da paleta e pré-carrega texturas. */
  setPalette(blocks: readonly BlockDef[]): Promise<void>;
  /** Desenha o estado atual. */
  render(state: Scene3DState): void;
  /** Pan da câmera em pixels de tela. */
  pan(dx: number, dy: number, viewportW: number, viewportH: number): void;
  /** Zoom inteiro. */
  zoom(factor: number): void;
  /** Gira a câmera para a vista discreta. */
  setRotation(rotation: Rotation): void;
  /** Redimensiona o renderer. */
  resize(width: number, height: number): void;
  /** Destrói a cena e libera recursos. */
  destroy(): void;
}

// ------------------------------------------------------------------ constantes

const BG_COLOR = 0x0b1020;
const GRID_MARGIN = 4;
/** BoxGeometry(1,1,1) tem centro na origem — base fica em -0.5. */
const HALF_CUBE = 0.5;

// ------------------------------------------------------------------ fábrica

export async function createIsoScene3D(
  canvas: HTMLCanvasElement,
): Promise<IsoScene3D> {
  // --- renderer ---
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(BG_COLOR);
  renderer.shadowMap.enabled = false; // sem sombras por enquanto

  // --- cena ---
  const scene = new THREE.Scene();

  // --- luz ---
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(10, 20, 5);
  scene.add(sun);

  // --- câmera ---
  const camera = createEditorCamera(
    canvas.clientWidth || 800,
    canvas.clientHeight || 600,
  );

  // --- grid e chão ---
  let grid = createGrid(10, 10);
  scene.add(grid);
  const groundPlane = createGroundPlane(20);
  scene.add(groundPlane);

  // --- cache de materiais ---
  const materialsByBlock = new Map<string, CubeMaterials>();
  /** Meshes dos blocos no mapa. Key = "x:y:z". */
  const blockMeshes = new Map<string, THREE.Mesh>();

  // Preview e highlight — recriados a cada frame
  let previewMesh: THREE.Mesh | null = null;
  let highlightMesh: THREE.LineSegments | null = null;

  // --- carregamento de paleta ---
  const setPalette = async (blocks: readonly BlockDef[]): Promise<void> => {
    // Carrega materiais em paralelo
    const entries = await Promise.all(
      blocks.map(async (b): Promise<[string, CubeMaterials]> => [
        b.id,
        await createCubeMaterials(b),
      ]),
    );
    // Descarta cache antigo
    for (const [, mats] of materialsByBlock) {
      for (const m of mats.materials) m.dispose();
    }
    materialsByBlock.clear();
    for (const [id, mats] of entries) {
      materialsByBlock.set(id, mats);
    }
  };

  // --- render ---
  const render = (state: Scene3DState): void => {
    const { map } = state;

    // Remove preview e highlight antigos
    if (previewMesh) {
      scene.remove(previewMesh);
      previewMesh.geometry !== previewMesh.geometry && previewMesh.geometry.dispose();
      (previewMesh.material as THREE.Material).dispose();
      previewMesh = null;
    }
    if (highlightMesh) {
      scene.remove(highlightMesh);
      highlightMesh.geometry.dispose();
      (highlightMesh.material as THREE.Material).dispose();
      highlightMesh = null;
    }

    // Sincroniza meshes com o mapa
    const currentKeys = new Set<string>();

    for (const [key, runs] of Object.entries(map.blocks)) {
      const [xs, zs] = key.split(':');
      const x = Number(xs);
      const z = Number(zs); // Em Three.js, o "y" do mapa 2D vira Z
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;

      let y = 0; // altura em Three.js (equivale ao z do mapa)
      for (const run of runs) {
        if (run.block !== '') {
          for (let i = 0; i < run.count; i++) {
            const blockY = y + i;
            const meshKey = `${x}:${z}:${blockY}`;
            currentKeys.add(meshKey);

            let mesh = blockMeshes.get(meshKey);
            if (!mesh) {
              const mats = materialsByBlock.get(run.block);
              if (mats) {
                mesh = createCubeMesh(mats);
                mesh.position.set(x, blockY + HALF_CUBE, z);
                mesh.userData = { blockId: run.block, cellX: x, cellY: z, cellZ: blockY };
                scene.add(mesh);
                blockMeshes.set(meshKey, mesh);
              }
            }
            // Se já existe, mantém (posição não muda para o mesmo bloco)
          }
        }
        y += run.count;
      }
    }

    // Remove meshes que não estão mais no mapa
    for (const [key, mesh] of blockMeshes) {
      if (!currentKeys.has(key)) {
        scene.remove(mesh);
        // Não damos dispose nos materiais — são compartilhados do cache
        mesh.geometry !== sharedBoxGeometry() && mesh.geometry.dispose();
        blockMeshes.delete(key);
      }
    }

    // Atualiza grid e ground plane
    updateGridAndPlane(map, grid, groundPlane, scene, () => {
      const g = createGrid(10, 10);
      scene.add(g);
      return g;
    });

    // Preview
    if (state.preview) {
      previewMesh = createPreviewMesh(state.previewInvalid === true);
      previewMesh.position.set(
        state.preview.x,
        state.preview.z + HALF_CUBE, // z do mapa → Y do Three.js
        state.preview.y, // y do mapa → Z do Three.js
      );
      scene.add(previewMesh);
    }

    // Highlight
    if (state.highlight) {
      highlightMesh = createHighlightMesh();
      highlightMesh.position.set(
        state.highlight.x,
        state.highlight.z + HALF_CUBE, // z do mapa → Y do Three.js
        state.highlight.y, // y do mapa → Z do Three.js
      );
      scene.add(highlightMesh);
    }

    // Desenha
    renderer.render(scene, camera);
  };

  // --- controles ---
  const pan = (
    dx: number,
    dy: number,
    viewportW: number,
    viewportH: number,
  ): void => {
    const delta = pixelDeltaToWorld(camera, dx, dy, viewportW, viewportH);
    panCamera(camera, delta.dx, delta.dy);
  };

  const zoom = (factor: number): void => {
    zoomCamera(camera, factor);
  };

  const setRotation = (rotation: Rotation): void => {
    setCameraRotation(camera, rotation);
  };

  // --- resize ---
  const resize = (width: number, height: number): void => {
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const frustumSize = 15;
    camera.left = -frustumSize * aspect;
    camera.right = frustumSize * aspect;
    camera.top = frustumSize;
    camera.bottom = -frustumSize;
    camera.updateProjectionMatrix();
  };

  // --- destroy ---
  const destroy = (): void => {
    renderer.dispose();
    for (const [, mesh] of blockMeshes) {
      scene.remove(mesh);
    }
    blockMeshes.clear();
    for (const [, mats] of materialsByBlock) {
      for (const m of mats.materials) m.dispose();
    }
    materialsByBlock.clear();
    disposeCubeCache();
    scene.clear();
    renderer.domElement?.remove();
  };

  return {
    renderer,
    scene,
    camera,
    setPalette,
    render,
    pan,
    zoom,
    setRotation,
    resize,
    destroy,
  };
}

// ------------------------------------------------------------------ helpers

/**
 * Geometria compartilhada — evita alocar uma BoxGeometry por cubo.
 */
let _sharedBox: THREE.BoxGeometry | null = null;
function sharedBoxGeometry(): THREE.BoxGeometry {
  if (!_sharedBox) {
    _sharedBox = new THREE.BoxGeometry(1, 1, 1);
  }
  return _sharedBox;
}

/**
 * Atualiza grid e ground plane para cobrir a área ocupada do mapa.
 */
function updateGridAndPlane(
  map: MapData,
  grid: THREE.GridHelper,
  plane: THREE.Mesh,
  scene: THREE.Scene,
  createNewGrid: () => THREE.GridHelper,
): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const key of Object.keys(map.blocks)) {
    const [xs, zs] = key.split(':');
    const x = Number(xs);
    const z = Number(zs);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  if (!Number.isFinite(minX)) {
    minX = 0; maxX = 0;
    minZ = 0; maxZ = 0;
  }

  resizeGrid(
    grid, minX, maxX, minZ, maxZ, GRID_MARGIN, scene,
  );
  resizeGroundPlane(plane, minX, maxX, minZ, maxZ, GRID_MARGIN);
}

// ------------------------------------------------------------------ raycaster helpers

/**
 * Obtém todos os meshes de bloco da cena (para raycasting).
 *
 * Filtra por nome/tipo: os meshes de bloco são instâncias de Mesh
 * com `userData.blockId` definido.
 */
export function collectBlockMeshes(scene: THREE.Scene): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((obj: THREE.Object3D) => {
    if (
      obj instanceof THREE.Mesh &&
      obj.userData &&
      typeof (obj.userData as Record<string, unknown>).blockId === 'string'
    ) {
      meshes.push(obj);
    }
  });
  return meshes;
}

/**
 * Encontra o mesh do ground plane para raycasting de espaço vazio.
 */
export function findGroundPlane(scene: THREE.Scene): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  scene.traverse((obj: THREE.Object3D) => {
    if (obj instanceof THREE.Mesh && obj.name === 'ground-plane') {
      found = obj;
    }
  });
  return found;
}
