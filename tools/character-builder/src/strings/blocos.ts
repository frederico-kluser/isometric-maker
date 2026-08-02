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
    'Bancada de criação de cubos pixel art para o editor de mapa. O molde do ' +
    'cubo é a referência de forma e tamanho; a descrição define o material. ' +
    'Técnica única: cubo pixel-art (tile com molde como referência) + animate-with-text-v3 (ADR 0032).',

  form: {
    cartaoBloco: 'Bloco',
    descricaoRotulo: 'Descrição (description)',
    descricaoPlaceholder: 'grama por cima de terra',
    descricaoNota:
      'Descreva o MATERIAL, não a forma do cubo — a forma vem do molde de ' +
      'referência. Prompt em inglês costuma render melhor.',

    custo: '1 tile + 1 animate-with-text-v3 (preço estimado)',

    frameCountRotulo: 'Frames da animação (frame_count)',
    frameCountNota: '4, 8 ou 16. Tem que ser par — é o que o animate-with-text-v3 aceita.',
    fpsRotulo: 'FPS da animação',
    fpsNota: 'Quadros por segundo no editor. Só pós-processamento — nunca custa nada.',

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
      'Gerando a textura animada. O caminho pode responder na hora ou em segundo ' +
      'plano — os dois estão cobertos. Não feche a aba.',
    doCache: 'do cache — nenhuma chamada saiu',
    aviso:
      'O bloco entrou no catálogo como textura animada. Abra o editor de mapa em ' +
      'http://localhost:5175 e recarregue para vê-lo na paleta — a mesma animação ' +
      'aparece de qualquer ângulo de câmera.',
  },

  molde: {
    titulo: 'Molde do cubo',
    descricao:
      'O molde do cubo é a referência de forma e tamanho da geração: ele fixa o ' +
      'losango da face e a aresta vertical. O prompt pede ao modelo que respeite ' +
      'a forma e o tamanho do cubo — a descrição só precisa dizer o material.',
    geometria: (w: number, h: number, d: number) =>
      `Losango ${w}×${h} px, aresta vertical ${d} px, sprite ${w}×${h + d} px. ` +
      'Um cubo de verdade: mesma medida em largura, profundidade e altura.',
    porQueCinza:
      'O molde é acromático de propósito: init_image carrega forma E cor, e um ' +
      'molde colorido faria todo bloco nascer da cor dele.',
  },

  animacao: {
    cartao: 'Animação',
  },

  catalogo: {
    titulo: 'Catálogo',
    vazio: 'Nenhum bloco completo em disco ainda.',
    recarregar: 'Recarregar',
    tecnica: {
      chained: 'molde encadeado',
      rotated: 'rotate v3',
      texture: 'textura animada',
    } as const,
    comparacaoNota:
      'O mesmo prompt pode ser gerado em várias técnicas — cada uma tem seu próprio ' +
      'cache, e a etiqueta diz de qual veio cada bloco.',
  },

  erros: {
    descricaoObrigatoria: 'Escreva a descrição do bloco — o endpoint não gera sem prompt.',
    jobFalhou: 'A geração falhou. Veja o log do servidor.',
  },
} as const;
