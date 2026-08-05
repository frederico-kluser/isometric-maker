/**
 * Strings da aba Poses — grade poses × 8 direções.
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016).
 *
 * A tela inteira lê daqui: nada de texto hardcoded no JSX.
 * Strings parametrizadas são funções exportadas ao final do arquivo,
 * com nomes descritivos — nenhuma é uma função t(chave).
 */
import type { Direction } from '../../server/model.ts';

// ==================================================================
// Static strings (as const — chave inexistente é erro de compilação)
// ==================================================================

export const poses = {
  // ── moldura ──────────────────────────────────────────────────
  /** Rótulo do seletor de personagem */
  characterLabel: 'Personagem',
  /** Aviso quando o servidor não tem o token da API */
  semToken: 'PIXELLAB_SECRET não definido — a tela funciona, mas nada gera',
  /** Prefixo do erro ao carregar o estado do estúdio */
  erroCarga: 'Não foi possível carregar o estúdio',

  // ── linha do modelo base ─────────────────────────────────────
  /** Nome da primeira linha da grade */
  baseTitle: 'Modelo base',
  /** Exibido quando o personagem ainda não tem remoteId */
  baseSemId: 'sem id remoto ainda',
  /** Dica na coluna de ação da linha base */
  basePeloWizard: 'A base é gerada no Wizard — as 8 direções aparecem aqui.',

  // ── grade ────────────────────────────────────────────────────
  /** Cabeçalho da seção da grade */
  gridTitle: 'Poses × 8 direções',
  /** Cabeçalho da coluna de pose */
  colPose: 'Pose',
  /** Cabeçalho da coluna de ação */
  colAction: 'Ação',
  /** Botão que abre o formulário de nova pose */
  novaPose: 'Nova pose',
  /** Título da célula ainda não gerada */
  statusVazio: 'vazio',
  /** Título da célula na fila */
  statusNaFila: 'na fila',
  /** Selo da célula cuja geração falhou */
  statusFalhou: 'falhou',
  /** Tooltip da célula falhada quando o servidor não mandou mensagem */
  erroDesconhecido: 'erro desconhecido',

  // ── gerar por pose ───────────────────────────────────────────
  /** Botão de geração da pose */
  gerar: 'Gerar',
  /** Botão enquanto o job está em andamento */
  gerando: 'gerando…',
  /** Botão quando a célula já está pronta (não gera de novo) */
  pronto: 'Pronto',
  /** Botão depois de uma falha — clicável para tentar de novo */
  tentarDeNovo: 'Tentar de novo',
  /** Botão quando o pedido ao servidor falhou (estado transitório) */
  erroEnvio: 'Falhou ao pedir',
  /** Tooltip do botão bloqueado por falta de modelo base */
  bloqueioSemBase: 'gere o modelo base no Wizard primeiro',

  // ── gerar todas as pendentes (lote) ──────────────────────────
  /** Botão que dispara todas as poses pendentes do personagem em paralelo */
  gerarTodasPendentes: 'Gerar todas as pendentes',
  /** Botão enquanto os pedidos do lote estão saindo */
  colocandoNaFila: 'colocando na fila…',
  /** Tooltip do botão de lote quando não há o que pedir */
  nadaPendente: 'nenhuma pose pendente — todas prontas ou em andamento',

  // ── tags da pose ─────────────────────────────────────────────
  /** Tag de pose embutida — não pode ser excluída */
  tagFixa: 'fixa',
  /** Tag de pose por template nativo */
  tagTemplate: 'template',
  /** Tag de pose por texto livre */
  tagTexto: 'texto livre',

  // ── excluir ──────────────────────────────────────────────────
  /** Botão de excluir pose (segurar para confirmar) */
  excluir: 'Excluir',
  /** Tooltip do botão de excluir */
  excluirHint: 'segure para excluir a pose',

  // ── formulário de nova pose (sheet) ──────────────────────────
  /** Título do formulário */
  formTitle: 'Cadastrar nova pose',
  /** Rótulo acessível do botão de fechar o sheet */
  fechar: 'Fechar',
  /** Rótulo do campo de nome */
  nomeLabel: 'Nome',
  /**
   * Placeholder do campo de nome.
   * Exemplo em pt-BR — o usuário digita o que quiser.
   */
  nomePlaceholder: 'Bloqueando com escudo',
  /** Rótulo do seletor de tipo de geração */
  kindLabel: 'Como gerar',
  /** Opção: template nativo */
  kindTemplate: 'Template nativo',
  /** Opção: texto livre */
  kindTexto: 'Texto livre',
  /** Rótulo do seletor de template */
  templateLabel: 'Template',
  /**
   * Rótulo do campo de ação.
   * O valor deste campo é um PROMPT enviado à API — o placeholder
   * está em inglês e NÃO deve ser traduzido.
   */
  acaoLabel: 'Ação (inglês, é o prompt)',
  /** Placeholder do campo de ação — é o prompt, fica em inglês */
  acaoPlaceholder: 'raising a shield to block',
  /** Rótulo do campo de FPS */
  fpsLabel: 'FPS',
  /** Rótulo da linha de frames (valor travado, sem edição) */
  framesLabel: 'Frames',
  /** Explicação quando ainda não existe lock do manequim */
  semLock:
    'O número de frames ainda não foi travado — o Wizard define e trava esse ' +
    'valor antes de gerar a base.',
  /**
   * Por que walk/run/jump vão por texto livre: são ids de template que a
   * biblioteca nativa NÃO tem — ficam em inglês por serem identificadores.
   */
  notaWalkRunJump:
    'Só existem 10 templates nativos, e walk, run e jump não estão entre eles — ' +
    'por isso pose de movimento vai por texto livre.',
  /** Botão de envio do formulário */
  cadastrar: 'Cadastrar pose',
  /** Botão enquanto o cadastro está em andamento */
  cadastrando: 'cadastrando…',
  /** Botão logo depois do cadastro bem-sucedido */
  cadastrada: 'Pose cadastrada',
  /** Botão quando o cadastro falhou (estado transitório) */
  erroCadastro: 'Não foi possível cadastrar',

  // ── importar personagem (JSON do Wizard/Laboratório) ─────────
  /** Sheet de importação — idêntico ao de itens.ts, cada tela é dona das suas */
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

// ==================================================================
// Parameterised strings (funções com nomes descritivos)
// ==================================================================

/** "id remoto abcd1234…" — identificador truncado do personagem na API */
export const idRemotoCurto = (id: string): string =>
  `id remoto ${id.slice(0, 12)}…`;

/** "8 frames · 12 fps" — detalhe da pose na grade */
export const framesEFps = (frames: number, fps: number): string =>
  `${frames} frames · ${fps} fps`;

/** "12 fps" — quando o frameCount efetivo ainda não existe (sem lock) */
export const apenasFps = (fps: number): string => `${fps} fps`;

/** "8 frames · travado pelo manequim" — selo do lock no formulário */
export const framesTravados = (frames: number): string =>
  `${frames} frames · travado pelo manequim`;

/** aria-label do botão de gerar de uma pose */
export const gerarPose = (label: string): string => `Gerar pose ${label}`;

/** aria-label do botão de excluir de uma pose */
export const excluirPose = (label: string): string =>
  `Excluir pose ${label}`;

/** "8 frames — passe o mouse para animar" — título da thumbnail animável */
export const hoverAnima = (frames: number): string =>
  `${frames} frames — passe o mouse para animar`;

/** "walking forward…" entre aspas — sinaliza que o detalhe é um prompt */
export const detalheAcao = (action: string): string => `"${action}"`;

/**
 * "3 de 5 gerações em andamento — …" — contador do disparo em lote, lido de
 * studio.jobs. Só aparece quando o total passa do andamento, então "gerações"
 * é sempre plural aqui.
 */
export const progressoGeracoes = (emAndamento: number, total: number): string =>
  `${emAndamento} de ${total} gerações na fila ou gerando — cada uma leva de ` +
  '2 a 5 minutos quando entra, e as células atualizam sozinhas.';

/** "3 gerações em andamento — …" — contador sem lote rastreado (ex.: página recarregada no meio). */
export const geracoesEmAndamento = (n: number): string =>
  n === 1
    ? '1 geração na fila ou gerando — leva de 2 a 5 minutos quando entra, e a ' +
      'célula atualiza sozinha.'
    : `${n} gerações na fila ou gerando — cada uma leva de 2 a 5 minutos quando ` +
      'entra, e as células atualizam sozinhas.';

/**
 * "4 poses na fila · 1 já pronta" — resumo do disparo em lote. Cada parte
 * extra só entra quando é maior que zero; a fila é a manchete e aparece
 * sempre. `primeiraFalha` é a mensagem do servidor quando algum pedido nem
 * entrou na fila.
 */
export const resumoDisparoPoses = (
  naFila: number,
  jaProntas: number,
  emAndamento: number,
  falhas: number,
  primeiraFalha?: string,
): string => {
  const partes = [
    naFila === 1 ? '1 pose na fila' : `${naFila} poses na fila`,
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

/**
 * Nome completo da direção em pt-BR — tooltip das colunas da grade e
 * texto alternativo das thumbnails (DIR_SHORT continua sendo o selo curto).
 */
export const DIRECTION_LABELS: Record<Direction, string> = {
  south: 'sul',
  'south-west': 'sudoeste',
  west: 'oeste',
  'north-west': 'noroeste',
  north: 'norte',
  'north-east': 'nordeste',
  east: 'leste',
  'south-east': 'sudeste',
};
