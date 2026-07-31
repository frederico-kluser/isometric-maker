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
  /** Aviso enquanto há geração em andamento (jobs levam minutos) */
  geracaoEmAndamento:
    'Geração em andamento — leva de 2 a 5 minutos e as células atualizam sozinhas.',

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
