/**
 * Renderizador isométrico do runtime — Three.js.
 *
 * O runtime desenha o MESMO mundo que o editor: cubos unitários numa câmera
 * ortográfica com yaw 45° e elevação 30° (a projeção 2:1 em que a arte foi
 * desenhada). Até 2026-08-05 ele desenhava losangos 2D com um `Graphics` por
 * bloco — um mundo diferente do que o editor mostra, e um objeto de cena por
 * célula. Um mapa de 20 mil células custava 20 mil desenhos.
 *
 * ## Um `InstancedMesh`, um desenho
 *
 * Todos os cubos são instâncias de UMA geometria com UM material. A cor por
 * célula vai no atributo `instanceColor`, que é por instância e não custa
 * material novo. O mapa inteiro é UM draw call, independente de ter 100 ou
 * 100 000 blocos — e o `InstancedMesh` é realocado só quando a contagem cresce.
 *
 * ## Faces internas não são desenhadas
 *
 * Uma célula cercada nos seis lados não aparece em vista nenhuma. `isHidden`
 * as descarta antes de virarem instância: num mapa maciço isso corta a maior
 * parte do trabalho, e o corte é exato — nenhuma célula visível some.
 *
 * ## Sombra
 *
 * Uma luz direcional que existe só para PROJETAR (nenhum material da cena é
 * iluminado) e um plano `ShadowMaterial` que desenha a sombra. É o mesmo rig
 * do editor, pelo mesmo motivo: com `ShadowMaterial` a opacidade É o
 * escurecimento, sem depender da fotometria da luz.
 */
import * as THREE from 'three';
import type { ProjectGeometry } from '@isometric-maker/iso-core/project';
import type { MapData } from '@isometric-maker/iso-core/map';
import type { MovementState } from '@isometric-maker/iso-core/movement';
import { loadAtlas, type LoadedAtlas } from './atlas.ts';

// ------------------------------------------------------------------ tipos

export interface RenderContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly geom: ProjectGeometry;
  /** Malha instanciada de todos os cubos. Recriada quando o mapa cresce. */
  cubes: THREE.InstancedMesh | null;
  /** O plano que recebe a sombra — acompanha o tamanho do mapa. */
  readonly shadowCatcher: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
}

export interface CharacterRender {
  readonly sprite: THREE.Sprite;
  readonly atlas: LoadedAtlas;
  readonly sidecarFps: Record<string, number>;
  /** Nome da animação atual. */
  currentAnim: string;
  /** Quadros da animação atual. */
  currentFrames: readonly THREE.Texture[];
  /** Índice do quadro atual e o instante do último avanço. */
  frameIndex: number;
  lastAdvance: number;
  /** Direção atual (ângulo em radianos). */
  facing: number;
}

export interface FpsCounter {
  frames: number;
  lastTime: number;
  fps: number;
  drawCalls: number;
}

// ------------------------------------------------------------------ constantes

/** Cores de bloco para renderização de fallback (sem atlas de tiles). */
const BLOCK_COLORS: Record<string, number> = {
  grass: 0x4caf50,
  dirt: 0x8d6e63,
  stone: 0x9e9e9e,
  sand: 0xfff176,
  water: 0x42a5f5,
  wood: 0x795548,
};

/** Cor padrão para blocos sem cor conhecida. */
const DEFAULT_BLOCK_COLOR = 0x607d8b;

const BG_COLOR = 0x1a1a2e;

/** Ângulos da câmera — os mesmos do editor (`controls3d.ts`). */
const ELEVATION = Math.PI / 6;
const BASE_YAW = Math.PI / 4;
const CAMERA_DISTANCE = 60;

/** Meia-altura do frustum em world units. Define o "quanto cabe na tela". */
const FRUSTUM_HALF_HEIGHT = 12;

/** Altura do personagem em unidades de mundo (~1,5 blocos). */
const ACTOR_HEIGHT = 1.6;

/** Opacidade da sombra projetada — literalmente o quanto o chão escurece. */
const SHADOW_OPACITY = 0.42;

/** Direção da luz que projeta sombra. Fixa no mundo. */
const SUN_OFFSET = new THREE.Vector3(14, 26, 8);

/**
 * Folga da alocação do `InstancedMesh`.
 *
 * Realocar é caro (buffer novo na GPU); alocar 25% a mais faz o mapa crescer
 * um bom tanto antes de pagar de novo.
 */
const INSTANCE_SLACK = 1.25;

// ------------------------------------------------------------------ contexto

export function createRenderContext(
  canvas: HTMLCanvasElement,
  geom: ProjectGeometry,
): RenderContext {
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
  // O mapa do runtime não muda: o shadow map é calculado uma vez e reusado em
  // todos os quadros seguintes. Sem isto, um passe de profundidade de 2048²
  // rodaria 60 vezes por segundo para desenhar sempre a mesma sombra.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const camera = new THREE.OrthographicCamera(
    -FRUSTUM_HALF_HEIGHT * aspect,
    FRUSTUM_HALF_HEIGHT * aspect,
    FRUSTUM_HALF_HEIGHT,
    -FRUSTUM_HALF_HEIGHT,
    -400,
    800,
  );
  camera.updateProjectionMatrix();

  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: SHADOW_OPACITY }),
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = -0.005;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  return { renderer, scene, camera, geom, cubes: null, shadowCatcher, sun };
}

/** Ajusta renderer e frustum ao tamanho da janela. */
export function resizeRenderer(
  ctx: RenderContext,
  width: number,
  height: number,
): void {
  if (width === 0 || height === 0) return;
  ctx.renderer.setSize(width, height, false);
  const aspect = width / Math.max(1, height);
  ctx.camera.left = -FRUSTUM_HALF_HEIGHT * aspect;
  ctx.camera.right = FRUSTUM_HALF_HEIGHT * aspect;
  ctx.camera.top = FRUSTUM_HALF_HEIGHT;
  ctx.camera.bottom = -FRUSTUM_HALF_HEIGHT;
  ctx.camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ mapa

/** Índice de solidez do mapa, para descobrir as células escondidas. */
function solidSetOf(mapa: MapData): Set<string> {
  const solid = new Set<string>();
  for (const [key, runs] of Object.entries(mapa.blocks)) {
    const [xs, ys] = key.split(':');
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    let z = 0;
    for (const run of runs) {
      if (run.block !== '') {
        for (let i = 0; i < run.count; i += 1) solid.add(`${x}:${y}:${z + i}`);
      }
      z += run.count;
    }
  }
  return solid;
}

/**
 * A célula está cercada nos seis lados?
 *
 * Só então ela pode sumir. Uma célula com qualquer vizinho ausente ainda tem
 * face visível de alguma vista — e o runtime não sabe de que ângulo a câmera
 * vai olhar, porque ela gira.
 */
function isHidden(solid: ReadonlySet<string>, x: number, y: number, z: number): boolean {
  return (
    solid.has(`${x + 1}:${y}:${z}`) &&
    solid.has(`${x - 1}:${y}:${z}`) &&
    solid.has(`${x}:${y + 1}:${z}`) &&
    solid.has(`${x}:${y - 1}:${z}`) &&
    solid.has(`${x}:${y}:${z + 1}`) &&
    solid.has(`${x}:${y}:${z - 1}`)
  );
}

/**
 * Constrói (ou reconstrói) a malha instanciada dos cubos e ajusta o rig de
 * sombra ao tamanho do mapa.
 */
export function drawMap(ctx: RenderContext, mapa: MapData): void {
  const solid = solidSetOf(mapa);

  const visible: { x: number; y: number; z: number; block: string }[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [key, runs] of Object.entries(mapa.blocks)) {
    const [xs, ys] = key.split(':');
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    let z = 0;
    for (const run of runs) {
      if (run.block !== '') {
        for (let i = 0; i < run.count; i += 1) {
          const cz = z + i;
          if (!isHidden(solid, x, y, cz)) {
            visible.push({ x, y, z: cz, block: run.block });
          }
        }
      }
      z += run.count;
    }
  }

  // Realoca só quando não cabe: o `InstancedMesh` tem capacidade fixa.
  if (ctx.cubes === null || ctx.cubes.count < visible.length) {
    if (ctx.cubes) {
      ctx.scene.remove(ctx.cubes);
      ctx.cubes.geometry.dispose();
      (ctx.cubes.material as THREE.Material).dispose();
      ctx.cubes.dispose();
    }
    const capacity = Math.max(16, Math.ceil(visible.length * INSTANCE_SLACK));
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
      capacity,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ctx.scene.add(mesh);
    ctx.cubes = mesh;
  }

  const cubes = ctx.cubes;
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  visible.forEach((cell, i) => {
    // Mapa → Three.js: x→X, z→Y (altura), y→Z. `+0.5` porque a `BoxGeometry`
    // tem o centro na origem e a base do cubo tem de assentar em z inteiro.
    matrix.makeTranslation(cell.x, cell.z + 0.5, cell.y);
    cubes.setMatrixAt(i, matrix);
    cubes.setColorAt(i, color.setHex(BLOCK_COLORS[cell.block] ?? DEFAULT_BLOCK_COLOR));
  });
  // `count` menor que a capacidade: as instâncias sobrando não são desenhadas.
  cubes.count = visible.length;
  cubes.instanceMatrix.needsUpdate = true;
  if (cubes.instanceColor) cubes.instanceColor.needsUpdate = true;
  cubes.computeBoundingSphere();

  sizeShadowRig(ctx, minX, maxX, minY, maxY);
  ctx.renderer.shadowMap.needsUpdate = true;
}

/**
 * Põe o plano da sombra e o frustum da luz do tamanho do mapa.
 *
 * O frustum precisa cobrir o mapa NA PROJEÇÃO DA LUZ, que é maior que a
 * projeção alinhada aos eixos — o mapa visto em diagonal tem a diagonal ~1,4×
 * maior. Daí o padding.
 */
function sizeShadowRig(
  ctx: RenderContext,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): void {
  const has = Number.isFinite(minX);
  const centerX = has ? (minX + maxX) / 2 : 0;
  const centerZ = has ? (minY + maxY) / 2 : 0;
  const size = has ? Math.max(maxX - minX, maxY - minY) + 8 : 20;

  ctx.shadowCatcher.position.set(centerX, -0.005, centerZ);
  ctx.shadowCatcher.scale.set(size, size, 1);

  const half = size / 2;
  const pad = half * 0.6 + 2;
  const cam = ctx.sun.shadow.camera;
  cam.left = -(half + pad);
  cam.right = half + pad;
  cam.top = half + pad;
  cam.bottom = -(half + pad);
  cam.near = 0.5;
  cam.far = Math.max(200, half * 6);
  cam.updateProjectionMatrix();

  ctx.sun.position.set(centerX + SUN_OFFSET.x, SUN_OFFSET.y, centerZ + SUN_OFFSET.z);
  ctx.sun.target.position.set(centerX, 0, centerZ);
  ctx.sun.target.updateMatrixWorld();
}

// ------------------------------------------------------------------ câmera

/**
 * Centra a câmera no personagem, mantendo o ângulo isométrico.
 *
 * A posição é sempre `alvo + offset(yaw)`: a câmera acompanha sem nunca mudar
 * de ângulo, que é o que faz o mundo continuar lendo como isométrico.
 */
export function followCamera(
  ctx: RenderContext,
  x: number,
  y: number,
  z: number,
): void {
  const target = new THREE.Vector3(x, z, y);
  ctx.camera.position.set(
    target.x + CAMERA_DISTANCE * Math.cos(ELEVATION) * Math.sin(BASE_YAW),
    target.y + CAMERA_DISTANCE * Math.sin(ELEVATION),
    target.z + CAMERA_DISTANCE * Math.cos(ELEVATION) * Math.cos(BASE_YAW),
  );
  ctx.camera.lookAt(target);
  ctx.camera.updateMatrixWorld(true);
}

// ------------------------------------------------------------------ personagem

export async function createCharacterRender(
  ctx: RenderContext,
  sheetUrl: string,
  sidecar: {
    readonly fps: Record<string, number>;
    readonly anchor: { readonly x: number; readonly y: number };
  },
): Promise<CharacterRender> {
  const atlas = await loadAtlas(sheetUrl);

  const animNames = [...atlas.animations.keys()];
  const firstAnim = animNames[0] ?? '';
  const frames =
    atlas.animations.get(firstAnim) ?? [...atlas.frames.values()].slice(0, 1);

  const material = new THREE.SpriteMaterial({
    map: frames[0] ?? null,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  // O `Sprite` é centrado na origem; `center` reposiciona a âncora. O eixo Y
  // do atlas cresce para baixo e o do sprite para cima — daí o `1 −`.
  sprite.center.set(sidecar.anchor.x, 1 - sidecar.anchor.y);
  sprite.scale.set(ACTOR_HEIGHT * atlas.aspect, ACTOR_HEIGHT, 1);
  sprite.renderOrder = 10;
  ctx.scene.add(sprite);

  return {
    sprite,
    atlas,
    sidecarFps: sidecar.fps,
    currentAnim: firstAnim,
    currentFrames: frames,
    frameIndex: 0,
    lastAdvance: performance.now(),
    facing: 0,
  };
}

/**
 * Troca a animação do personagem se a ação mudou, e avança o quadro.
 *
 * A seleção é baseada no estado de movimento:
 *   - `airborne` → jump
 *   - `vel == 0` → idle
 *   - senão → walk
 *
 * O avanço é por RELÓGIO, não por quadro desenhado: o fps do sidecar (8, na
 * prática) não tem relação com a taxa do monitor, e amarrar um ao outro faria
 * a animação correr a 144 fps num monitor de 144 Hz.
 */
export function updateCharacterAnim(
  char: CharacterRender,
  state: MovementState,
  now: number = performance.now(),
): void {
  let action: string;
  if (state.airborne) {
    action = 'jump';
  } else if (state.vel.x === 0 && state.vel.y === 0) {
    action = 'idle';
  } else {
    action = 'walk';
  }

  const dir = facingToDirection(state.facing);
  const animName = `${action}_${dir}`;

  if (animName !== char.currentAnim) {
    const frames = findAnimation(char.atlas, animName);
    if (frames) {
      char.currentAnim = animName;
      char.currentFrames = frames;
      char.frameIndex = 0;
      char.lastAdvance = now;
    }
  }
  char.facing = state.facing;

  const fps = char.sidecarFps[char.currentAnim] ?? 8;
  const total = char.currentFrames.length;
  if (total > 1 && fps > 0) {
    const step = 1000 / fps;
    while (now - char.lastAdvance >= step) {
      char.lastAdvance += step;
      char.frameIndex = (char.frameIndex + 1) % total;
    }
  }

  const tex = char.currentFrames[char.frameIndex % Math.max(1, total)];
  const material = char.sprite.material as THREE.SpriteMaterial;
  if (tex && material.map !== tex) {
    material.map = tex;
    material.needsUpdate = true;
  }
}

/**
 * Acha a animação pelo nome, aceitando o prefixo de família.
 *
 * O pipeline nomeia `<familia>_<acao>_<DIR>` (`lobo_walk_S`), e o runtime só
 * conhece `<acao>_<DIR>`. Procurar pelo sufixo é o que liga os dois sem o
 * runtime ter de saber o nome da criatura.
 */
function findAnimation(
  atlas: LoadedAtlas,
  suffix: string,
): readonly THREE.Texture[] | null {
  const exact = atlas.animations.get(suffix);
  if (exact) return exact;
  for (const [name, frames] of atlas.animations) {
    if (name.endsWith(`_${suffix}`)) return frames;
  }
  return null;
}

const DIRECTION_LABELS = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

function facingToDirection(angle: number): string {
  let a = angle % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  const idx = Math.round((a / (Math.PI / 4)) % 8);
  return DIRECTION_LABELS[idx % 8]!;
}

// ------------------------------------------------------------------ posicionamento

/**
 * Posiciona o sprite do personagem no mundo 3D.
 *
 * `x`/`y` são o plano do mapa e `z` a altura — a mesma troca de eixos dos
 * cubos. Meia altura de corpo é somada para os pés assentarem no piso.
 */
export function positionCharacter(
  sprite: THREE.Sprite,
  x: number,
  y: number,
  z: number,
): void {
  sprite.position.set(x, z + ACTOR_HEIGHT / 2, y);
}

// ------------------------------------------------------------------ fps

export function createFpsCounter(): FpsCounter {
  return { frames: 0, lastTime: performance.now(), fps: 0, drawCalls: 0 };
}

/**
 * Conta quadros por segundo e lê os draw calls REAIS do renderer.
 *
 * `renderer.info.render.calls` é medido pelo próprio Three.js a cada
 * `render()` — não é estimativa. Com a malha instanciada ele fica em torno de
 * 3 (cubos, sombra, personagem) para qualquer tamanho de mapa; se subir com o
 * tamanho, o instanciamento quebrou.
 */
export function updateFps(counter: FpsCounter, renderer: THREE.WebGLRenderer): void {
  counter.frames++;
  const now = performance.now();
  if (now - counter.lastTime >= 1000) {
    counter.fps = counter.frames;
    counter.frames = 0;
    counter.lastTime = now;
    counter.drawCalls = renderer.info.render.calls;
    console.log(`FPS: ${counter.fps}  |  Draw Calls: ${counter.drawCalls}`);
  }
}
