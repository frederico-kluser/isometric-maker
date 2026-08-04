/**
 * O chão do editor 3D: quatro planos com quatro funções distintas.
 *
 * | Plano | Y | Material | Para quê |
 * |---|---|---|---|
 * | `floor` | −0,02 | `MeshBasicMaterial` escuro | dar fundo às sombras |
 * | `catcher` | −0,005 | `ShadowMaterial` | **desenhar a sombra** |
 * | `pick` | −0,01 | invisível | capturar clique no vazio |
 * | `grid` | +0,001 | linhas | orientação por célula |
 *
 * ## Por que a sombra tem plano próprio
 *
 * `ShadowMaterial` desenha SÓ a sombra: onde a luz chega ele é totalmente
 * transparente, onde não chega ele é preto com a opacidade escolhida. Isso
 * separa a sombra da iluminação — e essa separação é o que permite os cubos
 * serem `MeshBasicMaterial` (arte exata, sem sombreamento por cima, ver
 * `cube3d.ts`) e ainda assim projetarem sombra visível no chão.
 *
 * A alternativa — piso `MeshStandardMaterial` com `receiveShadow` — amarra a
 * intensidade da sombra à fotometria das luzes: mudar a luz muda o quanto a
 * sombra escurece, e o resultado depende de constantes que só se acertam por
 * tentativa na tela. Com `ShadowMaterial`, a opacidade É o escurecimento.
 *
 * ## Os Y minúsculos não são superstição
 *
 * Os quatro planos são paralelos e quase coincidentes; sem separação eles
 * brigam por profundidade e o resultado cintila conforme a câmera se move. A
 * ordem de empilhamento resolve isso e mais uma coisa: o `catcher` fica ABAIXO
 * da base dos cubos (que é `y = 0`), então a sombra nunca aparece atravessando
 * a base de um bloco.
 */
import * as THREE from 'three';

// ------------------------------------------------------------------ constantes

const FLOOR_Y = -0.02;
const CATCHER_Y = -0.005;
const PICK_Y = -0.01;
const GRID_Y = 0.001;

/** Lado do plano na criação. O redimensionamento é por `scale`, não por geometria. */
const BASE_SIZE = 10;

/** Margem em células ao redor do conteúdo. */
export const GRID_MARGIN = 4;

/** Lado mínimo do chão, em células. Um mapa vazio ainda precisa de onde clicar. */
const MIN_SIZE = 20;

const FLOOR_COLOR = 0x141a2e;
const GRID_COLOR = 0x94a3b8;
const GRID_SUBCOLOR = 0x334155;

/** Opacidade da sombra projetada. É literalmente o quanto o chão escurece. */
const SHADOW_OPACITY = 0.42;

// ------------------------------------------------------------------ tipos

/** Retângulo ocupado pelo mapa, em células. */
export interface MapBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Os quatro planos do chão, criados juntos porque mudam juntos. */
export interface GroundRig {
  grid: THREE.GridHelper;
  readonly pick: THREE.Mesh;
  readonly floor: THREE.Mesh;
  readonly catcher: THREE.Mesh;
  /** Extensão atual, para o frustum da sombra acompanhar. */
  size: number;
  centerX: number;
  centerZ: number;
}

// ------------------------------------------------------------------ grid visual

function makeGrid(size: number, divisions: number): THREE.GridHelper {
  const grid = new THREE.GridHelper(size, divisions, GRID_COLOR, GRID_SUBCOLOR);
  grid.material.transparent = true;
  grid.material.opacity = 0.3;
  grid.material.depthTest = true;
  grid.material.depthWrite = false;
  grid.renderOrder = 2;
  return grid;
}

// ------------------------------------------------------------------ fábrica

/** Cria os quatro planos e adiciona todos à cena. */
export function createGroundRig(scene: THREE.Scene): GroundRig {
  const grid = makeGrid(BASE_SIZE, BASE_SIZE);
  grid.position.set(0.5, GRID_Y, 0.5); // meio-cubo: linhas nas arestas, não nos centros
  scene.add(grid);

  const planeGeom = new THREE.PlaneGeometry(BASE_SIZE, BASE_SIZE);

  const pick = new THREE.Mesh(
    planeGeom,
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
  );
  pick.rotation.x = -Math.PI / 2;
  pick.position.y = PICK_Y;
  pick.name = 'ground-plane';
  pick.renderOrder = -1;
  scene.add(pick);

  const floor = new THREE.Mesh(
    planeGeom,
    new THREE.MeshBasicMaterial({ color: FLOOR_COLOR }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.name = 'ground-floor';
  floor.renderOrder = 0;
  scene.add(floor);

  const catcher = new THREE.Mesh(
    planeGeom,
    new THREE.ShadowMaterial({
      color: 0x000000,
      opacity: SHADOW_OPACITY,
      // Não escreve profundidade: o grid é desenhado depois e não pode ser
      // ocultado por um plano que, onde não há sombra, é invisível.
      depthWrite: false,
    }),
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = CATCHER_Y;
  catcher.receiveShadow = true;
  catcher.name = 'shadow-catcher';
  catcher.renderOrder = 1;
  scene.add(catcher);

  return {
    grid, pick, floor, catcher,
    size: BASE_SIZE, centerX: 0, centerZ: 0,
  };
}

// ------------------------------------------------------------------ redimensionamento

/** Extensão e centro do chão para os bounds dados. */
function extentOf(bounds: MapBounds): {
  size: number;
  centerX: number;
  centerZ: number;
} {
  const { minX, maxX, minZ, maxZ } = bounds;
  return {
    size: Math.max(
      maxX - minX + GRID_MARGIN * 2,
      maxZ - minZ + GRID_MARGIN * 2,
      MIN_SIZE,
    ),
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

/**
 * Ajusta os quatro planos para cobrir o mapa mais a margem.
 *
 * Devolve `true` quando algo mudou — o chamador usa isso para saber se o shadow
 * map precisa ser refeito. Os três planos crescem por `scale`; só o
 * `GridHelper` é recriado, porque o three.js não expõe redimensionamento dele e
 * o número de divisões tem de acompanhar o lado para as linhas continuarem de
 * uma célula.
 */
export function resizeGroundRig(
  rig: GroundRig,
  bounds: MapBounds,
  scene: THREE.Scene,
): boolean {
  const { size, centerX, centerZ } = extentOf(bounds);
  if (
    size === rig.size &&
    Math.abs(centerX - rig.centerX) < 1e-6 &&
    Math.abs(centerZ - rig.centerZ) < 1e-6
  ) {
    return false;
  }

  rig.size = size;
  rig.centerX = centerX;
  rig.centerZ = centerZ;

  const scale = size / BASE_SIZE;
  for (const plane of [rig.pick, rig.floor, rig.catcher]) {
    plane.position.x = centerX;
    plane.position.z = centerZ;
    plane.scale.set(scale, scale, 1);
  }

  scene.remove(rig.grid);
  rig.grid.dispose();
  const grid = makeGrid(size, Math.max(Math.round(size), 2));
  grid.position.set(centerX + 0.5, GRID_Y, centerZ + 0.5);
  scene.add(grid);
  rig.grid = grid;
  return true;
}

/** Remove e libera tudo. A geometria dos planos é compartilhada pelos três. */
export function disposeGroundRig(rig: GroundRig, scene: THREE.Scene): void {
  scene.remove(rig.grid);
  rig.grid.dispose();
  for (const plane of [rig.pick, rig.floor, rig.catcher]) {
    scene.remove(plane);
    (plane.material as THREE.Material).dispose();
  }
  rig.pick.geometry.dispose();
}
