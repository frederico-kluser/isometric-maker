/**
 * Todo texto do EDITOR DE MAPA, num lugar só e em português do Brasil.
 *
 * Centralizar não é organização: é o que permite `grep` provar que nenhuma
 * string em inglês vazou para a tela, e o que impede a mesma frase de existir
 * em duas versões divergentes.
 *
 * Módulo separado do barril `src/strings.ts` de propósito: aquele agrupa as
 * telas do estúdio de personagem, esta é a tela do mapa. Fundir os dois faria
 * cada tela carregar o vocabulário da outra.
 */

export const editor = {
  titulo: 'Editor de mapa isométrico',

  camera: {
    rotulo: 'Vista',
    ariaLabel: 'Vista da câmera',
    girar: 'Girar 90°',
    girarDica: 'Girar 90° (tecla R; Shift+R volta)',
    aumentar: 'Aproximar',
    diminuir: 'Afastar',
  },

  ferramenta: {
    rotulo: 'Ferramenta',
    ariaLabel: 'Ferramenta de edição',
    nomes: {
      empilhar: 'Empilhar',
      colocar: 'Colocar',
      pintar: 'Pintar',
      remover: 'Remover',
    } as const,
  },

  paleta: {
    titulo: 'Peças',
    nota:
      'Peças com arte vêm do Sprite Studio (Criar personagem › Laboratório › ' +
      'Blocos do mundo). As demais são cubos desenhados por código — servem ' +
      'para montar o mapa antes de gerar arte.',
    contagem: (n: number): string =>
      n === 0 ? 'nenhuma gerada' : n === 1 ? '1 gerada' : `${n} geradas`,
  },

  acoes: {
    desfazer: 'Desfazer',
    desfazerDica: 'Desfazer (Ctrl+Z)',
    refazer: 'Refazer',
    exportar: 'Exportar JSON',
    limpar: 'Segure para limpar o mapa',
  },

  status: {
    vista: 'Vista:',
    alvo: 'Alvo:',
    pecas: 'Peças:',
    atalhos: 'Clique para editar · Shift+arrastar move a câmera · Roda dá zoom · R gira · 1–4 escolhem a vista',
  },

  bussola: {
    ariaLabel: (vista: string): string => `Bússola — câmera apontando para ${vista}`,
    titulo: (vista: string): string => `Câmera apontando para ${vista}`,
  },

  toast: {
    paletaCarregada: (n: number): string =>
      n === 1
        ? '1 bloco gerado carregado na paleta.'
        : `${n} blocos gerados carregados na paleta.`,
    semBlocosGerados:
      'Nenhum bloco gerado ainda. Gere em Criar personagem › Laboratório › ' +
      '"Blocos do mundo" e volte para esta tela.',
    mapaLimpo: 'Mapa limpo. Ctrl+Z desfaz.',
    exportado: 'mapa.json exportado.',
  },
} as const;
