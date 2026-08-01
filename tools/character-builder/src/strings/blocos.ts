/**
 * Strings da seção "Blocos do mundo" do Sprite Studio.
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016).
 *
 * Nomes de parâmetro da API aparecem entre parênteses de propósito: esta tela
 * é uma bancada do endpoint, e reconhecer o campo do spec é metade do uso.
 */

export const blocos = {
  titulo: 'Blocos do mundo',
  descricao:
    'Bancada do /create-isometric-tile: gera as peças de terreno já desenhadas na ' +
    'projeção isométrica do gênero — topo mais duas faces laterais, prontas para ' +
    'assentar no grid do editor de mapa.',

  form: {
    cartaoBloco: 'Bloco',
    descricaoRotulo: 'Descrição (description)',
    descricaoPlaceholder: 'grama por cima de terra',
    descricaoNota:
      'Descreva o MATERIAL, não a forma do cubo — a forma vem do parâmetro de ' +
      'espessura abaixo. Prompt em inglês costuma render melhor.',

    tamanhoRotulo: 'Tamanho (image_size)',
    tamanhoNota:
      'Faixa do endpoint: 16 a 64 px. O próprio spec observa que acima de 24 px ' +
      'costuma dar melhor resultado.',

    formaRotulo: 'Espessura (isometric_tile_shape)',
    formaNota:
      'block ocupa ~50% da altura do canvas (o cubo), thick tile ~25% e thin tile ~15%. ' +
      'Peça mais espessa permite mais variação de altura no mapa.',

    unidadeRotulo: 'Unidade do tile (isometric_tile_size)',
    unidadeNota: 'Enum fechado do spec: 16 ou 32. Em branco usa o padrão do endpoint.',

    cartaoQualidade: 'Qualidade',
    outlineRotulo: 'Contorno (outline)',
    shadingRotulo: 'Sombreamento (shading)',
    detailRotulo: 'Detalhe (detail)',
    guidanceRotulo: 'Aderência ao texto (text_guidance_scale)',
    guidanceNota: 'Número de 1 a 20. Em branco usa o padrão do endpoint (8).',
    padraoApi: 'padrão da API',

    seedRotulo: 'Seed',
    seedPlaceholder: 'em branco = derivada do hash',
    seedNota:
      'Mesma seed com a mesma configuração produz o mesmo bloco. As faces usam ' +
      'seed base + índice.',

    cartaoVistas: 'Vistas',
    modoRotulo: 'Como gerar as quatro vistas',
    modoUniforme: 'Uniforme (1 geração)',
    modoOrientado: 'Orientado (4 gerações)',
    modoNota:
      'O endpoint NÃO tem parâmetro de orientação. Uniforme gera uma arte e reusa ' +
      'nas quatro vistas da câmera — é o certo para grama, pedra e terra, e custa ' +
      'um quarto. Orientado gera uma por vista, guiado por texto, e só vale quando ' +
      'o bloco tem um lado distinto (uma porta, uma quina, um brasão).',
    travarPaleta: 'Travar a paleta na primeira face (color_image)',
    travarPaletaNota:
      'Só vale no modo orientado. Sem isso, as quatro vistas do mesmo bloco derivam ' +
      'de cor e param de parecer o mesmo bloco.',

    gerar: 'Gerar bloco',
    gerando: 'Gerando…',
    pronto: 'Pronto',
    falhou: 'Falhou',
    ariaLabel: 'Gerar o bloco do mundo com a configuração atual',
  },

  resultado: {
    titulo: 'Resultado',
    vazio: 'Nenhum bloco gerado ainda nesta sessão.',
    aguardando:
      'Gerando. O endpoint pode responder na hora ou em segundo plano — os dois ' +
      'caminhos estão cobertos. Não feche a aba.',
    doCache: 'do cache — nenhuma chamada saiu',
    reuso: 'reuso da norte',
    face: {
      north: 'Norte',
      east: 'Leste',
      south: 'Sul',
      west: 'Oeste',
    } as const,
    aviso:
      'As quatro faces já estão no catálogo. Abra o editor de mapa em ' +
      'http://localhost:5175 e recarregue para vê-las na paleta.',
  },

  catalogo: {
    titulo: 'Catálogo',
    vazio: 'Nenhum bloco completo em disco ainda.',
    recarregar: 'Recarregar',
  },

  erros: {
    descricaoObrigatoria: 'Escreva a descrição do bloco — o endpoint não gera sem prompt.',
    tamanhoInvalido: 'Tamanho fora da faixa do endpoint: inteiro entre 16 e 64.',
    seedInvalida: 'Seed precisa ser um inteiro maior ou igual a zero.',
    guidanceInvalida: 'Aderência ao texto precisa ser um número entre 1 e 20.',
    jobFalhou: 'A geração falhou. Veja o log do servidor.',
  },
} as const;

/** Rótulo do custo estimado — sempre "estimado", como a própria PixelLab rotula. */
export function custoEstimado(geracoes: number): string {
  return geracoes === 1
    ? '1 geração (preço estimado)'
    : `${geracoes} gerações (preço estimado)`;
}

/** Resumo do lote para o histórico. */
export function resumoBloco(size: number, shape: string, modo: string): string {
  return `${size} px · ${shape} · ${modo === 'uniform' ? 'uniforme' : 'orientado'}`;
}
