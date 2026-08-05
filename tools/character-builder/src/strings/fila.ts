/**
 * Strings do painel da fila de gerações.
 *
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016). Nada de texto solto
 * no componente.
 *
 * Este arquivo carrega as frases mais caras da interface inteira: as que dizem
 * ao usuário se cancelar custa dinheiro. Elas aparecem **antes** da confirmação,
 * nunca depois, e nenhuma delas promete devolução — a cobrança acontece na
 * submissão, e cancelar só descarta o resultado (`server/job-queue.ts`).
 *
 * Os tipos das funções são literais repetidos, e não importados de
 * `src/app/queue/queue-model.ts`: o módulo de strings não importa lógica de
 * aplicação em lugar nenhum do repositório.
 */

// ==================================================================
// Static strings (as const — chave inexistente é erro de compilação)
// ==================================================================

export const fila = {
  /** Título do painel (é o `aria-labelledby` da gaveta) */
  titulo: 'Fila de gerações',
  /** Linha de apoio sob o título */
  descricao:
    'Tudo o que foi pedido, na ordem em que vai rodar. A fila vive no ' +
    'servidor: recarregar a tela não perde nada.',
  /**
   * Rótulo do gatilho que abre a gaveta. É também o NOME ACESSÍVEL dele: o
   * texto visível já diz tudo ("Fila · 3"), e um `aria-label` por cima só
   * esconderia a contagem de quem usa leitor de tela.
   */
  abrir: 'Fila',
  /** Nome acessível do véu que fecha a gaveta ao clique */
  fecharAria: 'Fechar a fila de gerações',
  /** Rótulo do botão de fechar, no canto da gaveta */
  fechar: 'Fechar',
  /** Nenhum job no registro */
  vazia:
    'Nada na fila. O que você pedir aparece aqui, na ordem em que vai rodar.',
  /** Enquanto o primeiro snapshot do estúdio não chegou */
  carregando: 'Lendo a fila do servidor…',
  /** O `GET /api/studio` falhou */
  semServidor:
    'Não deu para ler a fila do servidor. Os jobs continuam lá — é a tela que ' +
    'está sem notícia.',

  // ── seções da lista ──────────────────────────────────────────
  secoes: {
    rodando: 'Rodando agora',
    naFila: 'Esperando a vez',
    encerrados: 'Encerrados',
  },

  // ── nomes dos seis status (server/job-queue.ts) ──────────────
  status: {
    'na-fila': 'na fila',
    gerando: 'gerando',
    pronto: 'pronto',
    falhou: 'falhou',
    cancelado: 'cancelado',
    interrompido: 'interrompido',
  },

  // ── ocupação do teto de admissão ─────────────────────────────
  teto: {
    rotulo: 'Ocupação',
    aria: 'Ocupação da fila de gerações',
    /** Por que a barra não conta jobs, e sim peso */
    nota:
      'A barra mede o PESO em voo contra o teto de chamadas simultâneas: um ' +
      'pedido de 4 saídas ocupa 4 vagas, não 1.',
    /** A limitação registrada em server/job-queue.ts (#inFlightWeight) */
    estimativa:
      'A folga é uma estimativa otimista — entre admitir e começar de fato há ' +
      'uma janela em que o semáforo já está mais cheio do que a barra diz.',
    origem: {
      option: 'teto fixado no código',
      env: 'teto vindo do ambiente',
      tier: 'teto vindo do plano da conta',
      default: 'teto padrão',
    },
  },

  // ── cancelamento ─────────────────────────────────────────────
  /**
   * Três graus, porque há três verdades diferentes sobre o dinheiro. O grau
   * some quando o job é terminal: não há o que cancelar.
   */
  cancelar: {
    /** Job ainda na fila: um clique basta */
    acaoLivre: 'Cancelar',
    /** Job em execução: pressionar-e-segurar, como apagar bloco */
    acaoSegure: 'Segure para cancelar',
    emCurso: 'Cancelando…',
    /** Nada foi submetido — e o registro do job confirma isso (`paid: false`) */
    livre:
      'Este pedido ainda não foi submetido: cancelar agora não custa nada e ' +
      'não gasta geração nenhuma.',
    /**
     * `'na-fila'` com `paid: true`: o pedido refeito herdou a cobrança do
     * anterior (é o que `interrompido.comoRefazer` recomenda fazer). Dizer
     * "ainda não foi submetido" aqui seria falso — já foi, uma vez.
     */
    naFilaHerdado:
      'Este pedido está esperando a vez, mas herdou uma cobrança anterior: a ' +
      'geração que ele retoma já saiu uma vez. Cancelar tira da fila e não ' +
      'devolve o que já foi cobrado.',
    /** paid: true — cobrança confirmada no registro */
    pago:
      'Esta geração JÁ FOI COBRADA. Cancelar interrompe a espera e NÃO devolve ' +
      'o dinheiro. O identificador remoto fica guardado, e pedir de novo ' +
      're-sonda o que já foi pago em vez de submeter outra vez.',
    /** paid: false num job já em execução — "não consta" ≠ "de graça" */
    talvezPago:
      'Esta geração já entrou em execução. O registro ainda não acusa cobrança, ' +
      'mas “não consta” não é “de graça”: a submissão pode ter saído. Cancelar ' +
      'não devolve dinheiro nenhum.',
    /**
     * Cinco dos sete tipos de job não recebem o `AbortSignal` (`server/api.ts`),
     * então o cancelamento é imediato no registro e o trabalho em voo termina
     * sozinho. Não custa dinheiro; custa vaga, e a tela diz isso.
     */
    vagaDemora:
      'Neste tipo de trabalho o cancelamento aparece na hora, mas a vaga na ' +
      'fila só volta quando o que já está em voo terminar sozinho.',
  },

  // ── 'interrompido' ───────────────────────────────────────────
  /**
   * O estado que ninguém entende sem explicação: não é falha, é o servidor
   * tendo parado no meio. A fila se recusa a refazer sozinha porque refazer
   * pode cobrar de novo — a decisão é do usuário, e a tela precisa dizer isso
   * inteiro.
   */
  interrompido: {
    titulo: 'Interrompido por um reinício do servidor',
    explicacao:
      'O servidor parou com esta geração em voo. Ela pode ter sido cobrada, e ' +
      'a fila não refaz sozinha justamente para não cobrar de novo: quem ' +
      'decide é você.',
    /** O que acontece quando o usuário pede de novo */
    comoRefazer:
      'Pedir de novo é seguro: o pedido novo herda o que já foi pago e o ' +
      'identificador remoto, então ele re-sonda em vez de submeter outra vez.',
  },

  /** Dinheiro que saiu e não virou arquivo */
  pagoSemArtefato: 'cobrado, sem artefato',
  pagoSemArtefatoNota:
    'Esta geração foi cobrada e não entregou arquivo. O registro fica guardado ' +
    'de propósito — é o caminho de volta ao que já foi pago.',

  // ── ir até a tela que refaz ──────────────────────────────────
  refazer: {
    acao: 'Ir para gerar de novo',
    /** Quando a chave do job não diz de quem ele é */
    semDestino:
      'Não dá para dizer de que tela este job veio — a chave dele não segue ' +
      'nenhuma das convenções conhecidas.',
    /** O painel muda de aba, não de seção dentro do Laboratório */
    notaSecao:
      'O painel leva até a aba; a seção dentro dela você escolhe no topo.',
  },

  // ── notas de rodapé do painel ────────────────────────────────
  /** Por que a fila sobrevive ao F5 */
  notaPersistencia:
    'A fila é do servidor e sobrevive a recarregar a página. Fechar o navegador ' +
    'não cancela nada.',
  /**
   * Onde este painel existe. Ele é montado no cabeçalho do estúdio
   * (`src/app/shell.tsx`, rota `#/personagem`) e em lugar nenhum mais: quem
   * está no editor de mapa não tem gaveta de fila na tela. A fila é a MESMA —
   * é o painel que não vai junto.
   */
  notaEscopo:
    'A fila é única: o que o editor de mapa pedir entra nela também. Este ' +
    'painel, porém, só existe aqui no estúdio — no editor de mapa não há onde ' +
    'abri-lo.',
} as const;

// ==================================================================
// Parameterised strings (funções com nomes descritivos)
// ==================================================================

/** "3º na fila" — posição FIFO (1 = próximo a entrar). */
export const posicaoNaFila = (posicao: number): string => `${posicao}º na fila`;

/** "Fila · 3" — rótulo do gatilho quando há trabalho ativo. */
export const gatilhoComAtivos = (ativos: number): string =>
  `${fila.abrir} · ${ativos}`;

/** "2 rodando · 3 esperando" — resumo no topo da gaveta. */
export const resumoDaFila = (rodando: number, naFila: number): string => {
  const a = rodando === 1 ? '1 rodando' : `${rodando} rodando`;
  const b = naFila === 1 ? '1 esperando' : `${naFila} esperando`;
  return `${a} · ${b}`;
};

/** "3 de 8 vagas" — rótulo numérico da barra de ocupação. */
export const ocupacaoTexto = (emVoo: number, teto: number): string =>
  `${emVoo} de ${teto} ${teto === 1 ? 'vaga' : 'vagas'}`;

/** "teto padrão" → frase completa da origem do teto. */
export const origemDoTeto = (
  origem: 'option' | 'env' | 'tier' | 'default',
): string => fila.teto.origem[origem];

/** Nome acessível do botão de cancelar de uma linha. */
export const cancelarAria = (label: string): string => `Cancelar “${label}”`;

/** Nome acessível do botão que leva à tela que refaz o job. */
export const refazerAria = (label: string): string =>
  `Ir para a tela que refaz “${label}”`;

/**
 * De quem é o job, em uma linha — lido da CHAVE, que é onde o dono mora
 * (`src/app/job-scope.ts`). O `personagem` já vem resolvido para o rótulo
 * quando a tela conhece o personagem; senão é o id mesmo.
 */
export const escopoWizard = (
  personagem: string,
  etapa: 'sul' | 'direcoes8' | 'cardeais',
): string => {
  const nome =
    etapa === 'sul'
      ? 'face sul'
      : etapa === 'direcoes8'
        ? '8 direções'
        : 'cardeais (formato antigo)';
  return `Wizard · ${nome} de ${personagem}`;
};

export const escopoPose = (personagem: string, pose: string): string =>
  `Poses · ${pose} de ${personagem}`;

export const escopoPeca = (personagem: string, peca: string): string =>
  `Itens · ${peca} de ${personagem}`;

export const escopoBancada = (bancada: 'sprite-lab' | 'world-block'): string =>
  bancada === 'sprite-lab'
    ? 'Laboratório · Sprite sul (v3)'
    : 'Laboratório · Blocos do mundo';

/** Chave que não segue convenção nenhuma — dito sem fingir que segue. */
export const escopoDesconhecido = (chave: string): string =>
  `Origem desconhecida · ${chave}`;

/**
 * O que o `DELETE /api/jobs/:key` respondeu, dito sem eufemismo.
 *
 * Cinco frases porque são cinco verdades diferentes, e a única que fala em
 * "nada foi cobrado" é a do job que saiu da fila com o registro limpo. Um
 * pedido refeito sai da fila do mesmo jeito e carrega dinheiro herdado — o
 * servidor responde `paid: false` literal nesse ramo, então quem sabe é o
 * registro do lado da tela (`QueueRow.paid`).
 */
export const resultadoDoCancelamento = (
  resultado: 'removed' | 'aborted' | 'already-finished' | 'unknown',
  detalhe?: { readonly pago?: boolean; readonly status?: string },
): string => {
  switch (resultado) {
    case 'removed':
      return detalhe?.pago === true
        ? 'Saiu da fila antes de rodar desta vez. Mas este pedido herdava uma ' +
            'cobrança anterior: o que já tinha sido cobrado continua cobrado, e ' +
            'o identificador remoto segue guardado para quando você retomar.'
        : 'Cancelado antes de rodar — nada foi cobrado.';
    case 'aborted':
      return detalhe?.pago === true
        ? 'Cancelado depois da submissão. A geração já tinha sido cobrada e o ' +
            'dinheiro não volta; o identificador remoto ficou guardado para ' +
            'quando você quiser retomar.'
        : 'Cancelado durante a execução. O registro não acusa cobrança, mas a ' +
            'submissão pode ter saído — nada é devolvido.';
    case 'already-finished':
      return detalhe?.status !== undefined
        ? `Chegou tarde: o job já tinha terminado (${detalhe.status}). Nada foi cancelado.`
        : 'Chegou tarde: o job já tinha terminado. Nada foi cancelado.';
    case 'unknown':
      return 'O servidor respondeu algo que esta tela não sabe ler. Assuma que ' +
        'a geração pode ter sido cobrada e confira a lista antes de pedir de novo.';
  }
};

/** Falha do próprio DELETE (rede, 404, 400). */
export const cancelamentoFalhou = (mensagem: string): string =>
  `Não deu para cancelar: ${mensagem}`;

/** "Abra a aba Poses e peça de novo." */
export const ondeRefazer = (aba: string): string =>
  `Abra a aba ${aba} e peça de novo.`;
