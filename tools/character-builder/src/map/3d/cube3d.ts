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
  type IsoCubeGeometry,
} from '../../../../../packages/iso-core/src/iso-cube.ts';
import { makeCubeCanvasFromHue, makeCubeViewsFromHue } from './cube-canvas.ts';
import type { BlockDef } from './block-def.ts';
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
 * RECORTA as 3 faces visíveis de um sprite isométrico em texturas retangulares,
 * SEM de-warp — cada face é um retângulo do sprite copiado 1:1, na posição e
 * orientação originais, sem reamostragem.
 *
 * O sprite (ex.: `faceUrls.north`, 48×53 para o CANONICAL_CUBE) já mostra o
 * cubo inteiro em projeção 2:1: o topo é um losango W×H no alto e as laterais
 * são paralelogramos de `cubeHeight` linhas. As três regiões são recortadas
 * direto do sprite:
 *
 *   - **Topo**: o bounding box do losango — W colunas × H linhas (as primeiras
 *     `tileHeight` linhas do sprite, largura cheia).
 *   - **Direita**: a metade direita do sprite abaixo do topo — colunas
 *     W/2..W−1, linhas `tileHeight`..fim (a face SE do cubo).
 *   - **Esquerda**: a metade esquerda abaixo do topo — colunas 0..W/2−1,
 *     linhas `tileHeight`..fim (a face SW do cubo).
 *
 * As texturas ficam retangulares; o mapeamento UV do BoxGeometry estica cada
 * uma para a face quadrada correspondente, sem transformação de pixels na
 * origem. A amostragem é nearest-neighbor (pixel art, `imageSmoothingEnabled =
 * false`). Os pixels transparentes (margens do losango, cantos, áreas fora da
 * silhueta) são preenchidos com a cor da face — a mesma do cubo procedural —
 * porque o MeshLambertMaterial com `transparent: false` (default) renderizaria
 * transparência como preto opaco.
 */
function cropFaces(
  sourceImage: HTMLImageElement,
  geom: IsoCubeGeometry,
  hue: number,
): { top: HTMLCanvasElement; left: HTMLCanvasElement; right: HTMLCanvasElement } {
  const { spriteHeight: h, tileWidth, tileHeight } = geom;
  const half = tileWidth / 2;

  // Cores de preenchimento — as mesmas das faces procedurais (cube-raster.ts):
  // topo mais claro (0.62), laterais mais escuras (0.47), saturação 0.45.
  const topFill = `hsl(${hue} 45% 62%)`;
  const sideFill = `hsl(${hue} 45% 47%)`;

  /**
   * Copia o retângulo (x, y, cw×ch) do sprite para um canvas novo, 1:1,
   * preenchendo antes o fundo com a cor da face.
   */
  function cropRect(
    x: number,
    y: number,
    cw: number,
    ch: number,
    fill: string,
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d indisponível para recorte de face');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(sourceImage, x, y, cw, ch, 0, 0, cw, ch);
    return canvas;
  }

  // O topo ocupa as primeiras `tileHeight` linhas do sprite; as laterais ficam
  // ABAIXO dele. Recortar das linhas iniciais incluiria a metade do losango do
  // topo na parede.
  const top = cropRect(0, 0, tileWidth, tileHeight, topFill);
  const right = cropRect(half, tileHeight, half, h - tileHeight, sideFill);
  const left = cropRect(0, tileHeight, half, h - tileHeight, sideFill);

  return { top, left, right };
}

/**
 * Extrai as faces de uma URL de sprite e devolve 3 texturas.
 * Devolve null se a imagem não carregar.
 */
async function extractFacesFromUrl(
  url: string,
  geom: IsoCubeGeometry,
  hue: number,
): Promise<{ top: THREE.Texture; left: THREE.Texture; right: THREE.Texture } | null> {
  const img = await loadImage(url);
  if (!img) return null;
  try {
    const faces = cropFaces(img, geom, hue);
    // canvasTexture para todas as texturas recortadas: nearest, sem mipmaps, sRGB.
    return {
      top: canvasTexture(faces.top),
      left: canvasTexture(faces.left),
      right: canvasTexture(faces.right),
    };
  } catch {
    return null; // fallthrough → procedural se o crop falhar
  }
}

// ------------------------------------------------------------------ mapeamento de faces extraídas para BoxGeometry

/**
 * Cria os 6 materiais a partir das 3 faces recortadas de UM sprite.
 *
 * O sprite "north" é a vista sul do cubo (ADR 0029: "north → south é fixo"),
 * desenhada na projeção 2:1: a metade direita do sprite é a face SE do cubo
 * e a metade esquerda é a face SW. No Three.js, o eixo x do mapa vira +X e o
 * eixo y do mapa vira +Z (`scene3d.ts`), e a câmera na rotação 0 está ao sul
 * (posição +X, +Z) — vê exatamente as faces +X (à direita) e +Z (à esquerda).
 * Logo:
 *
 *   sprite 'right' (face SE) → BoxGeometry +X (índice 0)
 *   sprite 'left'  (face SW) → BoxGeometry +Z (índice 4)
 *   sprite 'top'   (topo)    → BoxGeometry +Y (índice 2)
 *
 * O cubo do mapa NÃO gira — só a câmera orbita (`setCameraRotation`), e o
 * `createCubeMaterials` usa sempre o sprite "north". Por isso as texturas
 * ficam PRESAS a essas três faces para qualquer rotação, e as faces −X, −Z e
 * −Y (sem arte neste sprite) recebem cor sólida. A remapeação por rotação que
 * existia aqui trocava as texturas como se o MESH girasse com a câmera — como
 * o mesh é estático, ela punha a arte na face errada (ex.: a arte SW na face
 * +X visível na rotação 0, e a face +Z visível sem arte).
 *
 * O parâmetro `rotation` permanece por compatibilidade de assinatura.
 */
function materialsFromExtractedFaces(
  faces: { top: THREE.Texture; left: THREE.Texture; right: THREE.Texture },
  rotation: Rotation,
  hue: number,
): CubeMaterials {
  void rotation; // o cubo não gira — as texturas são fixas às faces

  const hiddenColor = new THREE.Color().setHSL(hue / 360, 0.45, 0.34);
  const bottomColor = new THREE.Color().setHSL(hue / 360, 0.45, 0.22);

  const hidden = new THREE.MeshLambertMaterial({ color: hiddenColor });
  const topMat = new THREE.MeshLambertMaterial({ map: faces.top });
  const rightMat = new THREE.MeshLambertMaterial({ map: faces.right });
  const leftMat = new THREE.MeshLambertMaterial({ map: faces.left });
  const bottomMat = new THREE.MeshLambertMaterial({ color: bottomColor });

  // [0]=+X, [1]=-X, [2]=+Y, [3]=-Y, [4]=+Z, [5]=-Z
  const mats: THREE.Material[] = [
    rightMat,  // +X  (right) — face SE do sprite, à direita na vista sul
    hidden,    // −X  (left)  — sem arte no sprite "north"
    topMat,    // +Y  (top)   — losango do topo
    bottomMat, // −Y  (bottom)
    leftMat,   // +Z  (front) — face SW do sprite, à esquerda na vista sul
    hidden,    // −Z  (back)  — sem arte no sprite "north"
  ];

  return { materials: mats, hasTexture: true };
}

/**
 * Cria os 6 materiais para um cubo a partir de um BlockDef.
 *
 * Estratégia:
 * 1. Se tem `faceUrls` (v2: 4 faces), recorta as 3 faces do sprite e mapeia
 * 2. Se tem `spritesheetUrl` (v3: textura animada), usa o primeiro frame em
 *    todas as faces laterais
 * 3. Se não tem arte, usa cor procedural com matiz
 */
export async function createCubeMaterials(
  block: BlockDef,
): Promise<CubeMaterials> {
  // Face URLs (v2: 4 faces por direção) — recorta topo/esquerda/direita do sprite
  if (block.faceUrls) {
    // Usa o sprite "north" (vista sul, ADR 0029). As 3 faces dele ficam
    // presas às faces +X/+Z/+Y do cubo; girar a câmera mostra outras faces
    // do mesmo cubo, sem trocar os materiais (ver materialsFromExtractedFaces).
    const faces = await extractFacesFromUrl(block.faceUrls.north, CANONICAL_CUBE, block.hue ?? 210);
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
