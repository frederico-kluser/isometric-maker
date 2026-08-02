/**
 * Strings da tela inicial — o cruzamento entre o estúdio de personagem e o
 * editor de mapa.
 *
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016).
 */

export const inicio = {
  /** Nome do editor inteiro, não de uma das duas telas */
  appTitle: 'Isometric Maker',
  /** Uma linha dizendo o que a ferramenta é */
  tagline: 'Editor de jogos isométricos — arte e mapa na mesma máquina.',
  /** Nome acessível da lista de caminhos */
  entriesAriaLabel: 'Escolha o que criar',

  character: {
    title: 'Criar personagem',
    description:
      'Gera o corpo base, as oito direções, as poses e o guarda-roupa pela API da PixelLab.',
    cta: 'Abrir o estúdio',
  },

  world: {
    title: 'Criar mundo',
    description:
      'Monta o mapa isométrico com as peças geradas: empilha, pinta, gira a câmera e exporta.',
    cta: 'Abrir o editor de mapa',
  },

  /** Volta para cá a partir de qualquer uma das duas telas */
  back: {
    label: 'Início',
    ariaLabel: 'Voltar para a tela inicial',
  },
} as const;
