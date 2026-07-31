/**
 * Strings da interface do Character Builder.
 *
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016).
 * Objeto `as const` — acesso por propriedade direta, não por função t().
 *
 * Strings parametrizadas (com interpolação) são funções exportadas
 * separadamente, com nomes descritivos. Nenhuma é uma função t(chave).
 */

// ==================================================================
// Static strings (as const — chave inexistente é erro de compilação)
// ==================================================================

export const S = {
  // ── comum ──────────────────────────────────────────────────────
  comum: {
    /** Botão genérico de geração */
    gerar: 'Gerar',
    /** Botão quando o job está em andamento */
    gerando: 'gerando…',
    /** Rótulo de campo de formulário */
    nome: 'Nome',
    /** Rótulo de seletor de quantidade de frames */
    frames: 'Frames',
    /** Rótulo de campo de FPS */
    fps: 'FPS',
    /** Cabeçalho da coluna de ação */
    acao: 'Ação',
    /** Status quando não há job ativo */
    ocioso: 'ocioso',
  },

  // ── personagem ─────────────────────────────────────────────────
  personagem: {
    /** Rótulo do seletor de personagem */
    titulo: 'Personagem',
    /** Linha base da grade de poses */
    modeloBase: 'Modelo base',
    /** Exibido quando o personagem ainda não tem remoteId */
    semIdRemoto: 'sem id remoto ainda',
    /** Botão para gerar o modelo base */
    gerarBase: 'Gerar base',
    /** Tooltip do botão de pose bloqueado */
    gereBasePrimeiro: 'gere o modelo base primeiro',
    /** Cabeçalho da seção de referência */
    arteReferencia: 'Arte de referência',
    /** Cabeçalho da grade de poses */
    posesOitoDirecoes: 'Poses × 8 direções',
    /** Cabeçalho do formulário de pose */
    cadastrarNovaPose: 'Cadastrar nova pose',
    /** Cabeçalho da seção de guarda-roupa */
    guardaRoupaEquipamento: 'Guarda-roupa e equipamento',
    /** Cabeçalho da coluna de pose na grade */
    pose: 'Pose',
    /** Cabeçalho da coluna de peça no guarda-roupa */
    peca: 'Peça',
    /** Botão para cadastrar peça de roupa */
    cadastrarPeca: 'Cadastrar peça',
    /** Botão para cadastrar pose */
    cadastrarPose: 'Cadastrar pose',
    /** Rótulo do campo de slot */
    slot: 'Slot',
    /**
     * Rótulo do campo de descrição da edição.
     * O valor deste campo é um PROMPT enviado à API — o placeholder
     * está em inglês e NÃO deve ser traduzido.
     */
    edicaoPrompt: 'Edição (inglês, é o prompt)',
    /** Rótulo do checkbox "manter paleta" */
    manterPaleta: 'Manter paleta do corpo',
    /** Rótulo do seletor de modo de geração */
    comoGerar: 'Como gerar',
    /** Opção: template nativo */
    kindTemplate: 'template nativo (mais barato)',
    /** Opção: texto livre */
    kindTexto: 'texto livre',
    /** Opção: esqueleto manual */
    kindEsqueleto: 'esqueleto manual',
    /** Drop zone quando já existe referência */
    referenciaAnexada: 'Referência anexada. Solte outra imagem para trocar.',
    /** Drop zone vazia */
    arrasteReferencia:
      'Arraste a arte de referência aqui (virada para o SUL, até 256×256)',
    /**
     * Placeholder do campo de rótulo da peça.
     * Exemplo em pt-BR — o usuário digita o que quiser.
     */
    placeholderPeca: 'Cota de malha enferrujada',
    /**
     * Placeholder do campo de rótulo da pose.
     * Exemplo em pt-BR — o usuário digita o que quiser.
     */
    placeholderPose: 'Bloqueando com escudo',
    /** Nota explicativa do formulário de pose (estática, sem interpolação) */
    notaPoseForm:
      'Só existem 10 templates nativos, e walk, run e jump não estão entre eles — por isso ' +
      'pose nova de movimento vai por texto livre. Template custa 1 geração por direção; ' +
      'texto livre custa ~1 por direção até 96px e escala com o tamanho acima disso.',
    /** Nota explicativa da referência */
    notaReferencia:
      'Com referência anexada, o create-character-v3 rotaciona ESSA arte nas 8 direções em vez ' +
      'de inventar um corpo. Sem ela, o corpo vem do texto da descrição.',
  },

  // ── custo ──────────────────────────────────────────────────────
  custo: {
    /** Exibido quando PIXELLAB_SECRET não está definido */
    semToken:
      'PIXELLAB_SECRET não definido — a tela funciona, mas nada gera',
  },

  // ── erro ───────────────────────────────────────────────────────
  erro: {
    /** Prefixo de mensagem de erro na barra de status */
    prefixo: 'erro: ',
    /** Erro ao ler arquivo via FileReader */
    leituraArquivo: 'não consegui ler o arquivo',
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
  },
} as const;

// ==================================================================
// Parameterised strings (funções com nomes descritivos)
// ==================================================================

/** "id remoto abcd1234…" — identificador truncado do personagem na API */
export const idRemoto = (id: string): string =>
  `id remoto ${id.slice(0, 12)}…`;

/** "3 geração(ões) em andamento — 2 a 5 min cada" */
export const geracoesEmAndamento = (n: number): string =>
  `${n} geração(ões) em andamento — 2 a 5 min cada`;

/** "silhueta heavy — não serve neste corpo" */
export const silhuetaNaoServe = (silhouette: string): string =>
  `silhueta ${silhouette} — não serve neste corpo`;

/** "peça é heavy, personagem é light" — tooltip de incompatibilidade */
export const pecaSilhuetaIncompativel = (
  itemSilhouette: string,
  charSilhouette: string,
): string => `peça é ${itemSilhouette}, personagem é ${charSilhouette}`;

/** 'Descrição atual: "um guerreiro élfico…"' */
export const descricaoAtual = (desc: string): string =>
  `Descrição atual: "${desc}"`;

/** Nota do painel de guarda-roupa — silhueta interpolada */
export const notaGuardaRoupa = (silhouette: string): string =>
  'Cada peça é uma edição aplicada sobre o corpo base e propagada nas 8 direções pelo ' +
  'create-character-state, que devolve um group_id ligando o estado ao corpo de origem. ' +
  `Vale para qualquer personagem da MESMA silhueta (${silhouette}) — peça de outra ` +
  'silhueta é recusada antes de gastar.';

/** Nota do formulário de pose de esqueleto — rótulos de keypoints interpolados */
export const notaEsqueleto = (labels: string): string =>
  `Pose de esqueleto usa os 18 keypoints (${labels}…) e é ` +
  'gerada uma direção por vez pelo animate-with-skeleton. Cadastre aqui e edite os ' +
  'keypoints em studio.json — a geração por esqueleto ainda não tem editor visual.';
