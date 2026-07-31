/**
 * Strings da aba Wizard — cadeia derivativa do personagem
 * (config → sul → cardeais → 8 direções → pronto).
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016).
 *
 * Prompts que vão para a API ficam em inglês nos placeholders, com o
 * rótulo avisando — mesma convenção de `personagem.edicaoPrompt`.
 * Nenhuma string fala de orçamento ou custo: o guard é só do servidor.
 */

export const wizard = {
  /** Cabeçalho do painel */
  titulo: 'Wizard',

  // ── cabeçalho: seletor e novo personagem ─────────────────────
  header: {
    /** Rótulo do seletor de personagem */
    personagem: 'Personagem',
    /** Nome acessível do seletor de personagem */
    seletorAria: 'Personagem em edição',
    /** Botão que abre o formulário de novo personagem */
    novo: 'Novo personagem',
    /** Por que o botão de novo personagem pode estar bloqueado */
    novoBloqueado: 'conclua o wizard do manequim para derivar personagens',
    /** Título do formulário de novo personagem */
    novoTitulo: 'Derivar novo personagem',
    /** Nota do formulário: o novo corpo nasce do manequim pronto */
    novoNota:
      'O personagem novo percorre o mesmo wizard do manequim — descrição própria, ' +
      'mesma silhueta e mesma configuração de frames já travada.',
    /** Rótulo do campo de nome */
    campoNome: 'Nome',
    /** Placeholder do campo de nome (exemplo em pt-BR) */
    placeholderNome: 'Cavaleiro do pântano',
    /** Rótulo do campo de descrição — o valor é o prompt enviado à API */
    campoDescricao: 'Descrição (em inglês — é o prompt)',
    /** Placeholder do campo de descrição: é prompt, fica em inglês */
    placeholderDescricao: 'a swamp knight in rusty armour, bald and unclothed',
    /** Rótulo do seletor de silhueta */
    campoSilhueta: 'Silhueta',
    /** Botão de criar */
    criar: 'Criar personagem',
    /** Botão de cancelar */
    cancelar: 'Cancelar',
  },

  /** Rótulos visíveis das silhuetas (chave = Silhouette do model) */
  silhuetas: {
    'humano-medio': 'Humano médio',
    'humano-corpulento': 'Humano corpulento',
    'humano-esguio': 'Humano esguio',
    quadrupede: 'Quadrúpede',
  },

  // ── primeira execução do manequim ────────────────────────────
  boasVindas: {
    titulo: 'Comece pelo manequim',
    texto:
      'O manequim é o corpo-base de todo o estúdio: poses, roupas e personagens ' +
      'derivam dele, nunca são gerados do zero. A cadeia é descrever a face sul, ' +
      'revisar até gostar, derivar as cardeais e fechar as 8 direções.',
    /** Ação em destaque quando o default do projeto está disponível */
    importarDefault: 'Importar default do projeto',
    /** Nota ao lado da ação de importar o default */
    importarDefaultNota:
      'Já existe um manequim pronto exportado em packages/game-assets/manequim — ' +
      'reutiliza a arte sem gerar nada.',
    /** Ação de importar um bundle salvo em disco */
    importarArquivo: 'Importar arquivo (.json)',
    /** Erro local quando o arquivo escolhido não é um JSON legível */
    arquivoInvalido: 'não consegui ler o arquivo — escolha um .json de manequim exportado pelo estúdio',
    /** Separador entre importar e gerar do zero */
    ouGereDoZero: 'ou descreva e gere do zero abaixo',
  },

  // ── trilha de progresso ──────────────────────────────────────
  trilha: {
    /** Nome acessível da lista de passos */
    ariaLabel: 'Progresso do wizard',
    /** Passo concluído (sr-only) */
    concluido: 'concluído',
    /** Passo atual (sr-only) */
    atual: 'atual',
    /** Passo ainda não alcançado (sr-only) */
    pendente: 'pendente',
    passos: {
      config: 'Configuração',
      sul: 'Face sul',
      cardeais: 'Cardeais',
      direcoes8: '8 direções',
      pronto: 'Pronto',
    },
  },

  // ── passo 1: configuração ────────────────────────────────────
  config: {
    titulo: 'Configuração da base',
    nota:
      'Frames, fps e tamanho travam antes da primeira geração e passam a valer ' +
      'para todas as poses, peças e personagens derivados — depois disso não mudam mais.',
    /** Rótulo do seletor de frames por animação */
    frames: 'Frames por animação',
    /** Nome acessível do seletor segmentado de frames */
    framesAria: 'Frames por animação',
    /** Rótulo do campo de fps */
    fps: 'FPS',
    /** Rótulo do campo de tamanho */
    tamanho: 'Tamanho (px)',
    /** Rótulo do seletor de silhueta */
    silhueta: 'Silhueta',
    /** Botão que trava a configuração */
    travar: 'Travar configuração',
  },

  // ── passo 2: face sul ────────────────────────────────────────
  sul: {
    titulo: 'Face sul',
    nota:
      'Tudo deriva desta imagem: as cardeais são rotações dela e as 8 direções a ' +
      'congelam. Descreva o corpo-base — careca e sem roupa, a roupa vem depois.',
    /** Rótulo do campo de descrição da sul — o valor é o prompt */
    descricaoRotulo: 'Descrição (em inglês — é o prompt)',
    /** Placeholder da descrição: é prompt, fica em inglês */
    placeholderDescricao: 'a bald, unclothed human base body, facing the viewer',
    /** Botão que gera a sul */
    gerar: 'Gerar face sul',
    /** Rótulo do campo de nova edição — o valor é o prompt */
    editarRotulo: 'Nova edição (em inglês — é o prompt)',
    /** Placeholder da edição: é prompt, fica em inglês */
    placeholderEdicao: 'make the shoulders a bit narrower',
    /** Botão que aplica a edição */
    editar: 'Editar com este prompt',
    /** Título da faixa de versões */
    versoes: 'Versões',
    /** Marca da versão ativa na faixa */
    versaoAtiva: 'ativa',
    /** Botão de desfazer a última edição */
    desfazer: 'Desfazer edição',
    /** Tooltip do desfazer quando já está na primeira versão */
    desfazerBloqueado: 'já está na primeira versão',
    /** Texto alternativo do preview da sul */
    altPreview: 'Face sul atual do personagem',
  },

  // ── passo 3: cardeais ────────────────────────────────────────
  cardeais: {
    titulo: 'Cardeais',
    nota:
      'Leste e norte saem em paralelo; o oeste vem depois, com as duas prontas. ' +
      'Cada uma é uma rotação da sul ativa.',
    /** Botão que dispara as três rotações */
    gerar: 'Gerar cardeais',
    /** Texto alternativo de uma cardeal pronta */
    altPronta: 'Cardeal gerada',
  },

  // ── passo 4: oito direções ───────────────────────────────────
  direcoes8: {
    titulo: 'Oito direções',
    nota:
      'As 4 cardeais são enviadas congeladas e as 4 diagonais são geradas em volta — ' +
      'a prova de congelamento confere os pixels no final.',
    /** Botão que dispara a geração das 8 direções */
    gerar: 'Gerar as 8 direções',
    /** Aviso quando falta travar a configuração */
    faltaConfig: 'trave a configuração antes de gerar as 8 direções',
    /** Texto alternativo de uma direção pronta */
    altPronta: 'Direção gerada',
  },

  // ── passo 5: pronto ──────────────────────────────────────────
  pronto: {
    titulo: 'Personagem pronto',
    /** Texto quando o manequim conclui o wizard */
    textoManequim:
      'O corpo-base está fechado nas 8 direções. Exporte como default do projeto ' +
      'para reutilizar sem gerar de novo, ou derive personagens a partir dele.',
    /** Texto quando um personagem derivado conclui o wizard */
    textoDerivado:
      'O corpo deste personagem está fechado nas 8 direções — poses e peças de ' +
      'roupa ficam nas outras abas.',
    /** Botão de exportar o manequim como default do projeto */
    exportar: 'Exportar como default do projeto',
    /** Nota do que a exportação faz */
    exportarNota:
      'Grava o bundle em packages/game-assets/manequim e baixa uma cópia em JSON.',
    /** Botão de refazer o manequim (ação destrutiva, hold-to-confirm) */
    refazer: 'Refazer o manequim',
    /** Ajuda do hold-to-confirm (ligada por aria-describedby) */
    refazerAjuda:
      'Segure para confirmar — arquiva o manequim atual e reabre o wizard do zero.',
  },

  // ── estados das ações (multi-state-button) ───────────────────
  acoes: {
    /** Rótulo enquanto a geração está em andamento */
    gerando: 'Gerando…',
    /** Rótulo quando a ação concluiu */
    sucesso: 'Feito',
    /** Rótulo quando a ação falhou (o botão continua clicável para tentar de novo) */
    falha: 'Falhou — tentar de novo',
    /** Rótulo de ações rápidas em andamento (sem geração remota) */
    aguarde: 'Aguarde…',
  },

  // ── moldura ──────────────────────────────────────────────────
  /** Exibido enquanto o /api/studio não respondeu */
  carregando: 'Carregando o estúdio…',
} as const;

// ==================================================================
// Parameterised strings (funções com nomes descritivos)
// ==================================================================

/** "8 frames · 8 fps · 64px — travado" — badge da configuração travada */
export const configTravada = (
  frameCount: number,
  fps: number,
  size: number,
): string => `${frameCount} frames · ${fps} fps · ${size}px — travado`;

/** "Versão 2 da face sul" — nome acessível de cada thumbnail da faixa */
export const versaoSulAria = (indice: number): string =>
  `Versão ${indice} da face sul`;

/** "Cardeal E" — nome acessível da célula de uma cardeal */
export const cardealAria = (sigla: string): string => `Cardeal ${sigla}`;

/** "Direção NW" — nome acessível da célula de uma das 8 direções */
export const direcaoAria = (sigla: string): string => `Direção ${sigla}`;
