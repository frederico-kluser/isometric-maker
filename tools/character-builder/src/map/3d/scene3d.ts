/**
 * Cena 3D do editor — Three.js.
 *
 * A cena vive FORA do React: criada uma vez num `useEffect`, atualizada por
 * chamadas imperativas. Nenhum nó do three.js passa por reconciliação.
 *
 * ## As duas coisas que mudam, e por que são separadas
 *
 * | O que mudou | Custo | Como se atualiza |
 * |---|---|---|
 * | o MUNDO (blocos, preview, realce) | varre o mapa, cria/remove meshes, refaz o shadow map | `render(state)` |
 * | a CÂMERA (pan, zoom, giro) | uma matriz | `requestDraw()` |
 *
 * Antes havia só o primeiro caminho, e mover o mouse refazia o mundo inteiro —
 * incluindo um shadow map de 2048² — a cada evento de ponteiro. O zoom, por
 * sua vez, não tinha caminho nenhum: `zoom()` atualizava a matriz e não
 * desenhava, então a tela só mudava no `pointermove` seguinte. Era isso o
 * "lag": não era lentidão, era desenho que não acontecia.
 *
 * ## Um laço só, que para sozinho
 *
 * Tudo que anima — o amortecimento do zoom, o giro de 280 ms, as partículas —
 * passa pelo mesmo `requestAnimationFrame`. Pedidos de desenho no mesmo quadro
 * viram UM desenho. Quando nada está animando e nada foi pedido, não há laço:
 * o editor é render-on-demand de verdade, não um jogo que desenha 60 vezes por
 * segundo um mapa parado.
 *
 * ## Sombra
 *
 * Uma luz direcional projeta; o `ShadowMaterial` do chão desenha
 * (`grid3d.ts`). Os cubos não recebem sombra por decisão — material iluminado
 * mudaria a arte (`cube3d.ts`). Como nada na cena é iluminado, girar ou dar
 * zoom **não** invalida o shadow map: ele é refeito só quando o mapa muda.
 * `shadowMap.autoUpdate = false` é o que transforma isso em economia real.
 */
import * as THREE from 'three';
import type { MapData } from '../../../../../packages/iso-core/src/map.ts';
import type { Rotation } from '../../../../../packages/iso-core/src/rotation.ts';
import type { BlockDef, Cell3D } from './block-def.ts';
import {
  createCubeArt,
  createCubeMesh,
  createPreviewMesh,
  createHighlightMesh,
  disposeCubeCache,
  prefersReducedMotion,
  type CubeArt,
} from './cube3d.ts';
import { BlockAnimator } from './block-animation.ts';
import {
  createGroundRig,
  disposeGroundRig,
  resizeGroundRig,
  type GroundRig,
  type MapBounds,
} from './grid3d.ts';
import {
  anchorZoom,
  approach,
  BASE_YAW,
  clampZoom,
  createEditorCamera,
  easeInOutCubic,
  MAX_ZOOM,
  MIN_ZOOM,
  panTarget,
  placeCamera,
  resizeCamera,
  ROTATION_DURATION_MS,
  yawOf,
  ZOOM_EPSILON,
  zoomStep,
  zoomToFit,
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
  /** Registra as peças da paleta e pré-carrega as sprites. */
  setPalette(blocks: readonly BlockDef[]): Promise<void>;
  /** Sincroniza a cena com o estado e agenda um desenho. */
  render(state: Scene3DState): void;
  /** Agenda um desenho sem tocar no mundo. Coalescido em um quadro. */
  requestDraw(): void;
  /** Pan da câmera em pixels de tela. */
  pan(dx: number, dy: number, viewportW: number, viewportH: number): void;
  /**
   * Um passo de roda. `ndcX`/`ndcY` são o cursor em coordenadas normalizadas
   * (−1..1); o ponto sob o cursor fica parado enquanto o zoom muda.
   */
  wheelZoom(deltaY: number, ndcX: number, ndcY: number): void;
  /** Multiplica o zoom alvo (botões +/−). Ancorado no centro da tela. */
  zoomByFactor(factor: number): void;
  /** O zoom alvo atual — o valor que a HUD mostra. */
  zoomTarget(): number;
  /** Chamado quando o zoom alvo muda, para a HUD acompanhar. */
  onZoomChange(listener: (zoom: number) => void): void;
  /** Gira a câmera para a vista discreta (instantâneo). */
  setRotation(rotation: Rotation): void;
  /** Gira a câmera com animação suave (280 ms, ease-in-out cúbico). */
  animateRotation(targetRotation: Rotation): void;
  /** Os meshes de bloco, para o raycaster. Sem varrer a cena. */
  blockMeshes(): readonly THREE.Mesh[];
  /**
   * Define o zoom absoluto mantendo o ponto sob o cursor parado.
   * Usado por gestos de pinça (trackpad/touch) que produzem um zoom
   * absoluto, não um delta incremental como a roda.
   */
  setZoomAnchored(zoom: number, ndcX: number, ndcY: number): void;
  /**
   * Enquadra todos os blocos colocados no viewport com 10% de margem.
   *
   * Lê os bounds da última sincronização de mapa (syncBlocks).
   * `maxHeight` é a altura máxima dos blocos no eixo Y do mundo.
   */
  zoomToFit(maxHeight: number, viewportW: number, viewportH: number): void;
  /** Redimensiona o renderer. */
  resize(width: number, height: number): void;
  /** Destrói a cena e libera recursos. */
  destroy(): void;
}

// ------------------------------------------------------------------ constantes

const BG_COLOR = 0x0b1020;
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
/** Direção da luz que projeta sombra. Fixa no MUNDO — ver o cabeçalho. */
const SUN_OFFSET = new THREE.Vector3(14, 26, 8);

// ------------------------------------------------------------------ fábrica

export async function createIsoScene3D(
  canvas: HTMLCanvasElement,
): Promise<IsoScene3D> {
  // --- renderer ---
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(BG_COLOR);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // A chave do zoom fluido: o shadow map NÃO é refeito a cada desenho. Nada na
  // cena é iluminado, então mover a câmera não muda sombra nenhuma — só mudar
  // o mapa muda. `needsUpdate` é ligado em `syncBlocks` quando algo mudou.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  // --- cena ---
  const scene = new THREE.Scene();

  // --- luz ---
  // Uma luz só, e ela existe para PROJETAR sombra, não para iluminar: todos os
  // materiais da cena são `Basic`/`Sprite`/`Shadow`, que ignoram iluminação.
  // Sem luz ambiente porque não há nada para ela acender.
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Bias negativo: afasta o depth da superfície que recebe a sombra, para a
  // própria luz não marcar acne no cubo que a projeta.
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // --- câmera ---
  const camera = createEditorCamera(
    canvas.clientWidth || 800,
    canvas.clientHeight || 600,
  );
  /** O ponto que a câmera olha. Pan e zoom com âncora movem ISTO. */
  const target = new THREE.Vector3(0, 0, 0);
  /** Yaw corrente da câmera. Os cubos giram junto com ele. */
  let yaw = yawOf(0);
  placeCamera(camera, target, yaw);

  // --- chão ---
  const ground: GroundRig = createGroundRig(scene);
  sizeShadowFrustum(sun, ground);

  // --- caches ---
  const artByBlock = new Map<string, CubeArt>();
  /**
   * O relógio dos blocos animados (ADR 0032) — um por cena.
   *
   * Ele não desenha e não agenda nada: só responde "alguém trocou de quadro?" e
   * "ainda há animação viva?". Quem decide é o `tick` logo abaixo, que é o
   * mesmo laço único do zoom e do giro (ADR 0040).
   */
  const animator = new BlockAnimator();
  animator.setEnabled(!prefersReducedMotion());
  /** Meshes dos blocos no mapa. Key = "x:z:y". */
  const meshes = new Map<string, THREE.Mesh>();
  /** A mesma coleção em array, para o raycaster não varrer a cena. */
  let meshList: THREE.Mesh[] = [];
  let meshListStale = true;

  // Preview e realce são criados UMA vez e reposicionados. Recriar por quadro
  // significava alocar geometria e material a cada movimento do mouse.
  const previewValid = createPreviewMesh(false);
  const previewInvalid = createPreviewMesh(true);
  const highlight = createHighlightMesh();
  for (const helper of [previewValid, previewInvalid, highlight]) {
    helper.visible = false;
    helper.castShadow = false;
    helper.receiveShadow = false;
    scene.add(helper);
  }

  // ---------------------------------------------------------------- laço único

  let frameId: number | null = null;
  let lastFrameTime = 0;
  let drawPending = false;

  /** Zoom perseguido pelo amortecimento. Igual a `camera.zoom` quando assenta. */
  let zoomGoal = camera.zoom;
  let zoomListener: ((zoom: number) => void) | null = null;

  /** Giro em curso. null = parado. */
  let turning: { from: number; to: number; start: number } | null = null;

  /**
   * Coalescência de eventos de roda: acumula deltaY entre quadros e aplica
   * uma única vez por frame. Evita que N eventos em 16 ms gerem N chamadas
   * a zoomStep + anchorZoom, e garante que a âncora use o zoom corrente
   * correto (sem coalescência, N eventos no mesmo quadro usariam todos o
   * mesmo `camera.zoom` de partida).
   */
  let pendingWheelDeltaY = 0;
  let pendingWheelNdcX = 0;
  let pendingWheelNdcY = 0;
  let hasPendingWheel = false;

  /**
   * Bounds do mapa da última sincronização, para zoom-to-fit.
   * null = mapa vazio ou ainda não sincronizado.
   */
  let lastBounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  let lastMaxHeight = 0;

  const drawNow = (): void => {
    renderer.render(scene, camera);
  };

  const schedule = (): void => {
    if (frameId !== null) return;
    lastFrameTime = performance.now();
    frameId = requestAnimationFrame(tick);
  };

  const requestDraw = (): void => {
    drawPending = true;
    schedule();
  };

  function tick(now: number): void {
    frameId = null;
    // dt clampado: voltar de uma aba inativa daria um salto e o amortecimento
    // pularia direto para o alvo, perdendo o movimento.
    const dt = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
    lastFrameTime = now;

    let animating = false;

    // Coalescência de roda: aplica o delta acumulado uma vez por frame.
    if (hasPendingWheel) {
      const next = zoomStep(zoomGoal, pendingWheelDeltaY);
      const clamped = clampZoom(next);
      if (clamped !== zoomGoal) {
        anchorZoom(
          camera, target, camera.zoom, clamped,
          pendingWheelNdcX, pendingWheelNdcY,
        );
        placeCamera(camera, target, yaw);
        zoomGoal = clamped;
        if (zoomListener) zoomListener(clamped);
      }
      pendingWheelDeltaY = 0;
      hasPendingWheel = false;
      animating = true;
      drawPending = true;
    }

    // Zoom: persegue o alvo com constante de tempo, não com fator por quadro.
    if (Math.abs(camera.zoom - zoomGoal) > ZOOM_EPSILON) {
      camera.zoom = approach(camera.zoom, zoomGoal, dt);
      camera.updateProjectionMatrix();
      animating = true;
      drawPending = true;
    } else if (camera.zoom !== zoomGoal) {
      camera.zoom = zoomGoal;
      camera.updateProjectionMatrix();
      drawPending = true;
    }

    // Giro: interpola o YAW, não a posição. Interpolar posição atravessaria o
    // interior do círculo e a câmera passaria mais perto do mapa no meio.
    if (turning) {
      const t = Math.min(1, (now - turning.start) / ROTATION_DURATION_MS);
      const eased = easeInOutCubic(t);
      yaw = turning.from + (turning.to - turning.from) * eased;
      placeCamera(camera, target, yaw);
      applyCubeYaw();
      drawPending = true;
      if (t >= 1) {
        yaw = turning.to;
        placeCamera(camera, target, yaw);
        applyCubeYaw();
        turning = null;
      } else {
        animating = true;
      }
    }

    // Blocos animados. `advance` só devolve true quando algum bloco TROCOU de
    // quadro — a 8 fps num monitor de 60 Hz, sete de cada oito voltas não
    // desenham nada. `hasLive` é o que mantém o laço agendado, e é o que o
    // deixa parar quando o último bloco animado sai do mapa: a promessa da
    // ADR 0040 ("para sozinho") continua de pé, agora com uma condição a mais.
    //
    // O shadow map NÃO é invalidado aqui de propósito: a animação troca cor de
    // textura, não silhueta, e o `alphaTest` do cubo é do material, não do
    // passe de profundidade. Marcar `needsUpdate` traria de volta o passe de
    // 2048² por quadro que o `autoUpdate = false` existe para evitar.
    if (animator.advance(now)) drawPending = true;
    if (animator.hasLive()) animating = true;

    if (drawPending) {
      drawPending = false;
      drawNow();
    }
    if (animating) schedule();
  }

  // ---------------------------------------------------------------- giro do cubo

  /**
   * Gira TODO cubo junto com a câmera.
   *
   * O cubo é simétrico sob 90° em Y: girá-lo com a câmera devolve o volume ao
   * mesmo lugar no mundo e mantém as três faces texturizadas (+X, +Y, +Z)
   * sempre de frente. É isto que faz "a sprite mudar de lugar para a nova
   * perspectiva" sem trocar textura, sem recortar arte e sem uma segunda
   * imagem: a arte não muda, o volume é que acompanha o olhar.
   *
   * Contínuo, e não em degraus de 90°: durante os 280 ms do giro animado, um
   * cubo parado em 0° enquanto a câmera passa por 45° mostraria a face crua de
   * trás.
   */
  const applyCubeYaw = (): void => {
    const angle = yaw - BASE_YAW;
    for (const mesh of meshes.values()) {
      mesh.rotation.y = angle;
      // O raycaster lê `matrixWorld` e NÃO a atualiza. Sem isto, um clique
      // entre o giro e o quadro seguinte usaria a orientação anterior e a
      // normal da face apontaria para a célula errada.
      mesh.updateMatrixWorld();
    }
  };

  // ---------------------------------------------------------------- ator

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
    // ficaria em pé como uma moeda.
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
        if (actorUrl === url) {
          applyActorTexture(sprite, tex);
          requestDraw();
        }
      });
    }
  };

  // ---------------------------------------------------------------- paleta

  const setPalette = async (blocks: readonly BlockDef[]): Promise<void> => {
    const entries = await Promise.all(
      blocks.map(async (b): Promise<[string, CubeArt]> => [
        b.id,
        await createCubeArt(b),
      ]),
    );
    // Só a arte com sprite própria é descartável aqui: o cubo procedural é
    // compartilhado entre blocos e entre cenas, e quem o libera é
    // `disposeCubeCache`.
    for (const [, art] of artByBlock) {
      if (art.hasSprite) art.material.dispose();
    }
    artByBlock.clear();
    // A paleta trocou: os clipes antigos apontam para texturas que acabaram de
    // ser descartadas. Registrar de novo, do zero.
    animator.clear();
    for (const [id, art] of entries) {
      artByBlock.set(id, art);
      if (art.animation) animator.register(id, art.animation.clip, art.animation.show);
    }
    // Blocos já na cena podem ter ficado com material velho.
    for (const mesh of meshes.values()) {
      const id = (mesh.userData as { blockId?: string }).blockId;
      const art = id === undefined ? undefined : artByBlock.get(id);
      if (art) {
        mesh.material = art.material;
        mesh.geometry = art.geometry;
      }
    }
    // Invalida o atalho de `syncBlocks`. A paleta chega DEPOIS do primeiro
    // desenho: aquele desenho não criou mesh nenhum (não havia arte) e já
    // gravou o mapa como sincronizado. Sem esta linha, o `render` seguinte
    // veria o mesmo objeto de mapa, sairia cedo, e o editor abriria vazio.
    lastMap = null;
    renderer.shadowMap.needsUpdate = true;
    requestDraw();
  };

  // ---------------------------------------------------------------- sincronização

  /** Última referência de mapa desenhada — a igualdade evita varrer à toa. */
  let lastMap: MapData | null = null;

  /**
   * Põe a cena de acordo com o mapa.
   *
   * Devolve `true` se algo mudou de fato. O `map === lastMap` no início não é
   * micro-otimização: no modo teste esta função é chamada 60 vezes por segundo
   * com o MESMO mapa, e sem o atalho cada quadro varreria todas as colunas RLE
   * e refaria o shadow map.
   */
  const syncBlocks = (map: MapData): boolean => {
    if (map === lastMap) return false;
    lastMap = map;

    const seen = new Set<string>();
    /**
     * Os ids de bloco que estão NO MAPA — não os da paleta.
     *
     * É esta distinção que impede o editor de queimar GPU à toa: um bloco
     * animado que existe só na paleta não mantém o laço de quadro acordado.
     */
    const placedBlocks = new Set<string>();
    const cubeAngle = yaw - BASE_YAW;
    let changed = false;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const [key, runs] of Object.entries(map.blocks)) {
      const [xs, zs] = key.split(':');
      const x = Number(xs);
      const z = Number(zs); // o "y" do mapa 2D é o Z do three.js
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;

      let y = 0;
      for (const run of runs) {
        if (run.block !== '') {
          placedBlocks.add(run.block);
          for (let i = 0; i < run.count; i += 1) {
            const blockY = y + i;
            const meshKey = `${x}:${z}:${blockY}`;
            seen.add(meshKey);
            const existing = meshes.get(meshKey);
            if (existing) {
              // Pintar troca o bloco da célula sem mexer na posição. Sem esta
              // comparação o mesh antigo ficava e a pintura não aparecia.
              const data = existing.userData as { blockId?: string };
              if (data.blockId !== run.block) {
                const art = artByBlock.get(run.block);
                if (art) {
                  existing.material = art.material;
                  existing.geometry = art.geometry;
                  data.blockId = run.block;
                  changed = true;
                }
              }
              continue;
            }
            const art = artByBlock.get(run.block);
            if (!art) continue;
            const mesh = createCubeMesh(art);
            mesh.position.set(x, blockY + HALF_CUBE, z);
            mesh.rotation.y = cubeAngle;
            mesh.userData = { blockId: run.block, cellX: x, cellY: z, cellZ: blockY };
            scene.add(mesh);
            meshes.set(meshKey, mesh);
            changed = true;
          }
        }
        y += run.count;
      }
    }

    for (const [key, mesh] of meshes) {
      if (seen.has(key)) continue;
      scene.remove(mesh);
      // Geometria e material vêm do cache por bloco — nunca são do mesh.
      meshes.delete(key);
      changed = true;
    }

    if (changed) meshListStale = true;

    // Sempre, não só quando `changed`: o mapa pode ter mudado para OUTRO objeto
    // com o mesmo conteúdo (o histórico devolve snapshots), e o conjunto ativo
    // tem de refletir o que está na tela agora.
    animator.setActive(placedBlocks);

    // Guarda para zoom-to-fit
    let maxHeight = 0;
    if (Number.isFinite(minX)) {
      // maxHeight: varre todas as colunas e pega o maior y
      for (const [key, runs] of Object.entries(map.blocks)) {
        const [, , ys = '0'] = key.split(':');
        const yTop = Number(ys);
        if (Number.isFinite(yTop) && yTop > maxHeight) maxHeight = yTop;
        let top = 0;
        for (const run of runs) top += run.count;
        if (top > maxHeight) maxHeight = top;
      }
    }

    const bounds: MapBounds = Number.isFinite(minX)
      ? { minX, maxX, minZ, maxZ }
      : { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    if (Number.isFinite(minX)) {
      lastBounds = { minX, maxX, minZ, maxZ };
      lastMaxHeight = maxHeight;
    } else {
      lastBounds = null;
      lastMaxHeight = 0;
    }
    if (resizeGroundRig(ground, bounds, scene)) {
      sizeShadowFrustum(sun, ground);
      changed = true;
    }

    if (changed) renderer.shadowMap.needsUpdate = true;
    return changed;
  };

  /** Reposiciona preview e realce sem alocar nada. */
  const syncHelpers = (state: Scene3DState): void => {
    previewValid.visible = false;
    previewInvalid.visible = false;
    if (state.preview) {
      const mesh = state.previewInvalid === true ? previewInvalid : previewValid;
      mesh.position.set(
        state.preview.x,
        state.preview.z + HALF_CUBE, // z do mapa → Y do three.js
        state.preview.y, // y do mapa → Z do three.js
      );
      mesh.visible = true;
    }
    highlight.visible = false;
    if (state.highlight) {
      highlight.position.set(
        state.highlight.x,
        state.highlight.z + HALF_CUBE,
        state.highlight.y,
      );
      highlight.visible = true;
    }
  };

  const render = (state: Scene3DState): void => {
    syncBlocks(state.map);
    syncHelpers(state);
    updateActor(state.actor ?? null, state.rotation);
    requestDraw();
  };

  // ---------------------------------------------------------------- controles

  const pan = (
    dx: number,
    dy: number,
    viewportW: number,
    viewportH: number,
  ): void => {
    panTarget(camera, target, dx, dy, viewportW, viewportH);
    placeCamera(camera, target, yaw);
    requestDraw();
  };

  const setZoomGoal = (next: number): void => {
    const clamped = clampZoom(next);
    if (clamped === zoomGoal) return;
    zoomGoal = clamped;
    zoomListener?.(clamped);
    schedule();
  };

  const wheelZoom = (deltaY: number, ndcX: number, ndcY: number): void => {
    // Acumula em vez de aplicar imediatamente: o tick aplica o delta
    // total uma vez por frame, com a âncora no zoom corrente correto.
    pendingWheelDeltaY += deltaY;
    pendingWheelNdcX = ndcX;
    pendingWheelNdcY = ndcY;
    hasPendingWheel = true;
    schedule();
  };

  const setZoomAnchored = (zoom: number, ndcX: number, ndcY: number): void => {
    // Descarta delta de roda pendente: gesto de pinça substitui a roda.
    hasPendingWheel = false;
    pendingWheelDeltaY = 0;
    const clamped = clampZoom(zoom);
    if (clamped === zoomGoal) return;
    anchorZoom(camera, target, camera.zoom, clamped, ndcX, ndcY);
    placeCamera(camera, target, yaw);
    zoomGoal = clamped;
    zoomListener?.(clamped);
    schedule();
  };

  const zoomByFactor = (factor: number): void => {
    setZoomGoal(zoomGoal * factor);
  };

  const zoomToFitMethod = (maxHeight: number, viewportW: number, viewportH: number): void => {
    if (!lastBounds) return;
    const result = zoomToFit(lastBounds, maxHeight, viewportW, viewportH, yaw);
    // Zera a inércia da roda para o zoom-to-fit dominar.
    hasPendingWheel = false;
    pendingWheelDeltaY = 0;
    zoomGoal = result.zoom;
    if (zoomListener) zoomListener(result.zoom);
    target.copy(result.target);
    placeCamera(camera, target, yaw);
    schedule();
  };

  const setRotation = (rotation: Rotation): void => {
    turning = null;
    yaw = yawOf(rotation);
    placeCamera(camera, target, yaw);
    applyCubeYaw();
    requestDraw();
  };

  const animateRotation = (rotation: Rotation): void => {
    const to = yawOf(rotation);
    // O caminho mais curto: sem isto, ir da vista 3 para a 0 desenrolaria 270°
    // no sentido contrário.
    let from = yaw;
    while (to - from > Math.PI) from += Math.PI * 2;
    while (to - from < -Math.PI) from -= Math.PI * 2;
    turning = { from, to, start: performance.now() };
    schedule();
  };

  const blockMeshes = (): readonly THREE.Mesh[] => {
    if (meshListStale) {
      meshList = [...meshes.values()];
      meshListStale = false;
    }
    return meshList;
  };

  // ---------------------------------------------------------------- resize

  const resize = (width: number, height: number): void => {
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    resizeCamera(camera, width, height);
    requestDraw();
  };

  // ---------------------------------------------------------------- destroy

  const destroy = (): void => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    // Desregistra o contexto ANTES de renderer.dispose(): o laço de partículas
    // em voo checa o WeakMap a cada quadro e aborta ao ver o contexto sumir.
    renderContexts.delete(scene);
    if (actorSprite) {
      detachActorVisualMeshes(actorSprite);
      scene.remove(actorSprite);
      actorSprite = null;
    }
    for (const tex of actorTextures.values()) tex.dispose();
    actorTextures.clear();
    for (const mesh of meshes.values()) scene.remove(mesh);
    meshes.clear();
    meshList = [];
    // Antes de descartar os materiais: os clipes seguram closures sobre as
    // texturas que estão prestes a sumir.
    animator.clear();
    for (const [, art] of artByBlock) {
      if (art.hasSprite) art.material.dispose();
    }
    artByBlock.clear();
    for (const helper of [previewValid, previewInvalid, highlight]) {
      scene.remove(helper);
      (helper.material as THREE.Material).dispose();
    }
    disposeGroundRig(ground, scene);
    disposeCubeCache();
    disposeParticles();
    scene.clear();
    renderer.dispose();
    renderer.domElement?.remove();
  };

  // Registra o contexto para o laço de partículas — ele precisa desenhar.
  renderContexts.set(scene, { renderNow: drawNow });

  return {
    renderer,
    scene,
    camera,
    setPalette,
    render,
    requestDraw,
    pan,
    wheelZoom,
    zoomByFactor,
    setZoomAnchored,
    zoomToFit: zoomToFitMethod,
    zoomTarget: () => zoomGoal,
    onZoomChange: (listener) => {
      zoomListener = listener;
    },
    setRotation,
    animateRotation,
    blockMeshes,
    resize,
    destroy,
  };
}

// ------------------------------------------------------------------ helpers

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

// ------------------------------------------------------------------ raycaster helpers

/**
 * Obtém todos os meshes de bloco da cena varrendo o grafo.
 *
 * Preferir `scene3d.blockMeshes()`, que devolve a lista já mantida. Esta versão
 * existe para quem só tem a cena — varrer a cena por movimento de ponteiro é
 * exatamente o custo que o cache evita.
 */
export function collectBlockMeshes(scene: THREE.Scene): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  scene.traverse((obj: THREE.Object3D) => {
    if (
      obj instanceof THREE.Mesh &&
      obj.userData &&
      typeof (obj.userData as Record<string, unknown>).blockId === 'string'
    ) {
      found.push(obj);
    }
  });
  return found;
}

/** Encontra o mesh do ground plane para raycasting de espaço vazio. */
export function findGroundPlane(scene: THREE.Scene): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  scene.traverse((obj: THREE.Object3D) => {
    if (obj instanceof THREE.Mesh && obj.name === 'ground-plane') {
      found = obj;
    }
  });
  return found;
}

// ------------------------------------------------------------------ sombra

/**
 * Ajusta a luz e o frustum da câmera de sombra ao tamanho e à posição do chão.
 *
 * A câmera da sombra é ortográfica e fica na posição da luz olhando para o
 * alvo. O frustum precisa cobrir o mapa inteiro NA PROJEÇÃO DA LUZ, que é maior
 * que a projeção alinhada aos eixos do piso — o mapa visto em diagonal tem a
 * diagonal ~1,4× maior. Daí o padding de 60% mais 2 unidades.
 *
 * A luz e o alvo acompanham o centro do mapa: a DIREÇÃO da luz não muda (o
 * offset é fixo), mas um mapa que cresce para longe da origem sairia do
 * frustum se a luz continuasse mirando o (0,0,0).
 */
function sizeShadowFrustum(sun: THREE.DirectionalLight, ground: GroundRig): void {
  const half = ground.size / 2;
  const pad = half * 0.6 + 2;
  const cam = sun.shadow.camera;
  cam.left = -(half + pad);
  cam.right = half + pad;
  cam.top = half + pad;
  cam.bottom = -(half + pad);
  cam.near = 0.5;
  cam.far = Math.max(160, half * 6);
  cam.updateProjectionMatrix();

  sun.position.set(
    ground.centerX + SUN_OFFSET.x,
    SUN_OFFSET.y,
    ground.centerZ + SUN_OFFSET.z,
  );
  sun.target.position.set(ground.centerX, 0, ground.centerZ);
  sun.target.updateMatrixWorld();
}

// ------------------------------------------------------------------ ator: sombra e seta

/**
 * Atualiza a sombra e o indicador de direção do ator.
 *
 * Consome os dados puros de `buildActorVisual` (actor.ts) e aplica nos meshes
 * pendurados no `userData` do sprite:
 *
 * - **Sombra**: disco escuro assentado no piso REAL (`floorY`, o z do iso-core
 *   sem o offset visual do pulo) + `SHADOW_EPS`. Opacidade proporcional à
 *   altura da parábola do pulo.
 * - **Seta**: triângulo no chão, um pouco acima da sombra, com a ponta no
 *   ângulo da direção de tela (`directionIndex`, 0=sul) projetado no plano XZ.
 *
 * `cameraTurn` é o turn atual da câmera (0-3): sem ele a seta apontaria para o
 * sul de TELA como se o mundo nunca girasse — certo só na vista 0.
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
    // a rotação em Y de −α faz exatamente isso.
    arrow.rotation.y = -visual.directionAngle;
  }
}

// ------------------------------------------------------------------ partículas

/**
 * Como cada cena desenha, para o laço de partículas.
 *
 * `spawnParticles` recebe só a scene (contrato do stub), mas o editor é
 * render-on-demand — sem esta referência a animação não teria como desenhar.
 * WeakMap: a entrada some sozinha quando a cena é coletada.
 */
const renderContexts = new WeakMap<
  THREE.Scene,
  { readonly renderNow: () => void }
>();

/**
 * Dispara partículas na posição de um bloco colocado/removido.
 *
 * Cubinhos 0,1³ (geometria compartilhada) com material básico colorido — sem
 * luz, para o efeito não depender do rig de iluminação. Sobem com velocidade
 * inicial, caem com gravidade (−9,8 units/s²) e somem por fade out em ~0,5 s.
 *
 * O laço é um rAF próprio que se limpa sozinho no fim. Se a cena for destruída
 * no meio, o laço detecta pelo WeakMap e aborta sem desenhar num renderer já
 * descartado.
 *
 * `position` é o centro do bloco em world units (y com o offset de meio cubo,
 * como em `syncBlocks`).
 */
export function spawnParticles(
  scene: THREE.Scene,
  position: THREE.Vector3,
  count = 8,
): void {
  const ctx = renderContexts.get(scene);
  if (!ctx || count <= 0) return;

  if (!particleBox) {
    particleBox = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }

  // Material próprio por partícula: o fade (opacity) é individual, então
  // materiais compartilhados sumiriam todos juntos.
  const particles: Particle[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < count; i += 1) {
    const color = PARTICLE_COLORS[i % PARTICLE_COLORS.length]!;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      depthWrite: false,
    });
    materials.push(material);
    const mesh = new THREE.Mesh(particleBox, material);
    mesh.position.set(
      position.x + (Math.random() - 0.5) * 0.3,
      position.y + (Math.random() - 0.5) * 0.3,
      position.z + (Math.random() - 0.5) * 0.3,
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    mesh.renderOrder = 10;
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
    if (renderContexts.get(scene) !== ctx) {
      cleanup();
      return;
    }
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
      p.velY -= 9.8 * dt;
      p.mesh.position.y += p.velY * dt;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity =
        1 - p.age / p.lifetime;
    }

    ctx.renderNow();

    if (alive) {
      requestAnimationFrame(tick);
    } else {
      cleanup();
      ctx.renderNow();
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

/** Geometria compartilhada dos cubinhos de partícula (0,1³). */
let particleBox: THREE.BoxGeometry | null = null;

/** Cores vivas das partículas — visíveis porque o material ignora luz. */
const PARTICLE_COLORS: readonly number[] = [
  0xffd166, 0xff6b6b, 0x4ecdc4, 0xffa94d, 0x74c0fc,
];

/** Descarta a geometria compartilhada das partículas. Chamar no destroy. */
export function disposeParticles(): void {
  if (particleBox) {
    particleBox.dispose();
    particleBox = null;
  }
  if (_sharedShadowGeo) {
    _sharedShadowGeo.dispose();
    _sharedShadowGeo = null;
  }
  if (_sharedArrowGeo) {
    _sharedArrowGeo.dispose();
    _sharedArrowGeo = null;
  }
}

/** Faixa de zoom aceita pelos controles — reexportada para a UI. */
export { MIN_ZOOM, MAX_ZOOM };
export { normalizeWheel, zoomToFit, clampZoom } from './controls3d.ts';
