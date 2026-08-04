/**
 * Fábrica de cubos 3D para o editor Three.js.
 *
 * Cria meshes de BoxGeometry com texturas por face a partir dos BlockDefs da
 * paleta. Blocos sem arte gerada caem no cubo procedural — mesma rasterização
 * do iso-core, via canvas 2D →纹理 Three.js.
 *
 * ## Mapeamento de faces
 *
 * O BlockDef tem `faceUrls` com as 4 direções cardinais (north/east/south/west).
 * No Three.js com Y-up e câmera isométrica (45° yaw), as faces visíveis são:
 *   - top (Y+) — topo do cubo
 *   - front (Z+) — visível quando a câmera está ao sul
 *   - right (X+) — visível quando a câmera está a leste
 *
 * A textura "north" do BlockDef (vista norte da câmera antiga) corresponde à
 * face frontal (Z+) no Three.js na rotação 0. Conforme a câmera gira, as
 * texturas são remapeadas.
 *
 * ## Material por face
 *
 * BoxGeometry tem 6 grupos (um por face: +X, -X, +Y, -Y, +Z, -Z). Passamos um
 * array de 6 materiais para Mesh. Cada material pode ter `map` (textura) ou
 * `color` (cor sólida procedural).
 */
import * as THREE from 'three';
import {
  CANONICAL_CUBE,
} from '../../../../../packages/iso-core/src/iso-cube.ts';
import { makeCubeCanvasFromHue, makeCubeViewsFromHue } from './cube-canvas.ts';
import type { BlockDef } from './block-def.ts';
import type { Rotation } from '../../../../../packages/iso-core/src/rotation.ts';

// ------------------------------------------------------------------ constantes

/** Tamanho do cubo em world units. 1 = 1 tile de lado. */
const CUBE_SIZE = 1;

/** BoxGeometry compartilhada — mesma forma para todos os cubos. */
const sharedBox = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);

// ------------------------------------------------------------------ textura procedural

/**
 * Converte um HTMLCanvasElement em textura Three.js.
 *
 * pixel art → nearest filtering, sem mipmaps. O canvas vem do rasterizador
 * do iso-core (`makeCubeCanvasFromHue`), que desenha em pixel art.
 */
function canvasTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Cache de texturas procedurais por matiz. */
const proceduralCache = new Map<string, THREE.Texture[]>();

/**
 * Texturas procedurais para um bloco (4 vistas).
 *
 * Cada vista é um canvas diferente — mesmo tom, grão diferente por direção.
 */
function proceduralTextures(hue: number): THREE.Texture[] {
  const key = `hue:${hue}`;
  const cached = proceduralCache.get(key);
  if (cached) return cached;
  const views = makeCubeViewsFromHue(hue, CANONICAL_CUBE);
  const textures = views.map((c) => canvasTexture(c));
  proceduralCache.set(key, textures);
  return textures;
}

// ------------------------------------------------------------------ mapeamento de faces

/**
 * Índices dos grupos de material no BoxGeometry do Three.js.
 *
 * Ordem do BoxGeometry: +X (right), -X (left), +Y (top), -Y (bottom),
 * +Z (front), -Z (back).
 */
const BOX_GROUP = {
  right: 0,  // +X
  left: 1,   // -X
  top: 2,    // +Y
  bottom: 3, // -Y
  front: 4,  // +Z
  back: 5,   // -Z
} as const;

/**
 * Mapeia as 4 direções cardinais do BlockDef para faces do cubo 3D,
 * dado o rotation da câmera.
 *
 * Na rotação 0 (câmera ao sul):
 *   - "north" (face norte do sprite isométrico) → front (+Z)
 *   - "east" → right (+X)
 *   - "south" → back (-Z)
 *   - "west" → left (-X)
 *
 * Conforme a câmera gira, as faces rodam junto.
 */
const FACE_ORDER: readonly string[] = ['north', 'east', 'south', 'west'];

export function blockFaceToBoxGroup(
  facing: string,
  rotation: Rotation,
): number {
  const baseIdx = FACE_ORDER.indexOf(facing);
  if (baseIdx === -1) return BOX_GROUP.top; // fallback: topo
  // Girar a face: (baseIdx - rotation) mod 4
  const rotated = ((baseIdx - rotation) % 4 + 4) % 4;
  const groupOrder = [BOX_GROUP.front, BOX_GROUP.right, BOX_GROUP.back, BOX_GROUP.left];
  return groupOrder[rotated]!;
}

// ------------------------------------------------------------------ criação de materiais

export interface CubeMaterials {
  readonly materials: readonly THREE.Material[];
  /** true se alguma face tem textura (não é só cor procedural). */
  readonly hasTexture: boolean;
}

const loader = new THREE.TextureLoader();
// pixel art — config antes de carregar
loader.crossOrigin = 'anonymous';

/** Textura em carregamento: URL → promise de THREE.Texture. */
const textureLoads = new Map<string, Promise<THREE.Texture>>();

function loadTexture(url: string): Promise<THREE.Texture> {
  const cached = textureLoads.get(url);
  if (cached) return cached;
  const promise = new Promise<THREE.Texture>((resolve) => {
    loader.load(
      url,
      (tex: THREE.Texture) => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      () => resolve(fallbackColorTexture(210)), // falha → cinza
    );
  });
  textureLoads.set(url, promise);
  return promise;
}

/** Cor de fallback procedural quando a textura falha. */
function fallbackColorTexture(hue: number): THREE.Texture {
  const views = proceduralTextures(hue);
  return views[0]!; // usa a vista 0 como fallback
}

// ------------------------------------------------------------------ extração de faces do sprite

// ------------------------------------------------------------------ materiais com sprite único

/**
 * Materiais com UMA textura (a sprite inteira) nas 3 faces visíveis.
 *
 * A mesma sprite isométrica cobre as faces +X (direita), +Z (frente) e +Y
 * (topo). As faces ocultas (−X, −Z, −Y) recebem cor sólida. O cubo não gira
 * — só a câmera orbita.
 */
function materialsWithSingleSprite(
  tex: THREE.Texture,
  hue: number,
): CubeMaterials {
  const hiddenColor = new THREE.Color().setHSL(hue / 360, 0.45, 0.34);
  const bottomColor = new THREE.Color().setHSL(hue / 360, 0.45, 0.22);

  const spriteMat = new THREE.MeshLambertMaterial({ map: tex });
  const hidden = new THREE.MeshLambertMaterial({ color: hiddenColor });
  const bottomMat = new THREE.MeshLambertMaterial({ color: bottomColor });

  // [0]=+X, [1]=-X, [2]=+Y, [3]=-Y, [4]=+Z, [5]=-Z
  const mats: THREE.Material[] = [
    spriteMat, // +X  (right) — sprite inteira
    hidden,    // −X  (left)  — oculta
    spriteMat, // +Y  (top)   — sprite inteira
    bottomMat, // −Y  (bottom)
    spriteMat, // +Z  (front) — sprite inteira
    hidden,    // −Z  (back)  — oculta
  ];

  return { materials: mats, hasTexture: true };
}

/**

/**
 * Cria os 6 materiais para um cubo a partir de um BlockDef.
 *
 * Estratégia:
 * 1. Se tem `faceUrls` (v2: 4 faces), carrega o sprite "north" como UMA
 *    textura única e aplica a mesma sprite nas 3 faces visíveis (+X, +Z, +Y)
 * 2. Se tem `spritesheetUrl` (v3: textura animada), usa o primeiro frame em
 *    todas as faces laterais
 * 3. Se não tem arte, usa cor procedural com matiz
 */
export async function createCubeMaterials(
  block: BlockDef,
): Promise<CubeMaterials> {
  // Face URLs (v2: 4 faces por direção) — sprite único nas 3 faces visíveis
  if (block.faceUrls) {
    try {
      const tex = await loadTexture(block.faceUrls.north);
      return materialsWithSingleSprite(tex, block.hue ?? 210);
    } catch {
      // fallthrough → procedural se o carregamento falhar
    }
  }

  // v3: textura (animada ou estática)
  const staticUrl =
    block.baseUrl ??
    (block.hash ? `/world-blocks/${block.hash}/base.png` : undefined);
  if (staticUrl) {
    try {
      const tex = await loadTexture(staticUrl);
      return materialsWithSingleTexture(tex, block.hue ?? 210);
    } catch {
      // fallthrough → procedural
    }
  } else if (block.spritesheetUrl) {
    try {
      const tex = await loadTexture(block.spritesheetUrl);
      return materialsWithSingleTexture(tex, block.hue ?? 210);
    } catch {
      // fallthrough → procedural
    }
  }

  // Fallback procedural
  return materialsProcedural(block.hue ?? 210);
}

/**
 * Materiais com uma única textura nas faces laterais.
 */
function materialsWithSingleTexture(
  tex: THREE.Texture,
  hue: number,
): CubeMaterials {
  const topColor = new THREE.Color().setHSL(hue / 360, 0.45, 0.62);
  const sideMat = new THREE.MeshLambertMaterial({ map: tex });
  const mats: THREE.Material[] = [
    sideMat,  // right (+X)
    sideMat,  // left (-X)
    new THREE.MeshLambertMaterial({ color: topColor }),  // top (+Y)
    new THREE.MeshLambertMaterial({ color: topColor }),  // bottom (-Y)
    sideMat,  // front (+Z)
    sideMat,  // back (-Z)
  ];
  return { materials: mats, hasTexture: true };
}

/**
 * Materiais puramente procedurais (cor sólida, sem textura).
 *
 * Topo mais claro, laterais mais escuras — mesma hierarquia de luminosidade
 * da pixel art isométrica.
 */
function materialsProcedural(hue: number): CubeMaterials {
  const topColor = new THREE.Color().setHSL(hue / 360, 0.45, 0.62);
  const sideColor = new THREE.Color().setHSL(hue / 360, 0.45, 0.47);
  const darkColor = new THREE.Color().setHSL(hue / 360, 0.45, 0.34);

  const mats: THREE.Material[] = [
    new THREE.MeshLambertMaterial({ color: sideColor }),  // right (+X)
    new THREE.MeshLambertMaterial({ color: darkColor }),   // left (-X)
    new THREE.MeshLambertMaterial({ color: topColor }),     // top (+Y)
    new THREE.MeshLambertMaterial({ color: topColor }),     // bottom (-Y)
    new THREE.MeshLambertMaterial({ color: sideColor }),    // front (+Z)
    new THREE.MeshLambertMaterial({ color: darkColor }),    // back (-Z)
  ];
  return { materials: mats, hasTexture: false };
}

// ------------------------------------------------------------------ criação de mesh

/**
 * Cria um mesh de cubo com os materiais dados.
 *
 * A geometria é compartilhada (BoxGeometry(1,1,1)) — cada mesh tem seus
 * próprios materiais.
 */
export function createCubeMesh(mats: CubeMaterials): THREE.Mesh {
  const mesh = new THREE.Mesh(sharedBox, mats.materials as THREE.Material[]);
  // Projeta sombra nos blocos abaixo/ao lado e recebe a sombra dos blocos
  // acima — sem receiveShadow um cubo sob outro não escurece (R8).
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ cubo de preview

let previewBox: THREE.BoxGeometry | null = null;

/**
 * Cubo de preview semitransparente.
 *
 * Azul para colocação, vermelho para remoção. Geometria levemente maior
 * para evitar z-fighting com o cubo existente.
 */
export function createPreviewMesh(invalid: boolean): THREE.Mesh {
  if (!previewBox) {
    previewBox = new THREE.BoxGeometry(1.01, 1.01, 1.01);
  }
  const color = invalid ? 0xef4444 : 0x3b82f6;
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.4,
    depthTest: true,
    depthWrite: false,
  });
  return new THREE.Mesh(previewBox, mat);
}

// ------------------------------------------------------------------ highlight

let highlightBox: THREE.BoxGeometry | null = null;

/**
 * Contorno de seleção (edge highlight).
 */
export function createHighlightMesh(): THREE.LineSegments {
  if (!highlightBox) {
    highlightBox = new THREE.BoxGeometry(1.02, 1.02, 1.02);
  }
  const edges = new THREE.EdgesGeometry(highlightBox);
  const mat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.9,
    depthTest: true,
  });
  return new THREE.LineSegments(edges, mat);
}

// ------------------------------------------------------------------ limpeza

/**
 * Descarta todos os caches de textura. Chamar ao destruir a cena.
 */
export function disposeCubeCache(): void {
  for (const tex of proceduralCache.values()) {
    for (const t of tex) t.dispose();
  }
  proceduralCache.clear();
  textureLoads.clear();
  sharedBox.dispose();
  if (previewBox) {
    previewBox.dispose();
    previewBox = null;
  }
  if (highlightBox) {
    highlightBox.dispose();
    highlightBox = null;
  }
}
