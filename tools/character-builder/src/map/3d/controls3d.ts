/**
 * Controles de câmera para o editor 3D.
 *
 * Pan (botão do meio / shift+arrasto), zoom (roda), e rotação discreta
 * de 90° (4 vistas). Sem dependência de OrbitControls — implementação
 * própria para acoplar ao estado React.
 *
 * ## Sistema de coordenadas
 *
 * Three.js: Y-up. O chão é o plano XZ. A câmera isométrica olha de
 * uma posição diagonal acima (yaw 45°, elevação ~30° para 2:1 dimétrico).
 *
 * ## Rotação
 *
 * 4 vistas discretas como no editor 2D. Girar 90° significa rotacionar
 * a câmera ao redor do centro do conteúdo no plano XZ. A altura (Y)
 * não muda com a rotação.
 */
import * as THREE from 'three';
import type { Rotation } from '../../../../../packages/iso-core/src/rotation.ts';

// ------------------------------------------------------------------ constantes

/** Ângulo de elevação da câmera (do plano horizontal). 30° ≈ visual 2:1. */
export const ELEVATION = Math.PI / 6; // 30°

/** Distância da câmera à origem — controla o zoom aparente. */
export const DEFAULT_DISTANCE = 15;

/** Ângulo de yaw base para a vista 0 (câmera ao sul, olhando para norte). */
export const BASE_YAW = Math.PI / 4; // 45°

/** Duração da animação de rotação em ms. */
export const ROTATION_DURATION_MS = 280;

// ------------------------------------------------------------------ câmera

/**
 * Cria a OrthographicCamera para o editor.
 *
 * Frustum calculado a partir do aspect ratio do viewport.
 */
export function createEditorCamera(
  viewportWidth: number,
  viewportHeight: number,
): THREE.OrthographicCamera {
  const aspect = viewportWidth / viewportHeight;
  const frustumSize = DEFAULT_DISTANCE;

  const camera = new THREE.OrthographicCamera(
    -frustumSize * aspect,
    frustumSize * aspect,
    frustumSize,
    -frustumSize,
    0.1,
    1000,
  );

  // Posição inicial: vista 0 (sul → norte no plano XZ)
  setCameraRotation(camera, 0);
  camera.zoom = 1;
  camera.updateProjectionMatrix();

  return camera;
}

/**
 * Posiciona a câmera para a rotação dada.
 *
 * A câmera orbita ao redor do ponto de foco mantendo a elevação constante.
 * Yaw = BASE_YAW + rotation * π/2.
 */
export function setCameraRotation(
  camera: THREE.OrthographicCamera,
  rotation: Rotation,
): void {
  const yaw = BASE_YAW + rotation * (Math.PI / 2);
  const dist = DEFAULT_DISTANCE;

  camera.position.x = dist * Math.cos(ELEVATION) * Math.sin(yaw);
  camera.position.y = dist * Math.sin(ELEVATION);
  camera.position.z = dist * Math.cos(ELEVATION) * Math.cos(yaw);

  camera.lookAt(0, 0, 0);
}

/**
 * Aplica pan (deslocamento no plano da tela) à câmera.
 *
 * Move a câmera no plano perpendicular à direção de visão.
 */
export function panCamera(
  camera: THREE.OrthographicCamera,
  dx: number,
  dy: number,
): void {
  // dx, dy estão em pixels de tela. Converter para world units
  // usando o frustum size e o tamanho do viewport.
  const frustumHeight = (camera.top - camera.bottom) / camera.zoom;
  const frustumWidth = (camera.right - camera.left) / camera.zoom;

  // Vetores right e up da câmera no plano de visão
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  camera.getWorldDirection(new THREE.Vector3());
  right.setX(camera.matrix.elements[0]!); // coluna 0 = right
  right.setY(camera.matrix.elements[1]!);
  right.setZ(camera.matrix.elements[2]!);
  up.setX(camera.matrix.elements[4]!); // coluna 1 = up
  up.setY(camera.matrix.elements[5]!);
  up.setZ(camera.matrix.elements[6]!);

  // Normaliza para o tamanho do viewport (assume que dx/dy são pixels
  // e o canvas tem tamanho que corresponde ao frustum)
  // Na prática, o caller escala dx/dy conforme necessário.
  camera.position.addScaledVector(right, -dx);
  camera.position.addScaledVector(up, dy);
}

/**
 * Aplica zoom à câmera.
 *
 * `camera.zoom` multiplica o frustum — valores maiores = mais zoom in.
 * O caller garante zoom inteiro para pixel art.
 */
export function zoomCamera(
  camera: THREE.OrthographicCamera,
  factor: number,
): void {
  camera.zoom = Math.max(0.25, Math.min(8, factor));
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ utilidades

/**
 * Posição da câmera em coordenadas "isométricas" (como o editor 2D vê).
 *
 * Útil para debug e para a HUD de status.
 */
export function cameraIsoDirection(rotation: Rotation): string {
  const dirs = ['sul', 'leste', 'norte', 'oeste'];
  return dirs[rotation]!;
}

/**
 * Converte um delta de mouse (pixels) em deslocamento de câmera.
 *
 * Leva em conta o zoom atual e o tamanho do viewport.
 */
export function pixelDeltaToWorld(
  camera: THREE.OrthographicCamera,
  pixelDx: number,
  pixelDy: number,
  viewportWidth: number,
  viewportHeight: number,
): { dx: number; dy: number } {
  const frustumHeight = (camera.top - camera.bottom) / camera.zoom;
  const frustumWidth = (camera.right - camera.left) / camera.zoom;

  const worldDx = (pixelDx / viewportWidth) * frustumWidth;
  const worldDy = (pixelDy / viewportHeight) * frustumHeight;

  return { dx: worldDx, dy: worldDy };
}
