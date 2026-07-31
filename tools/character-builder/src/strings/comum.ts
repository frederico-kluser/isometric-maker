/**
 * Strings legadas da interface do Character Builder que ainda têm consumidor.
 *
 * Das seções originais do antigo módulo único `src/strings.ts`, só `erro`
 * sobreviveu à reescrita v2: `comum` e `personagem` morreram com as telas
 * vanilla, e `custo` morreu com o diálogo de orçamento (o guard vive só no
 * servidor — ADR 0012). As funções parametrizadas (idRemoto, notaEsqueleto
 * etc.) também ficaram sem consumidor e foram removidas.
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016).
 */

// ==================================================================
// Static strings (as const — chave inexistente é erro de compilação)
// ==================================================================

// ── erro ───────────────────────────────────────────────────────
export const erro = {
  /** Arquivo não é um PNG */
  formatoInvalido: 'formato de arquivo inválido — só aceito PNG',
  /** Algum lado da imagem passa de 256px */
  ladoAcimaDe256: 'imagem muito grande — máximo 256×256 pixels',
  /** Algum lado está fora da faixa 16–128 */
  ladoForaDaFaixa: 'dimensão fora da faixa permitida (16–128 pixels)',
  /** Altura informada maior que a altura da imagem */
  alturaMaiorQueImagem: 'altura informada é maior que a altura da imagem',
  /** Imagem não é quadrada */
  imagemNaoQuadrada: 'a imagem de referência precisa ser quadrada (largura = altura)',
} as const;
