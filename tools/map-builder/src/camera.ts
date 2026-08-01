/**
 * Câmera do editor — projeção isométrica com quatro vistas e giro suave.
 *
 * Módulo PURO: nenhuma dependência do PixiJS nem do DOM, para que a matemática
 * do cursor seja testável com `node --test`. Quem desenha é `scene.ts`.
 *
 * ## O contrato de coordenadas, e por que ele existe em três espaços
 *
 * ```text
 *   armazenada  --rotatePoint-->  de vista  --viewToWorldPx-->  de mundo (px)
 *                                                    |
 *                                              +pan, ×zoom
 *                                                    v
 *                                              de tela (px do canvas)
 *   armazenada  <--unrotatePoint--  de vista  <--screenToView--
 * ```
 *
 * O documento vive SEMPRE em coordenada armazenada. A rotação é parâmetro de
 * vista: girar a câmera não reescreve uma linha do mapa. É por isso que a volta
 * (tela → célula) precisa desrotacionar — converter na direção errada faz o
 * clique acertar a célula só na vista 0 e errar nas outras três.
 *
 * ## A rotação tem DOIS valores, e só um deles conta para o cursor
 *
 * `rotation` é a vista atual, discreta, e é a única que o picking usa: durante
 * um giro o cursor está desligado de qualquer jeito. `turn` é a rotação
 * contínua do desenho, que passa por 0,5 e 1,5 enquanto o mapa balança. Separar
 * os dois é o que permite girar suave sem que o clique caia numa célula
 * fracionária que não existe.
 */
import {
  rotatePoint,
  unrotatePoint,
  rotatedDepthKey,
  type Rotation,
} from '@isometric-maker/iso-core/rotation';
import {
  continuousDepthKey,
  rotatePointContinuous,
} from '@isometric-maker/iso-core/rotation-tween';
import { CANONICAL_CUBE } from '@isometric-maker/iso-core/iso-cube';

// ------------------------------------------------------------------ geometria

export interface ProjectGeometry {
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Altura de um nível de z, em px. É a ARESTA VERTICAL do cubo. */
  readonly zStep: number;
}

/**
 * Geometria padrão: a canônica de `iso-cube.ts`, sem um número copiado.
 *
 * Era `64 / 32 / 16`. O `16` estava errado por um fator de 2,45: a aresta de um
 * cubo em 2:1 é `W·√6/4`, que para `W = 64` dá 39. Com 16 o "cubo" tinha 41 %
 * da altura certa — e blocos empilhados se enterravam uns nos outros porque o
 * passo de altura não batia com a altura desenhada.
 */
export const DEFAULT_GEOMETRY: ProjectGeometry = {
  tileWidth: CANONICAL_CUBE.tileWidth,
  tileHeight: CANONICAL_CUBE.tileHeight,
  zStep: CANONICAL_CUBE.cubeHeight,
};

export interface Camera {
  /** Vista atual, discreta. É a que o picking usa. */
  readonly rotation: Rotation;
  /**
   * Rotação CONTÍNUA do desenho, em quartos de volta. Igual a `rotation`
   * quando parada; fracionária durante o giro.
   */
  readonly turn: number;
  /** Deslocamento em pixels de TELA (já depois do zoom). */
  readonly panX: number;
  readonly panY: number;
  /** Fator de escala INTEIRO. Fracionário borra pixel art. */
  readonly zoom: number;
}

export const DEFAULT_CAMERA: Camera = {
  rotation: 0,
  turn: 0,
  panX: 0,
  panY: 0,
  zoom: 2,
};

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
 * Célula ARMAZENADA → pixel de tela, na rotação contínua da câmera.
 *
 * Este é o único caminho de desenho: rotaciona (por um ângulo que pode ser
 * fracionário), projeta com a fórmula única, aplica zoom e pan. Não existe
 * variante de projeção por vista, nem um caminho separado para "parado" e
 * outro para "girando".
 *
 * O ponto devolvido é o **vértice superior do losango do topo** da célula — não
 * o canto do sprite e não o centro do losango. É a armadilha clássica da
 * isometria: a fórmula de projeção sozinha nunca diz onde ancorar o sprite, e
 * quem assume "canto superior esquerdo" desloca o mapa inteiro.
 */
export function cellToScreen(
  cell: Cell3D,
  camera: Camera,
  geom: ProjectGeometry,
): Point2D {
  const v = rotatePointContinuous(cell.x, cell.y, camera.turn);
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
 *
 * Usa `rotation` (discreta), nunca `turn`: durante um giro não existe célula
 * sob o cursor, e inventar uma daria uma peça colocada em lugar aleatório.
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

/**
 * Chave de profundidade da célula na rotação atual. Maior = desenha depois.
 *
 * Contínua durante o giro: dois blocos realmente trocam de profundidade quando
 * a câmera passa de uma vista para outra, e a chave contínua faz a troca
 * acontecer no instante geometricamente certo em vez de tudo de uma vez no
 * começo ou no fim.
 */
export function depthAt(cell: Cell3D, camera: Camera): number {
  return Number.isInteger(camera.turn)
    ? rotatedDepthKey(cell, ((camera.turn % 4) + 4) % 4 as Rotation)
    : continuousDepthKey(cell, camera.turn);
}

// ------------------------------------------------------------------ enquadramento

/**
 * Pan que coloca o centro do conteúdo no centro do viewport.
 *
 * Sem isto o mapa nasce fora da tela em três das quatro vistas: girar muda o
 * sinal de `x−y`, então o mesmo pan que centrava a vista 0 joga o conteúdo para
 * fora nas outras. Recentrar A CADA QUADRO do giro é o que faz a rotação
 * parecer um giro em torno do centro, e não uma peça deslizando para fora.
 */
export function centerOn(
  cells: readonly Cell3D[],
  turn: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  geom: ProjectGeometry,
): { panX: number; panY: number } {
  if (cells.length === 0) {
    return { panX: viewportWidth / 2, panY: viewportHeight / 2 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    const v = rotatePointContinuous(c.x, c.y, turn);
    const p = viewToWorldPx(v.x, v.y, c.z, geom);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // O sprite é desenhado a partir do vértice SUPERIOR do losango, então o
  // centro visual do conteúdo fica meia altura de losango abaixo do centro dos
  // pontos projetados.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2 + geom.tileHeight / 2;
  return {
    panX: viewportWidth / 2 - cx * zoom,
    panY: viewportHeight / 2 - cy * zoom,
  };
}

/** Câmera reenquadrada numa rotação discreta — o caso parado. */
export function framedCamera(
  cells: readonly Cell3D[],
  rotation: Rotation,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  geom: ProjectGeometry,
): Camera {
  const pan = centerOn(cells, rotation, viewportWidth, viewportHeight, zoom, geom);
  return { rotation, turn: rotation, zoom, ...pan };
}

/** Ida e volta pela rotação discreta — usada só onde `turn` não importa. */
export function viewCell(cell: Cell3D, rotation: Rotation): Cell3D {
  const r = rotatePoint(cell.x, cell.y, rotation);
  return { x: r.x, y: r.y, z: cell.z };
}
