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
  faceAtPixel,
  type IsoCubeGeometry,
} from '../../../../../packages/iso-core/src/iso-cube.ts';
import { makeCubeCanvasFromHue, makeCubeViewsFromHue } from '../cube.ts';
import type { BlockDef } from '../scene.ts';
import type { Rotation } from '../../../../../packages/iso-core/src/rotation.ts';
import { rotateDirectionIndex } from '../../../../../packages/iso-core/src/rotation.ts';

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

/**
 * Carrega uma imagem a partir de URL. Devolve null em falha.
 */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Extrai as 3 faces visíveis de um sprite isométrico.
 *
 * Usa `faceAtPixel` do iso-core para classificar cada pixel como topo,
 * esquerda ou direita. Cada face vai para um canvas separado — pixels
 * que não pertencem à face ficam transparentes.
 *
 * O fundo transparente do sprite original é preservado.
 */
function extractFaceRegions(
  sourceImage: HTMLImageElement,
  geom: IsoCubeGeometry,
): { top: HTMLCanvasElement; left: HTMLCanvasElement; right: HTMLCanvasElement } | null {
  const { spriteWidth: w, spriteHeight: h } = geom;

  // Desenha a fonte num canvas para ler pixels
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = w;
  srcCanvas.height = h;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) return null;
  srcCtx.imageSmoothingEnabled = false;
  srcCtx.drawImage(sourceImage, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, w, h);

  // Canvas de saída — mesmo tamanho do sprite, pixels posicionados igual
  function makeFaceCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; data: ImageData } {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const data = ctx.createImageData(w, h);
    return { canvas, ctx, data };
  }

  const top = makeFaceCanvas();
  const left = makeFaceCanvas();
  const right = makeFaceCanvas();

  // Classifica cada pixel e copia para a face correspondente
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const face = faceAtPixel(x, y, geom);
      if (face === null) continue; // pixel fora da silhueta

      const si = (y * w + x) * 4;
      const r = srcData.data[si]!;
      const g = srcData.data[si + 1]!;
      const b = srcData.data[si + 2]!;
      const a = srcData.data[si + 3]!;

      let dst: ImageData;
      if (face === 'top') dst = top.data;
      else if (face === 'left') dst = left.data;
      else dst = right.data; // 'right'

      dst.data[si] = r;
      dst.data[si + 1] = g;
      dst.data[si + 2] = b;
      dst.data[si + 3] = a;
    }
  }

  top.ctx.putImageData(top.data, 0, 0);
  left.ctx.putImageData(left.data, 0, 0);
  right.ctx.putImageData(right.data, 0, 0);

  return { top: top.canvas, left: left.canvas, right: right.canvas };
}

/**
 * Extrai as faces de uma URL de sprite e devolve 3 texturas.
 * Devolve null se a imagem não carregar.
 */
async function extractFacesFromUrl(
  url: string,
  geom: IsoCubeGeometry,
): Promise<{ top: THREE.Texture; left: THREE.Texture; right: THREE.Texture } | null> {
  const img = await loadImage(url);
  if (!img) return null;
  const faces = extractFaceRegions(img, geom);
  if (!faces) return null;
  return {
    top: canvasTexture(faces.top),
    left: canvasTexture(faces.left),
    right: canvasTexture(faces.right),
  };
}

// ------------------------------------------------------------------ mapeamento de faces extraídas para BoxGeometry

/**
 * Cria os 6 materiais a partir das 3 faces extraídas de UM sprite.
 *
 * O sprite mostra o cubo de um ângulo (ex: norte). As faces "right" e "left"
 * do sprite correspondem a faces físicas diferentes do cubo conforme a
 * câmera gira. Esta função recebe a rotação e remapeia as texturas.
 *
 * Mapeamento por rotação:
 *
 *   Rot 0 (sul):  top→+Y,  right→+X (leste),  left→-Z (norte)
 *   Rot 1 (leste): top→+Y,  right→+Z (sul),   left→+X (leste)
 *   Rot 2 (norte): top→+Y,  right→-X (oeste), left→+Z (sul)
 *   Rot 3 (oeste): top→+Y,  right→-Z (norte), left→-X (oeste)
 *
 * As 3 faces restantes (-Y, e as duas não visíveis no sprite) recebem cor sólida.
 */
function materialsFromExtractedFaces(
  faces: { top: THREE.Texture; left: THREE.Texture; right: THREE.Texture },
  rotation: Rotation,
  hue: number,
): CubeMaterials {
  const hiddenColor = new THREE.Color().setHSL(hue / 360, 0.45, 0.34);
  const bottomColor = new THREE.Color().setHSL(hue / 360, 0.45, 0.22);

  const hidden = new THREE.MeshLambertMaterial({ color: hiddenColor });
  const topMat = new THREE.MeshLambertMaterial({ map: faces.top });
  const rightMat = new THREE.MeshLambertMaterial({ map: faces.right });
  const leftMat = new THREE.MeshLambertMaterial({ map: faces.left });
  const bottomMat = new THREE.MeshLambertMaterial({ color: bottomColor });

  // Para cada rotação, as faces "right" e "left" do sprite mapeiam para
  // faces físicas diferentes do cubo.
  // [0]=+X, [1]=-X, [2]=+Y, [3]=-Y, [4]=+Z, [5]=-Z
  const mats: THREE.Material[] = Array.from({ length: 6 });

  mats[BOX_GROUP.top] = topMat;
  mats[BOX_GROUP.bottom] = bottomMat;

  switch (rotation) {
    case 0: // sul: right→+X, left→-Z
      mats[BOX_GROUP.right] = rightMat;
      mats[BOX_GROUP.left] = hidden;
      mats[BOX_GROUP.front] = hidden;
      mats[BOX_GROUP.back] = leftMat;
      break;
    case 1: // leste: right→+Z, left→+X
      mats[BOX_GROUP.right] = leftMat;
      mats[BOX_GROUP.left] = hidden;
      mats[BOX_GROUP.front] = rightMat;
      mats[BOX_GROUP.back] = hidden;
      break;
    case 2: // norte: right→-X, left→+Z
      mats[BOX_GROUP.right] = hidden;
      mats[BOX_GROUP.left] = rightMat;
      mats[BOX_GROUP.front] = leftMat;
      mats[BOX_GROUP.back] = hidden;
      break;
    case 3: // oeste: right→-Z, left→-X
      mats[BOX_GROUP.right] = hidden;
      mats[BOX_GROUP.left] = leftMat;
      mats[BOX_GROUP.front] = hidden;
      mats[BOX_GROUP.back] = rightMat;
      break;
  }

  // Preenche os slots que ficaram undefined
  for (let i = 0; i < 6; i++) {
    if (!mats[i]) mats[i] = hidden;
  }

  return { materials: mats, hasTexture: true };
}

/**
 * Cria os 6 materiais para um cubo a partir de um BlockDef.
 *
 * Estratégia:
 * 1. Se tem `faceUrls` (v2: 4 faces), extrai as 3 faces do sprite e mapeia
 * 2. Se tem `spritesheetUrl` (v3: textura animada), usa o primeiro frame em
 *    todas as faces laterais
 * 3. Se não tem arte, usa cor procedural com matiz
 */
export async function createCubeMaterials(
  block: BlockDef,
): Promise<CubeMaterials> {
  // Face URLs (v2: 4 faces por direção) — extrai topo/esquerda/direita do sprite
  if (block.faceUrls) {
    // Usa o sprite "north" como base. Conforme a câmera gira, usamos
    // sprites diferentes (north→0, east→1, south→2, west→3).
    // Para já, extraímos do north. O remapeamento por rotação é feito
    // no scene3d.ts trocando os materiais.
    const faces = await extractFacesFromUrl(block.faceUrls.north, CANONICAL_CUBE);
    if (faces) {
      return materialsFromExtractedFaces(faces, 0, block.hue ?? 210);
    }
    // fallthrough → procedural se extração falhar
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
  mesh.castShadow = false;
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
