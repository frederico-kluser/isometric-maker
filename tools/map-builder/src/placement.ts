/**
 * Onde o sprite pousa na tela — o cálculo que estava errado.
 *
 * Módulo PURO, sem PixiJS e sem DOM, porque o erro que ele conserta é
 * aritmético e merece teste. A versão anterior fazia, dentro da cena:
 *
 * ```ts
 * s.width  = tileWidth * zoom;              // 48 → 64  (1,333×)
 * s.height = (tileHeight + zStep) * zoom;   // 48 → 48  (1,0×)
 * ```
 *
 * Duas escalas diferentes nos dois eixos. Sobre pixel art isso não é "um pouco
 * esticado": o losango do topo deixa de ser 2:1, e um losango que não é 2:1 não
 * costura com o vizinho. O sintoma na tela é o bloco não encaixar no grid; a
 * causa está aqui, não na arte.
 *
 * ## As duas regras
 *
 * 1. **A escala é UNIFORME.** Um fator só, aplicado nos dois eixos. Quando a
 *    textura não tem a largura do tile (arte antiga, ainda não alinhada ao
 *    molde), o fator `tileWidth / textura.width` alinha a costura horizontal
 *    sem deformar nada.
 * 2. **A âncora é DECLARADA.** A projeção devolve o vértice SUPERIOR do losango
 *    do topo — não o canto do bounding box, não o centro do losango. Quem
 *    assume "canto superior esquerdo" desloca o mapa inteiro por meia largura
 *    de tile, e a discrepância só aparece quando duas peças precisam encostar.
 */

export interface SpriteBox {
  /** Canto superior esquerdo do sprite, em pixels de tela. */
  readonly x: number;
  readonly y: number;
  /** Fator UNIFORME. O mesmo em x e em y, sempre. */
  readonly scale: number;
}

export interface PlacementInput {
  /** Ponto que a projeção devolveu: o vértice superior do losango da célula. */
  readonly screenX: number;
  readonly screenY: number;
  /** Largura da textura, em pixels. */
  readonly textureWidth: number;
  /** Largura do tile no grid, em pixels. */
  readonly tileWidth: number;
  /** Zoom da câmera. Inteiro — fracionário borra pixel art. */
  readonly zoom: number;
  /** Coluna da textura que pousa em `screenX`. */
  readonly anchorX: number;
  /** Linha da textura que pousa em `screenY`. */
  readonly anchorY: number;
}

/**
 * Posição e escala de um sprite.
 *
 * `textureWidth` zero ou negativo cai em fator 1: uma textura ainda não
 * carregada não pode fazer a conta explodir nem esconder o sprite no infinito.
 */
export function spriteBox(input: PlacementInput): SpriteBox {
  const fit = input.textureWidth > 0 ? input.tileWidth / input.textureWidth : 1;
  const scale = fit * input.zoom;
  return {
    x: input.screenX - input.anchorX * scale,
    y: input.screenY - input.anchorY * scale,
    scale,
  };
}
