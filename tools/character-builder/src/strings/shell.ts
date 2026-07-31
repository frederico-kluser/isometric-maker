/**
 * Strings do shell do aplicativo — título, abas e textos de moldura.
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016).
 */

export const shell = {
  /** Título do aplicativo, no cabeçalho e na aba do navegador */
  appTitle: 'Sprite Studio',
  /** Nome acessível (aria-label) da lista de abas */
  tabsAriaLabel: 'Seções do estúdio',
  /** Nomes das quatro abas do shell */
  tabs: {
    wizard: 'Wizard',
    poses: 'Poses',
    itens: 'Itens',
    laboratorio: 'Laboratório',
  },
} as const;
