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
import type { BlockDef, Cell3D } from './block-def.ts';
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
  BASE_YAW,
  createEditorCamera,
  DEFAULT_DISTANCE,
  ELEVATION,
  panCamera,
  pixelDeltaToWorld,
  ROTATION_DURATION_MS,
  setCameraRotation,
  zoomCamera,
} from './controls3d.ts';
import { buildActorVisual, SHADOW_RADIUS } from '../actor.ts';

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
  /**
   * Ator do modo teste. Ausente ou null = sem ator na cena.
   *
   * `x` e `z` são a posição do iso-core (`pos.x`, `pos.y`) mapeada para o
   * mundo do Three.js; `y` é a altura dos pés (nível `z` do iso-core + arco
   * visual do pulo).
   */
  readonly actor?: ActorSprite | null;
}

/** Ator do modo teste: um sprite billboard com o quadro atual. */
export interface ActorSprite {
  /** URL do quadro a desenhar (PNG com transparência). */
  readonly url: string;
  /** Posição no mundo 3D — pés do personagem. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * Índice de direção de TELA (0-7, 0=sul) — a mesma numeração do sprite
   * exibido. A seta no chão aponta para onde o sprite parece olhar.
   */
  readonly directionIndex?: number;
  /** Progresso do pulo (0-1); a sombra some com a altura da parábola. */
  readonly jumpProgress?: number;
  /**
   * Nível do piso (z do iso-core) onde a sombra assenta — SEM o offset
   * visual do pulo, senão a sombra subiria junto com o sprite.
   */
  readonly floorY?: number;
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
  /** Gira a câmera para a vista discreta (instantâneo). */
  setRotation(rotation: Rotation): void;
  /** Gira a câmera com animação suave (280 ms, ease-in-out cúbico). */
  animateRotation(targetRotation: Rotation): void;
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
/** Altura do personagem em unidades de mundo (~1.5 blocos). */
const ACTOR_HEIGHT = 1.6;
/**
 * Altura da sombra acima do piso real (floorY + 0.01). Não pode ser 0: sem
 * o deslocamento a sombra brigaria por z com o chão onde o ator pisa.
 */
const SHADOW_EPS = 0.01;
/** A seta de direção fica um pouco acima da sombra — sem briga de z entre elas. */
const ARROW_EPS = 0.02;
/** Cor e opacidade da seta de direção — sutil, não poluir a cena. */
const DIRECTION_ARROW_COLOR = 0xffd04d;
const DIRECTION_ARROW_OPACITY = 0.6;

// ------------------------------------------------------------------ animação

/** Easing cúbico simétrico — acelera no início, desacelera no fim. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Estado da animação de rotação em curso. null = parado. */
let animState: {
  frameId: number;
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  startTime: number;
  /** Renderer e câmera referenciados durante a animação. */
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
} | null = null;

/** Cancela a animação de rotação em curso, se houver. */
function cancelRotationAnim(): void {
  if (animState) {
    cancelAnimationFrame(animState.frameId);
    animState = null;
  }
}

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

  // --- ator do modo teste ---
  // Sprite billboard: sempre de frente para a câmera, com depth test contra os
  // cubos (um prédio na frente oculta o personagem). Texturas cacheadas por
  // URL — o ticker troca de quadro a 60 fps e recarregar a mesma imagem a cada
  // frame travaria a rede e o disco.
  let actorSprite: THREE.Sprite | null = null;
  let actorUrl: string | null = null;
  const actorTextures = new Map<string, THREE.Texture>();
  const actorLoader = new THREE.TextureLoader();

  /** Aplica uma textura ao sprite, ajustando a escala à proporção do PNG. */
  const applyActorTexture = (sprite: THREE.Sprite, tex: THREE.Texture): void => {
    const mat = sprite.material as THREE.SpriteMaterial;
    mat.map = tex;
    mat.needsUpdate = true;
    const image = tex.image as { width?: number; height?: number } | null;
    const aspect =
      image && image.width && image.height ? image.width / image.height : 1;
    sprite.scale.set(ACTOR_HEIGHT * aspect, ACTOR_HEIGHT, 1);
  };

  /**
   * Cria a sombra e a seta de direção do ator, adiciona à cena e pendura as
   * referências no `userData` do sprite — é de lá que `updateActorVisual`
   * (função de módulo, sem acesso à cena) as atualiza.
   */
  const attachActorVisualMeshes = (sprite: THREE.Sprite): void => {
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 1,
      depthWrite: false, // nada desenha abaixo do piso — não poluir o depth
    });
    const shadow = new THREE.Mesh(sharedShadowGeometry(), shadowMat);
    shadow.renderOrder = 9; // abaixo do sprite
    scene.add(shadow);
    sprite.userData.actorShadow = shadow;

    const arrowMat = new THREE.MeshBasicMaterial({
      color: DIRECTION_ARROW_COLOR,
      transparent: true,
      opacity: DIRECTION_ARROW_OPACITY,
      // Plano no chão: a face visível depende do lado da câmera — barato
      // demais num triângulo de 3 vértices para valer a pena acertar o winding.
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const arrow = new THREE.Mesh(sharedArrowGeometry(), arrowMat);
    arrow.renderOrder = 10;
    scene.add(arrow);
    sprite.userData.actorArrow = arrow;
  };

  /** Remove e descarta a sombra e a seta do ator (geometrias são compartilhadas). */
  const detachActorVisualMeshes = (sprite: THREE.Sprite): void => {
    for (const key of ['actorShadow', 'actorArrow'] as const) {
      const mesh = sprite.userData[key] as THREE.Mesh | undefined;
      if (mesh) {
        scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      }
      delete sprite.userData[key];
    }
  };

  const updateActor = (actor: ActorSprite | null): void => {
    if (!actor) {
      if (actorSprite) {
        detachActorVisualMeshes(actorSprite);
        scene.remove(actorSprite);
        actorSprite = null;
      }
      actorUrl = null;
      return;
    }
    if (!actorSprite) {
      const material = new THREE.SpriteMaterial({
        transparent: true,
        depthWrite: false,
      });
      actorSprite = new THREE.Sprite(material);
      // Desenha depois dos cubos (o depth test ainda oculta o que está atrás).
      actorSprite.renderOrder = 10;
      scene.add(actorSprite);
      attachActorVisualMeshes(actorSprite);
    }
    const sprite = actorSprite;
    // O sprite é centrado na origem: desloca meio corpo para os pés no chão.
    sprite.position.set(actor.x, actor.y + ACTOR_HEIGHT / 2, actor.z);
    // Sombra e seta mudam a cada quadro (pulo e direção) — precisa rodar
    // ANTES do early-return de URL, senão congelariam entre trocas de quadro.
    updateActorVisual(sprite, actor);
    if (actor.url === actorUrl) return;
    actorUrl = actor.url;
    const cached = actorTextures.get(actor.url);
    if (cached) {
      applyActorTexture(sprite, cached);
    } else {
      const url = actor.url;
      actorLoader.load(url, (tex) => {
        actorTextures.set(url, tex);
        // O ticker pode ter avançado para outro quadro enquanto a imagem
        // carregava — aplicar uma textura velha depois de trocar a URL erra
        // a animação.
        if (actorUrl === url) applyActorTexture(sprite, tex);
      });
    }
  };

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

    // Ator do modo teste
    updateActor(state.actor ?? null);

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

  const animateRotation = (targetRotation: Rotation): void => {
    cancelRotationAnim();

    const startPos = camera.position.clone();
    const targetYaw = BASE_YAW + targetRotation * (Math.PI / 2);
    const targetPos = new THREE.Vector3(
      DEFAULT_DISTANCE * Math.cos(ELEVATION) * Math.sin(targetYaw),
      DEFAULT_DISTANCE * Math.sin(ELEVATION),
      DEFAULT_DISTANCE * Math.cos(ELEVATION) * Math.cos(targetYaw),
    );

    const startTime = performance.now();

    const tick = (now: number): void => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / ROTATION_DURATION_MS);
      const eased = easeInOutCubic(t);

      camera.position.lerpVectors(startPos, targetPos, eased);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      renderer.render(scene, camera);

      if (t < 1) {
        animState!.frameId = requestAnimationFrame(tick);
      } else {
        // Snap ao destino exato
        camera.position.copy(targetPos);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        animState = null;
      }
    };

    animState = {
      frameId: requestAnimationFrame(tick),
      startPos,
      targetPos,
      startTime,
      renderer,
      scene,
      camera,
    };
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
    cancelRotationAnim();
    if (actorSprite) {
      detachActorVisualMeshes(actorSprite);
      scene.remove(actorSprite);
      actorSprite = null;
    }
    for (const tex of actorTextures.values()) tex.dispose();
    actorTextures.clear();
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
    animateRotation,
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
 * Geometria compartilhada da sombra do ator — um disco no plano XZ.
 * O raio vem de actor.ts (`SHADOW_RADIUS`): o mesmo valor que
 * `buildActorVisual` devolve, para o dado puro e o render nunca divergirem.
 */
let _sharedShadowGeo: THREE.CircleGeometry | null = null;
function sharedShadowGeometry(): THREE.CircleGeometry {
  if (!_sharedShadowGeo) {
    _sharedShadowGeo = new THREE.CircleGeometry(SHADOW_RADIUS, 24);
  }
  return _sharedShadowGeo;
}

/**
 * Geometria compartilhada da seta de direção — um triângulo no plano XZ com
 * a ponta em +X local. `updateActorVisual` gira o mesh em Y para a ponta
 * apontar o ângulo da direção de tela.
 */
let _sharedArrowGeo: THREE.BufferGeometry | null = null;
function sharedArrowGeometry(): THREE.BufferGeometry {
  if (!_sharedArrowGeo) {
    const length = 0.18; // ponta à base
    const halfW = 0.07; // meia-largura da base
    const positions = new Float32Array([
      length, 0, 0, // ponta
      -halfW, 0, halfW, // base, canto +Z
      -halfW, 0, -halfW, // base, canto -Z
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    _sharedArrowGeo = geo;
  }
  return _sharedArrowGeo;
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

// ------------------------------------------------------------------ stubs Onda 2
// Estes stubs existem como contrato entre os agentes 2.1 e 2.2.
// Cada agente preenche o seu sem tocar no stub do outro.

/**
 * Atualiza a sombra e o indicador de direção do ator.
 *
 * Consome os dados puros de `buildActorVisual` (actor.ts) e aplica nos
 * meshes pendurados no `userData` do sprite por `attachActorVisualMeshes`
 * (dentro de createIsoScene3D — a função de módulo não tem a cena, o sprite
 * carrega as referências):
 *
 * - **Sombra**: disco escuro assentado no piso REAL (`floorY`, o z do
 *   iso-core sem o offset visual do pulo) + `SHADOW_EPS` — o deslocamento
 *   mínimo que evita z-fight com o chão onde o ator pisa. Opacidade
 *   proporcional à altura da parábola do pulo.
 * - **Seta**: triângulo no chão, um pouco acima da sombra, com a ponta no
 *   ângulo da direção de tela (`directionIndex`, 0=sul) projetado no plano
 *   XZ do mundo.
 *
 * Campos ausentes de `ActorSprite` caem para defaults seguros: direção sul,
 * piso na altura dos pés e pulo completo (sombra plena).
 */
export function updateActorVisual(
  sprite: THREE.Sprite,
  actor: ActorSprite,
): void {
  const visual = buildActorVisual(
    actor.directionIndex ?? 0,
    actor.floorY ?? actor.y,
    actor.jumpProgress ?? 1,
  );

  const shadow = sprite.userData.actorShadow as THREE.Mesh | undefined;
  if (shadow) {
    shadow.position.set(actor.x, visual.floorY + SHADOW_EPS, actor.z);
    (shadow.material as THREE.MeshBasicMaterial).opacity = visual.shadowOpacity;
  }

  const arrow = sprite.userData.actorArrow as THREE.Mesh | undefined;
  if (arrow) {
    arrow.position.set(actor.x, visual.floorY + SHADOW_EPS + ARROW_EPS, actor.z);
    // A ponta do triângulo local +X precisa apontar para (cos α, 0, sin α);
    // a rotação em Y de −α faz exatamente isso (R_y(θ)·(1,0,0) = (cos θ, 0, −sin θ)).
    arrow.rotation.y = -visual.directionAngle;
  }
}

/**
 * Configura shadowMap, luzes e piso visível.
 * PREENCHER: onda2-cube-shadows (agente 2.2).
 */
export function configureShadowSystem(
  _renderer: THREE.WebGLRenderer,
  _sun: THREE.DirectionalLight,
  _groundPlane: THREE.Mesh,
): void {
  // stub — preenchido pelo agente 2.2
}

/**
 * Dispara partículas ao colocar/remover bloco.
 * PREENCHER: onda2-cube-shadows (agente 2.2).
 */
export function spawnParticles(
  _scene: THREE.Scene,
  _position: THREE.Vector3,
): void {
  // stub — preenchido pelo agente 2.2
}
