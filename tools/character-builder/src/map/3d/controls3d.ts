/**
 * Controles de câmera para o editor 3D.
 *
 * Pan (botão do meio / shift+arrasto), zoom contínuo (roda) e rotação discreta
 * de 90° (4 vistas). Sem OrbitControls — implementação própria, porque o editor
 * precisa de passos de 90° e de um alvo que o pan move, não de órbita livre.
 *
 * ## A câmera orbita um ALVO, não a origem
 *
 * `target` é o ponto que a câmera olha. A posição é sempre `target + offset(yaw)`.
 * Isso não é enfeite: com `lookAt(0,0,0)` fixo, girar a câmera depois de
 * arrastar o mapa jogava a vista de volta para a origem — o usuário perdia o
 * lugar onde estava trabalhando a cada giro. Pan move o alvo; girar mantém o
 * alvo; zoom com âncora move o alvo o tanto que for preciso para o pixel sob o
 * cursor não sair do lugar.
 *
 * ## Sistema de coordenadas
 *
 * Three.js: Y-up. O chão é o plano XZ. A câmera isométrica olha de uma posição
 * diagonal acima (yaw 45°, elevação 30° para o dimétrico 2:1).
 *
 * ## Zoom: contínuo, não em degraus inteiros
 *
 * O editor 2D do PixiJS exigia escala de palco INTEIRA — pixel art num palco
 * 2D em escala fracionária serrilha e treme. Aquele palco não existe mais
 * (ADR 0037). Aqui a arte é textura sobre geometria, amostrada com
 * `NearestFilter`: zoom fracionário não desalinha grade nenhuma, porque não há
 * grade de pixels do palco — há um framebuffer e uma projeção. O que sobra do
 * problema antigo é o cintilar de amostragem em texturas muito reduzidas, que é
 * o preço declarado por um zoom fluido.
 */
import * as THREE from 'three';
import type { Rotation } from '../../../../../packages/iso-core/src/rotation.ts';

// ------------------------------------------------------------------ constantes

/** Ângulo de elevação da câmera (do plano horizontal). 30° dá exatamente 2:1. */
export const ELEVATION = Math.PI / 6; // 30°

/** Distância da câmera ao alvo. Não afeta a escala (a projeção é ortográfica). */
export const DEFAULT_DISTANCE = 40;

/** Ângulo de yaw base para a vista 0 (câmera ao sul, olhando para norte). */
export const BASE_YAW = Math.PI / 4; // 45°

/** Meia-altura do frustum em world units no zoom 1. Define o "quanto cabe". */
export const FRUSTUM_HALF_HEIGHT = 15;

/** Duração da animação de rotação em ms. */
export const ROTATION_DURATION_MS = 280;

/** Limites do zoom. Abaixo de 0,3 o mapa vira confete; acima de 12 um bloco enche a tela. */
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 12;

/**
 * Sensibilidade da roda: fator de zoom por unidade de `deltaY` em pixels.
 *
 * O zoom é GEOMÉTRICO (`zoom *= e^(−dy·k)`), não aditivo. Aditivo dá passos
 * enormes perto do mínimo e imperceptíveis perto do máximo — é a razão de a
 * roda parecer "travada" num extremo e "arisca" no outro.
 */
export const ZOOM_WHEEL_SENSITIVITY = 0.0022;

/**
 * Constante de tempo do amortecimento do zoom, em segundos.
 *
 * O zoom corrente persegue o alvo com `1 − e^(−dt/τ)`: independente da taxa de
 * quadros, sem overshoot, e some sozinho quando chega. 0,09 s é rápido o
 * bastante para não parecer atraso e lento o bastante para o olho ler
 * movimento em vez de salto.
 */
export const ZOOM_SMOOTHING_TAU = 0.09;

/** Abaixo disso o zoom é considerado assentado e o laço de animação para. */
export const ZOOM_EPSILON = 0.0005;

// ------------------------------------------------------------------ câmera

/** O yaw da câmera para uma das quatro vistas. */
export function yawOf(rotation: Rotation): number {
  return BASE_YAW + rotation * (Math.PI / 2);
}

/** Deslocamento da câmera em relação ao alvo, para um yaw qualquer. */
export function orbitOffset(
  yaw: number,
  distance: number = DEFAULT_DISTANCE,
): THREE.Vector3 {
  return new THREE.Vector3(
    distance * Math.cos(ELEVATION) * Math.sin(yaw),
    distance * Math.sin(ELEVATION),
    distance * Math.cos(ELEVATION) * Math.cos(yaw),
  );
}

/**
 * Cria a OrthographicCamera do editor.
 *
 * `near` bem negativo e `far` generoso: a câmera é ortográfica e o alvo pode
 * ser deslocado pelo pan para longe do conteúdo, então um frustum apertado
 * recortaria blocos que estão perfeitamente à vista.
 */
export function createEditorCamera(
  viewportWidth: number,
  viewportHeight: number,
): THREE.OrthographicCamera {
  const aspect = viewportWidth / Math.max(1, viewportHeight);
  const camera = new THREE.OrthographicCamera(
    -FRUSTUM_HALF_HEIGHT * aspect,
    FRUSTUM_HALF_HEIGHT * aspect,
    FRUSTUM_HALF_HEIGHT,
    -FRUSTUM_HALF_HEIGHT,
    -200,
    400,
  );
  placeCamera(camera, new THREE.Vector3(0, 0, 0), yawOf(0));
  camera.zoom = 2;
  camera.updateProjectionMatrix();
  return camera;
}

/** Ajusta o frustum ao novo tamanho do viewport, preservando o zoom. */
export function resizeCamera(
  camera: THREE.OrthographicCamera,
  width: number,
  height: number,
): void {
  const aspect = width / Math.max(1, height);
  camera.left = -FRUSTUM_HALF_HEIGHT * aspect;
  camera.right = FRUSTUM_HALF_HEIGHT * aspect;
  camera.top = FRUSTUM_HALF_HEIGHT;
  camera.bottom = -FRUSTUM_HALF_HEIGHT;
  camera.updateProjectionMatrix();
}

/**
 * Põe a câmera em órbita ao redor do alvo, no yaw dado.
 *
 * `updateMatrixWorld(true)` no fim é obrigatório e não é detalhe: o pan e o
 * zoom com âncora leem as colunas de `camera.matrix` para saber o que é
 * "direita" e "cima" na tela. Sem forçar a atualização, o primeiro arrasto
 * depois de um giro usaria os eixos da vista ANTERIOR.
 */
export function placeCamera(
  camera: THREE.OrthographicCamera,
  target: THREE.Vector3,
  yaw: number,
): void {
  camera.position.copy(target).add(orbitOffset(yaw));
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

/** Posiciona a câmera para uma das quatro vistas discretas. */
export function setCameraRotation(
  camera: THREE.OrthographicCamera,
  target: THREE.Vector3,
  rotation: Rotation,
): void {
  placeCamera(camera, target, yawOf(rotation));
}

// ------------------------------------------------------------------ eixos de tela

/** Vetor "direita da tela" em world space (coluna 0 da matriz da câmera). */
export function screenRight(
  camera: THREE.OrthographicCamera,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const e = camera.matrix.elements;
  return out.set(e[0]!, e[1]!, e[2]!);
}

/** Vetor "cima da tela" em world space (coluna 1 da matriz da câmera). */
export function screenUp(
  camera: THREE.OrthographicCamera,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const e = camera.matrix.elements;
  return out.set(e[4]!, e[5]!, e[6]!);
}

// ------------------------------------------------------------------ pan

const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3();

/**
 * Move o alvo no plano da tela, a partir de um delta em PIXELS.
 *
 * A conversão pixel → world divide o frustum pelo tamanho do viewport e pelo
 * zoom: é o que faz o mapa acompanhar o cursor exatamente, em qualquer zoom.
 * Sem o `/zoom`, arrastar com zoom 4 moveria o mapa quatro vezes mais que o
 * cursor.
 */
export function panTarget(
  camera: THREE.OrthographicCamera,
  target: THREE.Vector3,
  pixelDx: number,
  pixelDy: number,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const worldPerPixelX =
    (camera.right - camera.left) / camera.zoom / Math.max(1, viewportWidth);
  const worldPerPixelY =
    (camera.top - camera.bottom) / camera.zoom / Math.max(1, viewportHeight);
  screenRight(camera, tmpRight);
  screenUp(camera, tmpUp);
  target.addScaledVector(tmpRight, -pixelDx * worldPerPixelX);
  target.addScaledVector(tmpUp, pixelDy * worldPerPixelY);
}

// ------------------------------------------------------------------ zoom

/** Prende o zoom na faixa utilizável. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Aplica um passo de roda ao zoom alvo. Geométrico, então cada "clique" da roda
 * muda a mesma FRAÇÃO do zoom em qualquer ponto da faixa.
 */
export function zoomStep(current: number, wheelDeltaY: number): number {
  return clampZoom(current * Math.exp(-wheelDeltaY * ZOOM_WHEEL_SENSITIVITY));
}

/**
 * Move o alvo para que o ponto do mundo sob o cursor não saia do lugar quando o
 * zoom muda.
 *
 * Numa projeção ortográfica, o ponto sob um NDC `(nx, ny)` é
 * `target + right·(nx·halfW/zoom) + up·(ny·halfH/zoom)`. Igualando o ponto
 * antes e depois:
 *
 * ```text
 * target₁ = target₀ + (right·nx·halfW + up·ny·halfH) · (1/zoom₀ − 1/zoom₁)
 * ```
 *
 * Sem isto, dar zoom "entra" sempre pelo centro da tela e o usuário persegue o
 * que queria olhar com o botão do meio. É a diferença entre um zoom que parece
 * responder ao cursor e um que parece responder ao layout.
 */
export function anchorZoom(
  camera: THREE.OrthographicCamera,
  target: THREE.Vector3,
  previousZoom: number,
  nextZoom: number,
  ndcX: number,
  ndcY: number,
): void {
  if (previousZoom === nextZoom) return;
  const halfW = (camera.right - camera.left) / 2;
  const halfH = (camera.top - camera.bottom) / 2;
  const k = 1 / previousZoom - 1 / nextZoom;
  screenRight(camera, tmpRight);
  screenUp(camera, tmpUp);
  target.addScaledVector(tmpRight, ndcX * halfW * k);
  target.addScaledVector(tmpUp, ndcY * halfH * k);
}

/**
 * Um passo de amortecimento exponencial em direção ao alvo.
 *
 * `1 − e^(−dt/τ)` e não um `lerp` de fator fixo: com fator fixo a velocidade da
 * animação depende da taxa de quadros, e o mesmo gesto fica lento num monitor
 * de 60 Hz e nervoso num de 144 Hz.
 */
export function approach(current: number, goal: number, dt: number): number {
  const alpha = 1 - Math.exp(-dt / ZOOM_SMOOTHING_TAU);
  return current + (goal - current) * alpha;
}

// ------------------------------------------------------------------ normalização

/**
 * Converte `deltaY` de um WheelEvent para pixels equivalentes,
 * independente do `deltaMode` do navegador.
 *
 * Firefox manda modo LINE (1), Chrome manda modo PIXEL (0), e o Safari
 * manda ambos a depender do dispositivo. Sem esta normalização, a roda no
 * Firefox seria ~17x mais lenta que no Chrome.
 */
export function normalizeWheel(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 17;   // CSS line-height padrão
  if (deltaMode === 2) return deltaY * 800;  // viewport típico
  return deltaY;
}

// ------------------------------------------------------------------ zoom-to-fit

/**
 * Calcula o zoom e o target para enquadrar uma bounding box no viewport.
 *
 * Projeta os 8 vértices da caixa no espaço da câmera e deriva o zoom pelo
 * eixo mais restritivo. Considera a projeção isométrica: as células nos
 * cantos da tela estão mais distantes em world-space que as do centro.
 *
 * O target é o centro geométrico da caixa. O zoom é o menor entre os dois
 * eixos da tela, com a margem especificada.
 *
 * @param bounds - A bounding box do mapa no plano XZ.
 * @param maxHeight - Altura máxima dos blocos (Y do mundo).
 * @param viewportW - Largura do viewport em pixels.
 * @param viewportH - Altura do viewport em pixels.
 * @param yaw - Yaw corrente da câmera.
 * @param margin - Margem como fração (0.1 = 10%).
 */
export function zoomToFit(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  maxHeight: number,
  viewportW: number,
  viewportH: number,
  yaw: number,
  margin = 0.1,
): { zoom: number; target: THREE.Vector3 } {
  const E = ELEVATION;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const se = Math.sin(E);
  const ce = Math.cos(E);

  // Vetores da câmera no espaço do mundo, ortonormais.
  // Derivados da lookAt com up=(0,1,0) — ver o cabeçalho de controls3d.ts.
  const right = new THREE.Vector3(-cy, 0, sy);
  const up = new THREE.Vector3(-se * sy, ce, -se * cy);

  // Centro da bounding box
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const cyWorld = maxHeight / 2;
  const target = new THREE.Vector3(cx, cyWorld, cz);

  // Projeta os 8 vértices no espaço da câmera
  let camMinX = Infinity;
  let camMaxX = -Infinity;
  let camMinY = Infinity;
  let camMaxY = -Infinity;

  const corners: [number, number, number][] = [
    [bounds.minX, 0, bounds.minZ],
    [bounds.maxX, 0, bounds.minZ],
    [bounds.minX, 0, bounds.maxZ],
    [bounds.maxX, 0, bounds.maxZ],
    [bounds.minX, maxHeight, bounds.minZ],
    [bounds.maxX, maxHeight, bounds.minZ],
    [bounds.minX, maxHeight, bounds.maxZ],
    [bounds.maxX, maxHeight, bounds.maxZ],
  ];

  for (const [wx, wy, wz] of corners) {
    const dx = wx - cx;
    const dy = wy - cyWorld;
    const dz = wz - cz;
    const camX = dx * right.x + dy * right.y + dz * right.z;
    const camY = dx * up.x + dy * up.y + dz * up.z;
    if (camX < camMinX) camMinX = camX;
    if (camX > camMaxX) camMaxX = camX;
    if (camY < camMinY) camMinY = camY;
    if (camY > camMaxY) camMaxY = camY;
  }

  const extentX = Math.max(Math.abs(camMinX), Math.abs(camMaxX));
  const extentY = Math.max(Math.abs(camMinY), Math.abs(camMaxY));

  const aspect = viewportW / Math.max(1, viewportH);
  const halfW = FRUSTUM_HALF_HEIGHT * aspect;  // meia-largura do frustum
  const halfH = FRUSTUM_HALF_HEIGHT;           // meia-altura do frustum

  const zoomX = extentX > 0 ? halfW / extentX : MAX_ZOOM;
  const zoomY = extentY > 0 ? halfH / extentY : MAX_ZOOM;
  const zoom = clampZoom(Math.min(zoomX, zoomY) * (1 - margin));

  return { zoom, target };
}

// ------------------------------------------------------------------ utilidades

/**
 * Posição da câmera em coordenadas "isométricas" (como o editor 2D vê).
 * Útil para depuração e para a HUD de status.
 */
export function cameraIsoDirection(rotation: Rotation): string {
  const dirs = ['sul', 'leste', 'norte', 'oeste'];
  return dirs[rotation]!;
}

/** Easing cúbico simétrico — acelera no início, desacelera no fim. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
