/**
 * Strings da seção "Blocos do mundo" do Sprite Studio.
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016).
 *
 * Nomes de parâmetro da API aparecem entre parênteses de propósito: esta tela
 * é uma bancada dos endpoints, e reconhecer o campo do spec é metade do uso.
 */

export const blocos = {
  titulo: 'Blocos do mundo',
  descricao:
    'Bancada de blocos de terreno: toda geração produz as QUATRO vistas da câmera, ' +
    'cada uma com arte própria — é o que faz a rotação do mapa mostrar perspectivas ' +
    'diferentes do mesmo bloco. Escolha a técnica e compare os resultados no catálogo.',

  form: {
    cartaoBloco: 'Bloco',
    descricaoRotulo: 'Descrição (description)',
    descricaoPlaceholder: 'grama por cima de terra',
    descricaoNota:
      'Descreva o MATERIAL, não a forma do cubo — a forma vem do molde e do parâmetro ' +
      'de espessura abaixo. Prompt em inglês costuma render melhor.',

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
      'Mesma seed com a mesma configuração produz o mesmo bloco. As chamadas usam ' +
      'seed base + índice.',

    cartaoTecnica: 'Técnica das 4 vistas',
    tecnicaRotulo: 'Como derivar as quatro vistas',
    tecnicaEncadeada: 'Molde encadeado (4 tiles)',
    tecnicaRotate: 'Rotate v3 (1 tile + 1 v3)',
    tecnicaEncadeadaNota:
      'A face norte nasce do molde do cubo (init_image) e o RESULTADO dela vira o ' +
      'molde das outras três, com sufixo de face no prompt e a paleta travada ' +
      '(color_image). Quatro gerações do create-isometric-tile.',
    tecnicaRotateNota:
      'A mesma norte de tile vai como reference_image do create-character-v3, que a ' +
      'rotaciona para 8 direções; as 4 vistas saem de rotation_urls, que já vêm como ' +
      'imagens separadas — nada é extraído de GIF. Uma geração de tile + uma do v3.',

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
      'Gerando as quatro vistas. O caminho pode responder na hora ou em segundo ' +
      'plano — os dois estão cobertos. Não feche a aba.',
    doCache: 'do cache — nenhuma chamada saiu',
    face: {
      north: 'Norte',
      east: 'Leste',
      south: 'Sul',
      west: 'Oeste',
    } as const,
    aviso:
      'As quatro faces já estão no catálogo. Abra o editor de mapa em ' +
      'http://localhost:5175 e recarregue para vê-las na paleta — e gire a câmera ' +
      'para conferir as quatro perspectivas.',
  },

  molde: {
    titulo: 'Molde do cubo',
    descricao:
      'A primeira face de toda geração nasce deste molde como imagem inicial ' +
      '(init_image). Dali, a técnica escolhida abaixo decide como as outras três ' +
      'vistas são derivadas dela.',
    geometria: (w: number, h: number, d: number) =>
      `Losango ${w}×${h} px, aresta vertical ${d} px, sprite ${w}×${h + d} px. ` +
      'Um cubo de verdade: mesma medida em largura, profundidade e altura.',
    porQueCinza:
      'O molde é acromático de propósito: init_image carrega forma E cor, e um ' +
      'molde colorido faria todo bloco nascer da cor dele.',
  },

  catalogo: {
    titulo: 'Catálogo',
    vazio: 'Nenhum bloco completo em disco ainda.',
    recarregar: 'Recarregar',
    tecnica: {
      chained: 'molde encadeado',
      rotated: 'rotate v3',
    } as const,
    comparacaoNota:
      'O mesmo prompt pode ser gerado nas duas técnicas — cada uma tem seu próprio ' +
      'cache, e a etiqueta diz de qual veio cada bloco.',
  },

  erros: {
    descricaoObrigatoria: 'Escreva a descrição do bloco — o endpoint não gera sem prompt.',
    seedInvalida: 'Seed precisa ser um inteiro maior ou igual a zero.',
    guidanceInvalida: 'Aderência ao texto precisa ser um número entre 1 e 20.',
    jobFalhou: 'A geração falhou. Veja o log do servidor.',
  },
} as const;

/** Rótulo do custo estimado — sempre "estimado", como a própria PixelLab rotula. */
export function custoEstimado(tecnica: string): string {
  return tecnica === 'rotated'
    ? '1 geração de tile + 1 do v3 (preço estimado)'
    : '4 gerações de tile (preço estimado)';
}
