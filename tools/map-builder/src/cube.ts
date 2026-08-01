/**
 * Desenho procedural do cubo isométrico.
 *
 * Serve a dois propósitos que parecem um só e não são:
 *
 *   1. **Arte de reserva.** Um bloco sem sprite gerado ainda precisa aparecer.
 *      Sem isto o editor só é utilizável DEPOIS de gastar dinheiro na API — e
 *      "precisa pagar para ver se funciona" é o oposto do que este repositório
 *      quer.
 *   2. **Cubo de preview.** O cursor de colocação é um cubo semitransparente,
 *      e ele nunca poderia vir de arte gerada: precisa ser translúcido,
 *      colorido pelo estado (válido/inválido) e existir mesmo sobre o vazio.
 *
 * ## A forma
 *
 * Um cubo isométrico dimétrico 2:1 tem exatamente três faces visíveis — topo,
 * esquerda e direita — e é assim que o gênero desenha. A geometria sai da
 * mesma projeção de `camera.ts`, então o cubo costura no grid por construção,
 * não por ajuste manual:
 *
 * ```text
 *        (w/2, 0)          topo:      losango de w × h
 *        /       \         esquerda:  paralelogramo de w/2 × (h/2 + d)
 *   (0,h/2)     (w,h/2)    direita:   espelho da esquerda
 *        \       /
 *        (w/2, h)  ← base do losango do topo
 *        |       |         d = profundidade vertical (zStep)
 *        (0, h/2+d) … (w, h/2+d)
 * ```
 *
 * As três faces recebem tons diferentes do mesmo matiz. Esse degradê é o que
 * lê como volume: com uma cor só, um campo de cubos vira uma mancha chapada.
 */

export interface CubeGeometry {
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Altura vertical das faces laterais, em pixels. */
  readonly depth: number;
}

export interface CubeShades {
  readonly top: string;
  readonly left: string;
  readonly right: string;
  readonly outline?: string | undefined;
}

/**
 * Tons de uma face a partir de um matiz.
 *
 * Topo mais claro, direita intermediária, esquerda mais escura — é a convenção
 * de luz do gênero (fonte alta, à direita). Manter o mesmo matiz nas três é o
 * que faz o cubo parecer um objeto, e não três polígonos vizinhos.
 */
export function shadesFromHue(hue: number, saturation = 45): CubeShades {
  return {
    top: `hsl(${hue} ${saturation}% 62%)`,
    right: `hsl(${hue} ${saturation}% 47%)`,
    left: `hsl(${hue} ${saturation}% 34%)`,
    outline: `hsl(${hue} ${saturation}% 22%)`,
  };
}

/** Matiz estável derivado de um identificador — a mesma peça tem sempre a mesma cor. */
export function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/**
 * Desenha o cubo num contexto 2D já posicionado, com a origem no canto
 * superior esquerdo do bounding box.
 *
 * Extraído para função porque as duas chamadas — textura de bloco e cubo de
 * preview — precisam da MESMA forma. Duas implementações da mesma geometria é
 * como o preview passa a mentir sobre onde a peça vai cair.
 */
export function paintCube(
  ctx: CanvasRenderingContext2D,
  geom: CubeGeometry,
  shades: CubeShades,
  alpha = 1,
): void {
  const w = geom.tileWidth;
  const h = geom.tileHeight;
  const d = geom.depth;
  const hw = w / 2;
  const hh = h / 2;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Topo: o losango do grid.
  ctx.beginPath();
  ctx.moveTo(hw, 0);
  ctx.lineTo(w, hh);
  ctx.lineTo(hw, h);
  ctx.lineTo(0, hh);
  ctx.closePath();
  ctx.fillStyle = shades.top;
  ctx.fill();

  // Face esquerda: desce da aresta oeste do losango.
  ctx.beginPath();
  ctx.moveTo(0, hh);
  ctx.lineTo(hw, h);
  ctx.lineTo(hw, h + d);
  ctx.lineTo(0, hh + d);
  ctx.closePath();
  ctx.fillStyle = shades.left;
  ctx.fill();

  // Face direita: desce da aresta leste.
  ctx.beginPath();
  ctx.moveTo(w, hh);
  ctx.lineTo(hw, h);
  ctx.lineTo(hw, h + d);
  ctx.lineTo(w, hh + d);
  ctx.closePath();
  ctx.fillStyle = shades.right;
  ctx.fill();

  if (shades.outline !== undefined) {
    ctx.strokeStyle = shades.outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hw, 0);
    ctx.lineTo(w, hh);
    ctx.lineTo(w, hh + d);
    ctx.lineTo(hw, h + d);
    ctx.lineTo(0, hh + d);
    ctx.lineTo(0, hh);
    ctx.closePath();
    ctx.stroke();
    // As duas arestas internas que separam as três faces.
    ctx.beginPath();
    ctx.moveTo(0, hh);
    ctx.lineTo(hw, h);
    ctx.lineTo(w, hh);
    ctx.moveTo(hw, h);
    ctx.lineTo(hw, h + d);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Canvas com um cubo isométrico desenhado, pronto para virar textura.
 *
 * O canvas tem exatamente o bounding box do cubo — `tileWidth` de largura e
 * `tileHeight + depth` de altura —, então o sprite resultante ancora no mesmo
 * ponto que a projeção calcula, sem offset mágico em lugar nenhum.
 */
export function makeCubeCanvas(
  geom: CubeGeometry,
  shades: CubeShades,
  alpha = 1,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = geom.tileWidth;
  canvas.height = geom.tileHeight + geom.depth;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas 2d indisponível');
  ctx.imageSmoothingEnabled = false;
  paintCube(ctx, geom, shades, alpha);
  return canvas;
}

/**
 * Canvas do losango do grid — só o topo, sem laterais.
 *
 * É o que desenha o chão vazio: sem uma malha visível, um mapa vazio é uma
 * tela preta e não há onde clicar com intenção.
 */
export function makeDiamondCanvas(
  tileWidth: number,
  tileHeight: number,
  stroke: string,
  fill?: string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = tileWidth;
  canvas.height = tileHeight;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas 2d indisponível');
  ctx.imageSmoothingEnabled = false;
  const hw = tileWidth / 2;
  const hh = tileHeight / 2;
  ctx.beginPath();
  ctx.moveTo(hw, 0.5);
  ctx.lineTo(tileWidth - 0.5, hh);
  ctx.lineTo(hw, tileHeight - 0.5);
  ctx.lineTo(0.5, hh);
  ctx.closePath();
  if (fill !== undefined) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
  return canvas;
}
