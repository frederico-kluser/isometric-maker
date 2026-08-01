/**
 * Câmera do editor — projeção isométrica com quatro vistas.
 *
 * Módulo PURO: nenhuma dependência do PixiJS nem do DOM, para que a matemática
 * do cursor seja testável com `node --test`. Quem desenha é `scene.ts`.
 *
 * ## O contrato de coordenadas, e por que ele existe em três espaços
 *
 * ```text
 *   armazenada  --rotatePoint-->  de vista  --worldToScreen-->  de mundo (px)
 *                                                    |
 *                                              +pan, ×zoom
 *                                                    v
 *                                              de tela (px do canvas)
 *   armazenada  <--unrotatePoint--  de vista  <--screenToWorld--
 * ```
 *
 * O documento vive SEMPRE em coordenada armazenada. A rotação é parâmetro de
 * vista: girar a câmera não reescreve uma linha do mapa. É por isso que a volta
 * (tela → célula) precisa desrotacionar — converter na direção errada faz o
 * clique acertar a célula só na vista 0 e errar nas outras três.
 */
import {
  rotatePoint,
  unrotatePoint,
  rotatedDepthKey,
  type Rotation,
} from '@isometric-maker/iso-core/rotation';

// ------------------------------------------------------------------ geometria

export interface ProjectGeometry {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly zStep: number;
}

/**
 * Geometria padrão do projeto: dimétrica 2:1 com passo de altura = tileHeight/2
 * (ADR 0013). A razão 2:1 não é gosto — é o que faz o losango costurar sem
 * serrilha e o que a propriedade da diagonal do picking assume.
 */
export const DEFAULT_GEOMETRY: ProjectGeometry = {
  tileWidth: 64,
  tileHeight: 32,
  zStep: 16,
};

export interface Camera {
  readonly rotation: Rotation;
  /** Deslocamento em pixels de TELA (já depois do zoom). */
  readonly panX: number;
  readonly panY: number;
  /** Fator de escala INTEIRO. Fracionário borra pixel art. */
  readonly zoom: number;
}

export const DEFAULT_CAMERA: Camera = { rotation: 0, panX: 0, panY: 0, zoom: 2 };

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface Cell3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ------------------------------------------------------------------ projeção

/** Coordenada de vista → pixel de mundo (antes de pan e zoom). */
export function viewToWorldPx(
  vx: number,
  vy: number,
  z: number,
  geom: ProjectGeometry,
): Point2D {
  return {
    x: (vx - vy) * (geom.tileWidth / 2),
    y: (vx + vy) * (geom.tileHeight / 2) - z * geom.zStep,
  };
}

/**
 * Célula ARMAZENADA → pixel de tela, na vista da câmera.
 *
 * Este é o único caminho de desenho: rotaciona, projeta com a fórmula única,
 * aplica zoom e pan. Não existe variante de projeção por vista.
 */
export function cellToScreen(
  cell: Cell3D,
  camera: Camera,
  geom: ProjectGeometry,
): Point2D {
  const v = rotatePoint(cell.x, cell.y, camera.rotation);
  const p = viewToWorldPx(v.x, v.y, cell.z, geom);
  return { x: p.x * camera.zoom + camera.panX, y: p.y * camera.zoom + camera.panY };
}

/**
 * Pixel de tela → coordenada de VISTA contínua no plano de altura `z`.
 *
 * Inversa exata de {@link viewToWorldPx} mais pan e zoom. O resultado é
 * fracionário de propósito: quem discretiza é {@link screenToCell}, com
 * `Math.floor` — a única regra de arredondamento que preserva a propriedade da
 * diagonal e faz cada ponto pertencer a exatamente uma célula.
 */
export function screenToView(
  sx: number,
  sy: number,
  z: number,
  camera: Camera,
  geom: ProjectGeometry,
): Point2D {
  const wx = (sx - camera.panX) / camera.zoom;
  const wy = (sy - camera.panY) / camera.zoom;
  const a = wx / (geom.tileWidth / 2);
  const b = (wy + z * geom.zStep) / (geom.tileHeight / 2);
  return { x: (b + a) / 2, y: (b - a) / 2 };
}

/**
 * Pixel de tela → célula ARMAZENADA no plano de altura `z`.
 *
 * Discretiza na coordenada de VISTA e só então desrotaciona. A ordem importa:
 * desrotacionar antes de arredondar espalharia o erro de arredondamento pelos
 * dois eixos e a célula sob o cursor saltaria na borda em duas das vistas.
 */
export function screenToCell(
  sx: number,
  sy: number,
  z: number,
  camera: Camera,
  geom: ProjectGeometry,
): Point2D {
  const v = screenToView(sx, sy, z, camera, geom);
  return unrotatePoint(Math.floor(v.x), Math.floor(v.y), camera.rotation);
}

// ------------------------------------------------------------------ ordenação

/** Chave de profundidade da célula na vista atual. Maior = desenha depois. */
export function depthAt(cell: Cell3D, camera: Camera): number {
  return rotatedDepthKey(cell, camera.rotation);
}

// ------------------------------------------------------------------ enquadramento

/**
 * Pan que coloca o centro do conteúdo no centro do viewport.
 *
 * Sem isto o mapa nasce fora da tela em três das quatro vistas: girar muda o
 * sinal de `x−y`, então o mesmo pan que centrava a vista 0 joga o conteúdo para
 * fora nas outras. Recentrar a cada giro é o que faz a rotação parecer um giro
 * e não um teletransporte.
 */
export function centerOn(
  cells: readonly Cell3D[],
  rotation: Rotation,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  geom: ProjectGeometry,
): Camera {
  const base: Camera = { rotation, panX: 0, panY: 0, zoom };
  if (cells.length === 0) {
    return { ...base, panX: viewportWidth / 2, panY: viewportHeight / 2 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    const v = rotatePoint(c.x, c.y, rotation);
    const p = viewToWorldPx(v.x, v.y, c.z, geom);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // O losango é desenhado a partir do canto superior esquerdo do seu bounding
  // box, então o centro visual fica meia largura à direita e meia altura abaixo.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2 + geom.tileHeight / 2;
  return {
    ...base,
    panX: viewportWidth / 2 - cx * zoom,
    panY: viewportHeight / 2 - cy * zoom,
  };
}
