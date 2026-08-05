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
    /**
     * Antes esta nota dizia "Prompt em inglês costuma render melhor" — ou
     * seja, jogava no usuário um trabalho que o código passou a fazer.
     * Escreva em português; o servidor traduz.
     */
    descricaoNota:
      'Escreva em português, do jeito que vier. O servidor extrai o MATERIAL e ' +
      'traduz para o inglês antes de mandar — a forma do cubo vem do molde, não ' +
      'do texto.',

    custo: '1 tile + 1 animate-with-text-v3 (preço estimado)',
    custoEstatico: '1 tile (preço estimado)',

    estiloCartao: 'Estilo do cubo',
    estiloNota:
      'Knobs do /create-isometric-tile. Cada um só é enviado quando sai do ' +
      'padrão do fornecedor — no padrão, o bloco é o mesmo artefato e custa uma ' +
      'geração só.',
    guidanceRotulo: 'Fidelidade ao texto (text_guidance_scale)',
    guidanceNota:
      'De 1 a 20. Quanto mais alto, mais a arte segue a descrição — e menos ' +
      'liberdade o modelo tem. Padrão do fornecedor: 8.',
    outlineRotulo: 'Contorno (outline)',
    shadingRotulo: 'Sombreamento (shading)',
    detailRotulo: 'Nível de detalhe (detail)',

    /**
     * Rótulos dos enums do `/create-isometric-tile`.
     *
     * A CHAVE é o valor que vai no request — o enum do spec vendorizado, em
     * inglês, que não pode ser traduzido nunca. O VALOR é o que o usuário lê,
     * em pt-BR (ADR 0008). Antes disto o painel renderizava o enum cru como
     * rótulo visível: o usuário via "single color outline" numa tela em
     * português.
     */
    outlineOpcoes: {
      'single color outline': 'contorno de cor única',
      'selective outline': 'contorno seletivo',
      lineless: 'sem contorno',
    },
    shadingOpcoes: {
      'flat shading': 'sombreamento chapado',
      'basic shading': 'sombreamento básico',
      'medium shading': 'sombreamento médio',
      'detailed shading': 'sombreamento detalhado',
      'highly detailed shading': 'sombreamento muito detalhado',
    },
    detailOpcoes: {
      'low detail': 'pouco detalhe',
      'medium detail': 'detalhe médio',
      'highly detailed': 'muito detalhado',
    },

    acaoRotulo: 'Ação da animação (action)',
    acaoPlaceholder: 'água ondulando suavemente, com reflexos de luz',
    acaoNota:
      'Opcional. Descreva o MOVIMENTO do material — em branco, o servidor ' +
      'gera a ação via IA a partir da descrição.',

    enhanceRotulo: 'Otimizar descrição da animação via IA (enhance_prompt)',
    enhanceNota:
      'A PixelLab expande o texto da ação antes de gerar. Cobrança estimada ' +
      'à parte (enhance_usage).',

    pingPongRotulo: 'Animação vai-e-volta (ping-pong)',
    pingPongNota: 'Evita quebra de continuidade ao reiniciar o loop.',

    estatico: 'Estático',

    frameCountRotulo: 'Frames da animação (frame_count)',
    frameCountNota:
      'Estático (0) ou animado: 4, 8 ou 16, sempre par — é o que o ' +
      'animate-with-text-v3 aceita.',
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

  /**
   * Remoção de bloco. O texto é deliberadamente sem eufemismo: apagar é
   * irreversível, o dinheiro da geração já saiu e não volta, e um mapa que já
   * usava o bloco muda de aparência. Prometer menos do que isso seria a mesma
   * mentira de interface que o comentário do `semGasto` descreve.
   */
  remocao: {
    acao: 'Apagar',
    apagando: 'Apagando…',
    ariaLabel: (descricao: string) =>
      `Apagar o bloco "${descricao}" — segure para confirmar`,
    dica:
      'Segure o botão para apagar. A remoção é definitiva: o bloco sai do disco, ' +
      'e o dinheiro que a geração custou não volta.',
    apagado: (descricao: string) => `Bloco "${descricao}" apagado do disco.`,
    naoExistia: 'Esse bloco já não estava em disco — nada foi apagado.',
    pendenteDescartado:
      'Havia trabalho JÁ PAGO esperando retomada neste bloco (stub de tile ou de ' +
      'animação); ele foi descartado junto e não dá mais para buscá-lo de graça.',
    avisoMapa:
      'Um mapa que já tinha este bloco colocado passa a mostrar um cubo procedural ' +
      'no lugar: o editor de mundo não quebra, mas a aparência muda.',
    falhou: (motivo: string) => `Não deu para apagar o bloco: ${motivo}`,
  },

  erros: {
    descricaoObrigatoria: 'Escreva a descrição do bloco — o endpoint não gera sem prompt.',
    jobFalhou: 'A geração falhou. Veja o log do servidor.',
  },
} as const;
