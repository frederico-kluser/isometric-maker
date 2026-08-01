/**
 * Strings da aba Itens — guarda-roupa e equipamento.
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016).
 *
 * Todo texto visível da tela vive aqui — a tela não carrega literal de UI.
 * Exceção deliberada: o placeholder do campo de edição é em inglês porque o
 * valor digitado ali É o prompt enviado à geração (ver `criar.edicaoPlaceholder`).
 */
import type { Silhouette, WardrobeSlot } from '../../server/model.ts';

export const itens = {
  /** Cabeçalho do painel */
  titulo: 'Itens',
  /** Nota discreta sob o título: o que uma peça é e onde ela vale */
  notaGuardaRoupa:
    'Cada peça é uma edição aplicada sobre o corpo base e propagada nas oito ' +
    'direções. Serve em qualquer personagem da mesma silhueta — a combinação ' +
    'errada é recusada antes de gerar.',
  /** Rótulo de acessibilidade do seletor de personagem */
  personagem: 'Personagem',
  /** Botão que abre o cadastro guiado */
  novaPeca: 'Nova peça',
  /** Texto de acessibilidade do estado de carregamento */
  carregando: 'Carregando o guarda-roupa…',
  /** Rótulos dos slots de equipamento */
  slots: {
    cabeca: 'Cabeça',
    torso: 'Torso',
    pernas: 'Pernas',
    pes: 'Pés',
    maos: 'Mãos',
    arma: 'Arma',
    costas: 'Costas',
  },
  /** Rótulos das silhuetas */
  silhuetas: {
    'humano-medio': 'Humano médio',
    'humano-corpulento': 'Humano corpulento',
    'humano-esguio': 'Humano esguio',
    quadrupede: 'Quadrúpede',
  },
  /** Estado vazio do guarda-roupa */
  vazio: {
    titulo: 'Nenhuma peça cadastrada ainda',
    texto:
      'O guarda-roupa é onde nascem roupas, armaduras e acessórios: cada peça ' +
      'é uma edição aplicada sobre o corpo base e propagada nas oito direções.',
    cta: 'Cadastrar a primeira peça',
  },
  /** Linha de estado de uma peça para o personagem selecionado */
  estado: {
    vazio: 'Ainda não gerada para este personagem.',
    gerando: 'Gerando — leva de 2 a 5 minutos.',
    pronto: 'Gerada para este personagem.',
    falhou: 'A geração falhou.',
    semBase: 'Precisa do modelo base deste personagem.',
  },
  /** Botão de geração e seus bloqueios */
  gerar: {
    idle: 'Gerar',
    working: 'Gerando…',
    done: 'Pronta',
    retry: 'Tentar de novo',
    /** Tooltip: personagem sem modelo base remoto */
    semBase:
      'Gere o modelo base deste personagem primeiro — a peça é aplicada sobre ele.',
    /** Tooltip: peça já gerada (célula pronta não gera de novo) */
    jaGerada: 'Esta peça já está gerada para este personagem.',
    /** Badge de silhueta incompatível */
    naoServe: 'Não serve neste corpo',
  },
  /** Disparo em lote das peças pendentes */
  lote: {
    /** Botão que dispara todas as peças pendentes que servem na silhueta */
    gerarTodas: 'Gerar todas as pendentes',
    /** Botão enquanto os pedidos do lote estão saindo */
    colocandoNaFila: 'colocando na fila…',
    /** Botão quando todos os pedidos do lote falharam (estado transitório) */
    erroEnvio: 'Falhou ao pedir',
    /** Tooltip do botão de lote quando não há peça pendente */
    nadaPendente: 'nenhuma peça pendente para este personagem',
  },
  /** Sheet de criação guiada */
  criar: {
    titulo: 'Cadastrar peça',
    fechar: 'Fechar',
    voltar: 'Voltar',
    continuar: 'Continuar',
    cadastrar: 'Cadastrar peça',
    cadastrando: 'Cadastrando…',
    passoNomeTitulo: 'Como a peça se chama?',
    passoNomeTexto: 'É o nome que aparece nos cards do guarda-roupa.',
    nomeLabel: 'Nome da peça',
    /** Exemplo em pt-BR — o usuário digita o que quiser */
    nomePlaceholder: 'Cota de malha enferrujada',
    passoSlotTitulo: 'Onde ela é vestida?',
    slotLabel: 'Slot de equipamento',
    passoEdicaoTitulo: 'O que muda no corpo?',
    edicaoLabel: 'Edição (em inglês — é o prompt)',
    /**
     * Placeholder do prompt de edição. O valor deste campo é enviado à
     * geração — o exemplo fica em inglês de propósito e NÃO deve ser traduzido.
     */
    edicaoPlaceholder: 'wearing a rusted chainmail hauberk',
    edicaoHint:
      'Escreva em inglês: este texto é o prompt aplicado sobre o corpo base ' +
      'nas oito direções.',
    manterPaleta: 'Manter paleta do corpo',
    manterPaletaHint:
      'A peça herda as cores do corpo base em vez de inventar cores novas.',
    resumoNome: 'Nome',
    resumoSlot: 'Slot',
  },
  /** Detalhe expandido da peça */
  detalhe: {
    fechar: 'Fechar',
    direcoesTitulo: 'Prévia nas oito direções',
    passeMouse: 'Passe o mouse sobre uma direção para animar o ciclo.',
    promptTitulo: 'Prompt de edição',
    silhuetaTitulo: 'Silhueta da peça',
    paletaTitulo: 'Paleta',
    paletaSim: 'Mantém a paleta do corpo',
    paletaNao: 'Paleta livre — não herda as cores do corpo',
    seedTitulo: 'Seed',
  },
  /** Prefixo da mensagem quando o POST de geração falha */
  erroGerar: 'Não consegui iniciar a geração.',
  /** Sheet de importação — idêntico ao de poses.ts, cada tela é dona das suas */
  importar: {
    /** Botão no cabeçalho que abre o sheet de importação */
    botao: 'Importar personagem (JSON)',
    /** Título do sheet */
    titulo: 'Importar personagem de um JSON',
    /** Rótulo acessível do botão de fechar o sheet */
    fechar: 'Fechar',
    /** Texto curto: o que a importação aceita e de onde vêm os arquivos */
    explicacao:
      'Importa o JSON exportado pelo Wizard (personagem com as 8 direções ' +
      'prontas) ou a pose sul exportada pelo Laboratório — nesse caso o ' +
      'personagem novo continua no Wizard, na etapa das direções.',
    /** Rótulo do campo de nome do personagem novo */
    nomeLabel: 'Nome do novo personagem',
    /** Placeholder do campo de nome — exemplo em pt-BR */
    nomePlaceholder: 'Cavaleiro andarilho',
    /** Rótulo do seletor de arquivo */
    arquivoLabel: 'Arquivo JSON',
    /** Botão do seletor enquanto nenhum arquivo foi escolhido */
    arquivoEscolher: 'Escolher arquivo .json…',
    /** Botão de envio */
    enviar: 'Importar personagem',
    /** Botão enquanto a importação está em andamento */
    enviando: 'importando…',
    /** Botão logo após a importação bem-sucedida */
    importado: 'Personagem importado',
    /** Botão quando a importação falhou (estado transitório) */
    erroEnvio: 'Não foi possível importar',
    /** Erro quando o arquivo escolhido não é um JSON válido */
    arquivoInvalido: 'Não consegui ler este arquivo — não é um JSON válido.',
    /** Erro quando o JSON não é um dos bundles exportados pelo estúdio */
    kindInvalido:
      'Este JSON não é um personagem exportado pelo estúdio. A importação ' +
      'aceita só o JSON do Wizard (sprite-wizard-directions) ou o do ' +
      'Laboratório (sprite-lab-south).',
  },
} as const;

// Completude em tempo de compilação: toda silhueta e todo slot do model têm
// rótulo. Se o model ganhar um valor novo, o typecheck aponta aqui.
const _slotsCompletos: Record<WardrobeSlot, string> = itens.slots;
const _silhuetasCompletas: Record<Silhouette, string> = itens.silhuetas;
void _slotsCompletos;
void _silhuetasCompletas;

/** "Passo 2 de 3" — indicador do cadastro guiado */
export const passoAtual = (atual: number, total: number): string =>
  `Passo ${atual} de ${total}`;

/** "Feita para Humano esguio — este personagem é Humano médio." */
export const silhuetaIncompativelDetalhe = (
  itemSilhouette: string,
  charSilhouette: string,
): string => `Feita para ${itemSilhouette} — este personagem é ${charSilhouette}.`;

/** Tooltip do botão de geração bloqueado por silhueta incompatível */
export const tooltipSilhuetaIncompativel = (
  itemSilhouette: string,
  charSilhouette: string,
): string =>
  `A peça é ${itemSilhouette} e o personagem é ${charSilhouette}. ` +
  'Peça só vale dentro da mesma silhueta.';

/** Nome acessível do card: "Cota de malha enferrujada, Torso. Abrir detalhes." */
export const ariaAbrirDetalhe = (label: string, slotLabel: string): string =>
  `${label}, ${slotLabel}. Abrir detalhes.`;

/**
 * "3 de 5 gerações em andamento — …" — contador do disparo em lote, lido de
 * studio.jobs. Só aparece quando o total passa do andamento, então "gerações"
 * é sempre plural aqui.
 */
export const progressoGeracoes = (emAndamento: number, total: number): string =>
  `${emAndamento} de ${total} gerações em andamento — levam de 2 a 5 minutos ` +
  'e as prévias atualizam sozinhas.';

/** "3 gerações em andamento — …" — contador sem lote rastreado (ex.: página recarregada no meio). */
export const geracoesEmAndamento = (n: number): string =>
  n === 1
    ? '1 geração em andamento — leva de 2 a 5 minutos e as prévias atualizam sozinhas.'
    : `${n} gerações em andamento — levam de 2 a 5 minutos e as prévias atualizam sozinhas.`;

/**
 * "3 peças na fila · 2 já prontas" — resumo do disparo em lote. Peça de
 * silhueta incompatível nunca entra em nenhuma contagem: ela nem candidata
 * era. Cada parte extra só entra quando é maior que zero; a fila é a manchete
 * e aparece sempre. `primeiraFalha` é a mensagem do servidor quando algum
 * pedido nem entrou na fila.
 */
export const resumoDisparoPecas = (
  naFila: number,
  jaProntas: number,
  emAndamento: number,
  falhas: number,
  primeiraFalha?: string,
): string => {
  const partes = [
    naFila === 1 ? '1 peça na fila' : `${naFila} peças na fila`,
  ];
  if (jaProntas > 0) {
    partes.push(jaProntas === 1 ? '1 já pronta' : `${jaProntas} já prontas`);
  }
  if (emAndamento > 0) {
    partes.push(
      emAndamento === 1 ? '1 já em andamento' : `${emAndamento} já em andamento`,
    );
  }
  if (falhas > 0) {
    partes.push(
      falhas === 1 ? '1 não entrou na fila' : `${falhas} não entraram na fila`,
    );
  }
  const resumo = partes.join(' · ');
  return primeiraFalha !== undefined ? `${resumo}: ${primeiraFalha}` : resumo;
};
