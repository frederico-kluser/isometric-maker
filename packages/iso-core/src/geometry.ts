import type { ProjectGeometry } from './project.ts';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Coordenada de ecrã (píxeis), origem no canto superior esquerdo. */
export interface ScreenPoint {
  readonly sx: number;
  readonly sy: number;
}

/** Coordenada de mundo (grid contínuo, não arredondado). */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** Coordenada de célula (grid discreto, arredondado com a regra de piso). */
export interface CellPoint {
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------
// Validação da geometria
// ---------------------------------------------------------------------------

/**
 * A projecção dimétrica 2:1 exige que a altura do losango seja exactamente
 * metade da largura.  Qualquer outra razão produz serrilha e invalida a
 * propriedade de costura do diamante.
 */
function validateGeometry(geom: ProjectGeometry): void {
  if (geom.tileWidth <= 0 || geom.tileHeight <= 0 || geom.zStep <= 0) {
    throw new Error(
      `Geometria inválida: tileWidth (${geom.tileWidth}), ` +
        `tileHeight (${geom.tileHeight}) e zStep (${geom.zStep}) ` +
        `devem ser estritamente positivos.`,
    );
  }
  if (geom.tileHeight !== geom.tileWidth / 2) {
    throw new Error(
      `Geometria inválida: tileHeight (${geom.tileHeight}) deve ser ` +
        `exactamente tileWidth / 2 (${geom.tileWidth / 2}) ` +
        `(tileWidth=${geom.tileWidth}). ` +
        `A projecção dimétrica 2:1 exige esta razão.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Pré-cálculo dos meio-eixos
// ---------------------------------------------------------------------------

interface HalfAxes {
  readonly halfW: number;
  readonly halfH: number;
}

function halfAxes(geom: ProjectGeometry): HalfAxes {
  validateGeometry(geom);
  return {
    halfW: geom.tileWidth / 2,
    halfH: geom.tileHeight / 2,
  };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Converte coordenadas de mundo (grid contínuo) para ecrã (píxeis).
 *
 * A projecção é dimétrica 2:1:
 *   - +1 em x  →  (+halfW, +halfH) no ecrã
 *   - +1 em y  →  (-halfW, +halfH) no ecrã
 *   - +1 em z  →  (0, -zStep) no ecrã
 *
 * Com coordenadas de mundo inteiras e geometria válida, o resultado são
 * números inteiros exactos.
 */
export function worldToScreen(
  x: number,
  y: number,
  z: number,
  geom: ProjectGeometry,
): ScreenPoint {
  const { halfW, halfH } = halfAxes(geom);
  return {
    sx: (x - y) * halfW,
    sy: (x + y) * halfH - z * geom.zStep,
  };
}

/**
 * Converte coordenadas de ecrã (píxeis) para mundo (grid contínuo).
 *
 * Esta função é a inversa exacta de {@link worldToScreen} e devolve
 * coordenadas fraccionárias.  O valor devolvido representa a posição
 * **exacta** no grid contínuo — não a célula discreta.
 *
 * ## Regra de arredondamento (onde a célula começa)
 *
 * Para obter a célula discreta a que um ponto do ecrã pertence, aplica-se
 * `Math.floor` a ambas as componentes do resultado:
 *
 * ```ts
 * const w = screenToWorld(sx, sy, z, geom);
 * const cell = { x: Math.floor(w.x), y: Math.floor(w.y) };
 * ```
 *
 * Isto implica que **um ponto exactamente na aresta entre duas células
 * pertence à célula de menores coordenadas** (a que está mais próxima da
 * origem do grid).  `Math.floor` é a única função de arredondamento que
 * preserva a propriedade da diagonal (ver abaixo) e garante que cada ponto
 * do ecrã pertence a exactamente uma célula.
 *
 * ## Propriedade da diagonal
 *
 * Para qualquer ponto de ecrã `(sx, sy)`:
 *
 * ```
 * screenToWorld(sx, sy, z + 1, geom)
 *   ≡ screenToWorld(sx, sy, z, geom) + (zStep/tileHeight, zStep/tileHeight)
 * ```
 *
 * Com a geometria padrão (tileHeight = tileWidth/2, zStep = tileHeight/2)
 * isto é `+(0.5, 0.5)` por nível de Z.  O raio da câmara em espaço de grid
 * avança meia célula em x e em y por cada nível de altura — dois níveis
 * para atravessar uma célula completa.
 */
export function screenToWorld(
  sx: number,
  sy: number,
  z: number,
  geom: ProjectGeometry,
): WorldPoint {
  const { halfW, halfH } = halfAxes(geom);
  const a = sx / halfW;
  const b = (sy + z * geom.zStep) / halfH;
  return {
    x: (b + a) / 2,
    y: (b - a) / 2,
  };
}

/**
 * Atalho que aplica a regra de arredondamento a {@link screenToWorld}.
 *
 * `screenToCell(sx, sy, z, geom)` é equivalente a:
 * ```ts
 * const w = screenToWorld(sx, sy, z, geom);
 * return { x: Math.floor(w.x), y: Math.floor(w.y) };
 * ```
 */
export function screenToCell(
  sx: number,
  sy: number,
  z: number,
  geom: ProjectGeometry,
): CellPoint {
  const w = screenToWorld(sx, sy, z, geom);
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}
