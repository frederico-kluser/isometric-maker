/**
 * O formato Base64Image da API do PixelLab, num lugar só.
 *
 * Todo campo de imagem do spec — `from_image`, `init_image`, `mask_image`,
 * `color_image`, `reference_image`, e o `image` de VOLTA nas respostas — é o
 * schema `Base64Image`: um OBJETO `{type?, base64, format?}`, com `base64` como
 * único campo obrigatório. Nunca a string crua.
 *
 * ## Por que este módulo existe
 *
 * A API passou a exigir o objeto e `server/mannequin.ts` foi corrigido; os
 * outros módulos não. O resultado, verificado contra a API em 2026-08-01:
 *
 *   - mandar string em `from_image` → 422 "Input should be a valid dictionary
 *     or object to extract fields from";
 *   - ler a resposta como string → `b64.replace is not a function`.
 *
 * O laboratório de rotação carregava os dois lados do erro e nunca completou
 * uma chamada. Duas cópias da mesma regra é como uma delas fica para trás, então
 * agora existe uma definição só e todo módulo importa daqui.
 */

/** O formato que a API espera em qualquer campo de imagem. */
export interface Base64Image {
  readonly type: 'base64';
  readonly base64: string;
  readonly format?: string;
}

/** Remove o prefixo `data:image/...;base64,` e os espaços de uma string b64. */
export function stripDataUri(b64: string): string {
  return b64.replace(/^data:image\/\w+;base64,/, '').replace(/\s+/g, '');
}

/**
 * Envolve b64 puro (ou data URI) no objeto que a API espera.
 *
 * Use SEMPRE isto ao montar um request — nunca passe a string direto.
 */
export function asBase64Image(raw: string): Base64Image {
  return { type: 'base64', base64: stripDataUri(raw) };
}

/**
 * Lê o b64 de um campo de imagem de RESPOSTA, nas duas formas.
 *
 * Aceita objeto (o que o spec documenta) e string (o que endpoints mais antigos
 * devolviam). Tolerar as duas é deliberado: a API do PixelLab muda sem
 * versionar — o `info.version` do spec é literalmente `"dev"` —, e o custo de
 * aceitar a forma antiga é uma linha, enquanto o custo de recusá-la é uma
 * geração paga que não vira arquivo.
 *
 * Devolve string vazia quando não há imagem; o chamador decide se isso é erro.
 */
export function extractBase64(image: unknown): string {
  if (typeof image === 'string') return stripDataUri(image);
  if (image && typeof image === 'object' && 'base64' in image) {
    const b = (image as Record<string, unknown>)['base64'];
    if (typeof b === 'string') return stripDataUri(b);
  }
  return '';
}
