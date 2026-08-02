/**
 * Grid do chão e plano de raycasting para o editor 3D.
 *
 * Dois elementos:
 * 1. GridHelper — malha visual no plano Y=0 para orientação
 * 2. Plano invisível para raycasting — captura cliques no espaço vazio
 *
 * O grid é redesenhado conforme o mapa cresce, para que sempre haja
 * superfície de clique ao redor do conteúdo.
 */
import * as THREE from 'three';

// ------------------------------------------------------------------ grid visual

/**
 * Cria um grid no plano XZ (chão).
 *
 * O GridHelper padrão do Three.js desenha no plano XZ (normal Y).
 * Centralizado na origem, com `size` células de lado.
 */
export function createGrid(size: number, divisions: number): THREE.GridHelper {
  const grid = new THREE.GridHelper(size, divisions, 0x94a3b8, 0x334155);
  grid.position.set(0.5, 0.001, 0.5); // meio-cubo: linhas nas arestas, não nos centros
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  grid.material.depthTest = true;
  grid.material.depthWrite = false;
  grid.renderOrder = 0;
  return grid;
}

/**
 * Atualiza o grid para cobrir pelo menos a área ocupada + margem.
 *
 * Recria o GridHelper — o Three.js não expõe redimensionamento.
 */
export function resizeGrid(
  grid: THREE.GridHelper,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  margin: number,
  scene: THREE.Scene,
): THREE.GridHelper {
  const size = Math.max(
    maxX - minX + margin * 2,
    maxZ - minZ + margin * 2,
    10, // mínimo
  );
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  if (
    Math.abs(grid.position.x - (centerX + 0.5)) < 0.1 &&
    Math.abs(grid.position.z - (centerZ + 0.5)) < 0.1 &&
    Math.abs(grid.scale.x - size / 10) < 0.1
  ) {
    return grid; // não mudou
  }

  scene.remove(grid);
  grid.dispose();

  const divisions = Math.max(Math.round(size), 10);
  const newGrid = new THREE.GridHelper(size, divisions, 0x94a3b8, 0x334155);
  newGrid.material.transparent = true;
  newGrid.material.opacity = 0.35;
  newGrid.material.depthTest = true;
  newGrid.material.depthWrite = false;
  newGrid.renderOrder = 0;
  newGrid.position.set(centerX + 0.5, 0.001, centerZ + 0.5); // leve offset para evitar z-fight; +0.5 põe linhas nas arestas
  scene.add(newGrid);
  return newGrid;
}

// ------------------------------------------------------------------ plano de raycasting

/**
 * Plano invisível no chão (Y=0) para capturar cliques no vazio.
 *
 * Sem este plano, clicar onde não há cubo não produz hit nenhum,
 * e o editor não sabe onde colocar o primeiro bloco.
 */
export function createGroundPlane(size: number): THREE.Mesh {
  const geom = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshBasicMaterial({
    visible: false, // invisível mas raycastable
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(geom, mat);
  plane.rotation.x = -Math.PI / 2; // plano XZ
  plane.position.y = -0.01; // levemente abaixo do chão
  plane.name = 'ground-plane';
  plane.renderOrder = -1;
  return plane;
}

/**
 * Expande o plano de chão para cobrir a área do mapa.
 */
export function resizeGroundPlane(
  plane: THREE.Mesh,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  margin: number,
): void {
  const size = Math.max(
    maxX - minX + margin * 2,
    maxZ - minZ + margin * 2,
    20,
  );
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  plane.position.x = centerX;
  plane.position.z = centerZ;
  plane.scale.set(size / 10, size / 10, 1);
}
