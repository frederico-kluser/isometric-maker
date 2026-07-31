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
