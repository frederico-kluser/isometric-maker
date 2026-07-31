/**
 * Transformação afim de keypoints — F1-05.
 *
 * `rescale` aplica uma escala UNIFORME (mesmo factor em x e y) em torno do
 * centro do bounding box dos keypoints.  Função pura: sem DOM, sem rede,
 * sem PixiJS.
 *
 * A escala não-uniforme é PROIBIDA pelo contrato da task.  Qualquer tentativa
 * de a contornar (passando alturas diferentes em x e y) é rejeitada em tempo
 * de compilação porque a função só aceita um parâmetro de altura.
 */

// ------------------------------------------------------------------ tipos

/** Keypoint 2D com label.  Subconjunto de `Keypoint` do modelo. */
export interface Keypoint2D {
  readonly x: number;
  readonly y: number;
  readonly label: string;
}

// ------------------------------------------------------------------ rescale

/**
 * Aplica escala uniforme a um conjunto de keypoints, em torno do centro do
 * seu bounding box.
 *
 * A altura canónica (`alturaCanonica`) é a altura para a qual os keypoints
 * foram originalmente desenhados.  A altura em píxeis (`alturaPx`) é a altura
 * desejada no ecrã.
 *
 * O factor de escala é `alturaPx / alturaCanonica`.  A escala é aplicada em
 * torno do centro do bounding box actual, preservando o centro geométrico.
 *
 * Quando `alturaPx === alturaCanonica`, os keypoints são devolvidos
 * inalterados (identidade).
 *
 * @throws Error se `alturaCanonica <= 0`.
 * @returns Novo array de keypoints com as mesmas labels e coordenadas
 *          transformadas.  O array de entrada não é modificado.
 */
export function rescale(
  keypoints: readonly Keypoint2D[],
  alturaPx: number,
  alturaCanonica: number,
): Keypoint2D[] {
  if (keypoints.length === 0) return [];

  if (alturaCanonica <= 0) {
    throw new Error(
      `alturaCanonica deve ser > 0, recebido ${alturaCanonica}`,
    );
  }

  const factor = alturaPx / alturaCanonica;

  // Se a escala é 1, devolve cópia inalterada
  if (factor === 1) {
    return keypoints.map((kp) => ({ ...kp }));
  }

  // Calcula o centro do bounding box actual
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const kp of keypoints) {
    if (kp.x < minX) minX = kp.x;
    if (kp.y < minY) minY = kp.y;
    if (kp.x > maxX) maxX = kp.x;
    if (kp.y > maxY) maxY = kp.y;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Escala em torno do centro do bounding box:
  //   x' = cx + (x - cx) * factor
  //   y' = cy + (y - cy) * factor
  return keypoints.map((kp) => ({
    label: kp.label,
    x: cx + (kp.x - cx) * factor,
    y: cy + (kp.y - cy) * factor,
  }));
}
