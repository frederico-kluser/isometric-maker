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
 * 4. **Iluminação**: DirectionalLight + AmbientLight para shading; a
 *    DirectionalLight projeta sombras (shadowMap 2048², PCF suave) sobre o
 *    piso visível e sobre os outros cubos.
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
import {
  createGrid,
  createGroundPlane,
  createShadowPlane,
  resizeGrid,
  resizeGroundPlane,
  updateGroundShadowPlane,
} from './grid3d.ts';
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
  // Sombras ativadas em configureShadowSystem, abaixo — o shadowMap precisa
  // do `sun` e do piso visível prontos antes de ser configurado.

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

  // Registra o contexto de render para o laço de partículas (spawnParticles
  // só recebe a scene, mas precisa de renderer+câmera para animar on-demand).
  renderContexts.set(scene, { renderer, camera });

  // --- grid e chão ---
  let grid = createGrid(10, 10);
  scene.add(grid);
  const groundPlane = createGroundPlane(20); // invisível: só raycasting
  scene.add(groundPlane);
  // Piso visível que recebe as sombras (R8). Complementa o ground plane —
  // o de raycasting continua invisível e intocado.
  const shadowPlane = createShadowPlane(20);
  scene.add(shadowPlane);

  // --- sombras (R8) ---
  configureShadowSystem(renderer, sun, shadowPlane);

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
    // CircleGeometry nasce no plano XY (normal +Z) — sem a rotação o disco
    // ficaria em pé como uma moeda. O mesmo giro que grid3d.ts aplica nos
    // planos do chão (rotation.x = -π/2) deita a sombra no plano XZ.
    shadow.rotation.x = -Math.PI / 2;
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

  const updateActor = (
    actor: ActorSprite | null,
    cameraTurn: Rotation,
  ): void => {
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
    updateActorVisual(sprite, actor, cameraTurn);
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

    // Atualiza grid, ground planes e a luz de sombra conforme o mapa cresce
    updateGridAndPlane(
      map, grid, groundPlane, shadowPlane, sun, scene,
      () => {
        const g = createGrid(10, 10);
        scene.add(g);
        return g;
      },
    );

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

    // Ator do modo teste — o turn da câmera entra aqui porque a seta é um
    // mesh no MUNDO: o ângulo dela precisa compensar o giro para continuar
    // apontando para onde o sprite parece olhar na vista atual.
    updateActor(state.actor ?? null, state.rotation);

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
    // Desregistra o contexto ANTES de renderer.dispose(): o laço de
    // partículas em voo checa o WeakMap a cada frame e aborta ao ver o
    // contexto sumir — nunca renderiza num renderer já disposto.
    renderContexts.delete(scene);
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
    disposeParticles();
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
 * Atualiza grid, piso de raycasting, piso de sombra e luz para cobrir a
 * área ocupada do mapa.
 *
 * O frustum da sombra acompanha o piso: sem isso, um mapa que cresce para
 * fora do frustum inicial teria a sombra cortada na borda (e a luz
 * continuaria mirando a origem em mapas deslocados).
 */
function updateGridAndPlane(
  map: MapData,
  grid: THREE.GridHelper,
  plane: THREE.Mesh,
  shadowPlane: THREE.Mesh,
  sun: THREE.DirectionalLight,
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
  updateGroundShadowPlane(shadowPlane, minX, maxX, minZ, maxZ, GRID_MARGIN);
  sizeShadowFrustum(sun, shadowPlane);
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

// ------------------------------------------------------------------ sombras (R8)

/**
 * Ajusta a luz e o frustum da câmera de sombra ao tamanho e posição do piso.
 *
 * A câmera da sombra é ortográfica e fica na posição da luz olhando para o
 * alvo (ver `DirectionalLightShadow.updateMatrices`). O frustum precisa
 * cobrir o mapa inteiro na projeção da luz — que é maior que a projeção
 * axis-aligned do piso (o mapa visto em 45° tem a diagonal ~1.4× maior),
 * por isso o padding de 60% + 2 unidades.
 */
function sizeShadowFrustum(
  sun: THREE.DirectionalLight,
  plane: THREE.Mesh,
): void {
  const geometry = plane.geometry as THREE.PlaneGeometry;
  const half = (geometry.parameters.width / 2) * plane.scale.x;
  const centerX = plane.position.x;
  const centerZ = plane.position.z;
  const pad = half * 0.6 + 2;

  const cam = sun.shadow.camera;
  cam.left = -(half + pad);
  cam.right = half + pad;
  cam.top = half + pad;
  cam.bottom = -(half + pad);
  cam.near = 0.5;
  cam.far = Math.max(100, half * 4);
  cam.updateProjectionMatrix();

  // Luz e alvo acompanham o centro do mapa: a direção da luz (offset fixo
  // de 10,20,5) não muda, mas a sombra deixa de apontar para a origem quando
  // o mapa cresce fora dela.
  sun.position.set(centerX + 10, 20, centerZ + 5);
  sun.target.position.set(centerX, 0, centerZ);
  // O alvo não está na cena — sem o update manual o matrixWorld fica parado
  // na identidade e o shadow camera continuaria mirando a origem.
  sun.target.updateMatrixWorld();
}

// ------------------------------------------------------------------ partículas (R9)

/**
 * Renderer e câmera por cena, para o laço de animação de partículas.
 *
 * `spawnParticles` recebe só a scene (contrato do stub), mas o editor é
 * render-on-demand — sem estas referências a animação não teria como
 * desenhar. WeakMap: a entrada some sozinha quando a cena é coletada.
 */
const renderContexts = new WeakMap<
  THREE.Scene,
  { readonly renderer: THREE.WebGLRenderer; readonly camera: THREE.OrthographicCamera }
>();

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
 *
 * `cameraTurn` é o turn atual da câmera (0-3): sem ele a seta apontaria para
 * o sul de TELA como se o mundo nunca girasse — certa só na vista 0. O turn
 * corrige o ângulo da seta, que vive no plano XZ do mundo.
 */
export function updateActorVisual(
  sprite: THREE.Sprite,
  actor: ActorSprite,
  cameraTurn: Rotation,
): void {
  const visual = buildActorVisual(
    actor.directionIndex ?? 0,
    actor.floorY ?? actor.y,
    actor.jumpProgress ?? 1,
    cameraTurn,
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
 * Configura shadowMap, luz e piso visível (R8).
 *
 * - shadowMap ativado com PCF suave (bordas de sombra difusas).
 * - `sun` projeta sombra em 2048×2048 — caro, mas só custa nas renders
 *   on-demand do editor; não há loop contínuo. O `autoUpdate` da sombra
 *   fica no default (true) de propósito: com false, um cubo colocado depois
 *   da primeira render nunca projetaria sombra (mapa estático e velho).
 * - Frustum, posição da luz e alvo acompanham o piso (bounds do mapa).
 *
 * `groundPlane` deve ser o piso VISÍVEL (createShadowPlane), já adicionado à
 * cena — a função lê posição e escala dele para dimensionar a sombra.
 */
export function configureShadowSystem(
  renderer: THREE.WebGLRenderer,
  sun: THREE.DirectionalLight,
  groundPlane: THREE.Mesh,
): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 100;
  // Bias negativo: afasta o depth da superfície que recebe a sombra, para
  // a própria luz não marcar acne no cubo que a projeta.
  sun.shadow.bias = -0.0005;

  sizeShadowFrustum(sun, groundPlane);
}

/**
 * Dispara partículas na posição de um bloco colocado/removido (R9).
 *
 * Cubinhos 0.1³ (geometria compartilhada) com material básico colorido —
 * sem luz, para o efeito não depender do rig de iluminação. Sobem com
 * velocidade inicial, caem com gravidade (−9.8 units/s²) e somem por fade
 * out em ~0.5 s.
 *
 * O editor é render-on-demand: o laço de animação é um rAF próprio que
 * renderiza a cena a cada frame e se limpa sozinho no fim (remove os
 * meshes, descarta os materiais, renderiza um frame final limpo e para).
 * Se a cena for destruída no meio, o laço detecta e aborta sem renderizar.
 *
 * `position` é o centro do bloco em world units (y com o offset de meio
 * cubo, como em `render()`). A integração com o editor (chamar ao
 * colocar/remover) fica para depois — esta função é o contrato.
 *
 * @param count Número de partículas (default 8).
 */
export function spawnParticles(
  scene: THREE.Scene,
  position: THREE.Vector3,
  count = 8,
): void {
  const ctx = renderContexts.get(scene);
  if (!ctx || count <= 0) return; // cena sem renderer registrado → não anima

  if (!particleBox) {
    particleBox = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }

  // Material próprio por partícula: o fade (opacity) é individual, então
  // materiais compartilhados sumiriam todos juntos.
  const particles: Particle[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < count; i++) {
    const color = PARTICLE_COLORS[i % PARTICLE_COLORS.length]!;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      depthWrite: false, // transparência não deve ocultar o que está atrás
    });
    materials.push(material);
    const mesh = new THREE.Mesh(particleBox, material);
    // Espalha num cubo de 0.3 ao redor do centro do bloco.
    mesh.position.set(
      position.x + (Math.random() - 0.5) * 0.3,
      position.y + (Math.random() - 0.5) * 0.3,
      position.z + (Math.random() - 0.5) * 0.3,
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    mesh.renderOrder = 10; // desenha por cima dos cubos
    scene.add(mesh);
    particles.push({
      mesh,
      velY: 1.6 + Math.random() * 1.8,
      lifetime: 0.35 + Math.random() * 0.25,
      age: 0,
    });
  }

  const cleanup = (): void => {
    for (const p of particles) scene.remove(p.mesh);
    for (const m of materials) m.dispose();
  };

  let last = performance.now();

  const tick = (now: number): void => {
    // Cena destruída durante a animação (destroy chamou renderContexts.delete)
    // → aborta sem renderizar num renderer já disposto.
    if (renderContexts.get(scene) !== ctx) {
      cleanup();
      return;
    }

    // Clamp do dt: após uma aba inativa o primeiro frame saltaria e as
    // partículas atravessariam o chão.
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    let alive = false;
    for (const p of particles) {
      p.age += dt;
      if (p.age >= p.lifetime) {
        p.mesh.visible = false;
        continue;
      }
      alive = true;
      p.velY -= 9.8 * dt; // gravidade
      p.mesh.position.y += p.velY * dt; // sobem e depois caem
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p.age / p.lifetime; // fade out
    }

    ctx.renderer.render(scene, ctx.camera);

    if (alive) {
      requestAnimationFrame(tick);
    } else {
      // Fim: remove tudo e renderiza uma última vez para o frame final
      // (sem partículas) aparecer.
      cleanup();
      ctx.renderer.render(scene, ctx.camera);
    }
  };

  requestAnimationFrame(tick);
}

/** Partícula individual da animação de `spawnParticles`. */
interface Particle {
  mesh: THREE.Mesh;
  /** Velocidade vertical atual, em units/s (positivo = sobe). */
  velY: number;
  /** Tempo de vida total em segundos. */
  lifetime: number;
  /** Idade acumulada em segundos. */
  age: number;
}

/** Geometria compartilhada dos cubinhos de partícula (0.1³). */
let particleBox: THREE.BoxGeometry | null = null;

/** Cores vivas das partículas — visíveis porque o material ignora luz. */
const PARTICLE_COLORS: readonly number[] = [
  0xffd166, 0xff6b6b, 0x4ecdc4, 0xffa94d, 0x74c0fc,
];

/**
 * Descarta a geometria compartilhada das partículas. Chamar no destroy da
 * cena — como `disposeCubeCache` do cube3d.
 */
export function disposeParticles(): void {
  if (particleBox) {
    particleBox.dispose();
    particleBox = null;
  }
}
