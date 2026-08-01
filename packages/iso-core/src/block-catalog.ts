/**
 * Catálogo de blocos e materiais — o que o mapa precisa saber para ter física.
 *
 * ## O problema que isto resolve
 *
 * O `BlockStore` guarda uma string por célula. Para desenhar, basta: a string é
 * a chave da textura. Para física, não basta nada: "grama" não diz se afunda, se
 * escorrega, se dá para escalar. E física escrita em cima de `if (tipo ===
 * 'agua')` espalhada pelo código é física que ninguém consegue mudar depois.
 *
 * A separação aqui é a mesma que o Tiled faz entre *tileset* e *layer*: a
 * **definição** do bloco existe uma vez, no catálogo; a **instância** é só uma
 * posição apontando para ela. Um mapa de dez mil células com cinco tipos guarda
 * cinco definições, não dez mil.
 *
 * **Só a separação definição/instância tem respaldo externo** — o Tiled a
 * documenta e a pesquisa desta tarefa a confirmou. A tabela de materiais com
 * atrito, densidade e custo de movimento é **decisão deste projeto**: a mesma
 * pesquisa não encontrou nenhuma fonte que sobrevivesse à verificação sobre
 * quais propriedades físicas um tile map deve carregar. Os números abaixo são
 * ponto de partida plausível, não convenção herdada.
 *
 * ## Por que a instância carrega tipo e material COPIADOS
 *
 * `enumerateBlocks` devolve `kind` e `material` já resolvidos em cada instância,
 * em vez de só o `blockId`. É redundante de propósito: quem escreve física não
 * deveria precisar carregar o catálogo junto para saber se uma célula é sólida.
 * O custo é uma string a mais por célula na exportação; o benefício é que o
 * consumidor da física lê um registro autocontido.
 */

// ---------------------------------------------------------------- materiais

/**
 * O que um bloco é feito.
 *
 * A lista é curta de propósito. Material não é aparência — dois blocos de
 * pedra com texturas diferentes compartilham o material `pedra`. Aparência é
 * o `blockId`.
 */
export const MATERIAL_IDS = [
  'terra',
  'grama',
  'pedra',
  'areia',
  'madeira',
  'metal',
  'gelo',
  'agua',
  'lava',
  'vidro',
  'folhagem',
] as const;
export type MaterialId = (typeof MATERIAL_IDS)[number];

export interface Material {
  readonly id: MaterialId;
  /** Nome em pt-BR — é o que o editor mostra. */
  readonly label: string;
  /** Ocupa a célula e barra a passagem. `false` é água, folhagem, vidro quebrado. */
  readonly solid: boolean;
  /** 0 = escorrega sem parar, 1 = agarra. Gelo baixo, folhagem alto. */
  readonly friction: number;
  /** kg/m³ aproximado. Serve para peso, empuxo e som de impacto. */
  readonly density: number;
  /**
   * Custo de atravessar uma célula, relativo. `1` é terreno neutro,
   * `Infinity` é intransponível para quem anda.
   */
  readonly movementCost: number;
  /** Causa dano ao ser tocado. Só a lava, por enquanto. */
  readonly harmful: boolean;
}

/**
 * Tabela de materiais.
 *
 * **Números escolhidos por este projeto, não medidos nem citados.** Estão aqui
 * para que a física tenha de onde partir e para que ajustá-la seja mexer numa
 * tabela em vez de caçar constantes pelo código. As densidades são as ordens de
 * grandeza reais dos materiais; atrito e custo são relativos e arbitrários.
 */
export const MATERIALS: Readonly<Record<MaterialId, Material>> = Object.freeze({
  terra: { id: 'terra', label: 'Terra', solid: true, friction: 0.8, density: 1500, movementCost: 1, harmful: false },
  grama: { id: 'grama', label: 'Grama', solid: true, friction: 0.85, density: 1400, movementCost: 1, harmful: false },
  pedra: { id: 'pedra', label: 'Pedra', solid: true, friction: 0.9, density: 2600, movementCost: 1, harmful: false },
  areia: { id: 'areia', label: 'Areia', solid: true, friction: 0.7, density: 1600, movementCost: 1.5, harmful: false },
  madeira: { id: 'madeira', label: 'Madeira', solid: true, friction: 0.75, density: 700, movementCost: 1, harmful: false },
  metal: { id: 'metal', label: 'Metal', solid: true, friction: 0.6, density: 7800, movementCost: 1, harmful: false },
  gelo: { id: 'gelo', label: 'Gelo', solid: true, friction: 0.05, density: 920, movementCost: 1, harmful: false },
  agua: { id: 'agua', label: 'Água', solid: false, friction: 0.3, density: 1000, movementCost: 3, harmful: false },
  lava: { id: 'lava', label: 'Lava', solid: false, friction: 0.4, density: 3100, movementCost: Infinity, harmful: true },
  vidro: { id: 'vidro', label: 'Vidro', solid: true, friction: 0.4, density: 2500, movementCost: 1, harmful: false },
  folhagem: { id: 'folhagem', label: 'Folhagem', solid: false, friction: 0.9, density: 300, movementCost: 2, harmful: false },
});

export function isMaterialId(value: unknown): value is MaterialId {
  return typeof value === 'string' && (MATERIAL_IDS as readonly string[]).includes(value);
}

/** Material de um id, ou `terra` quando o id é desconhecido. */
export function materialOf(id: string): Material {
  return isMaterialId(id) ? MATERIALS[id] : MATERIALS.terra;
}

// ---------------------------------------------------------------- tipos de bloco

/**
 * O que o bloco É no mundo — ortogonal ao material.
 *
 * Pedra pode ser `solid` (um cubo maciço) ou `platform` (uma laje em que se
 * pisa por cima e se atravessa por baixo). Distinguir os dois é o que permite
 * ponte, escada e telhado sem inventar um material novo para cada um.
 */
export const BLOCK_KINDS = ['solid', 'platform', 'liquid', 'decoration'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/** Rótulos pt-BR — é o que o editor mostra. */
export const BLOCK_KIND_LABELS: Readonly<Record<BlockKind, string>> = Object.freeze({
  solid: 'Sólido',
  platform: 'Plataforma',
  liquid: 'Líquido',
  decoration: 'Decoração',
});

export function isBlockKind(value: unknown): value is BlockKind {
  return typeof value === 'string' && (BLOCK_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------- definição

/**
 * Uma peça da paleta: existe UMA vez, por mais que seja colocada mil vezes.
 */
export interface BlockDefinition {
  /** Identificador estável. É o que a célula guarda no `BlockStore`. */
  readonly id: string;
  /** Nome em pt-BR, mostrado na paleta. */
  readonly label: string;
  readonly kind: BlockKind;
  readonly material: MaterialId;
  /**
   * Hash do bloco gerado que fornece a arte, quando há arte gerada.
   * Ausente = peça procedural.
   */
  readonly sourceHash?: string;
}

/** Índice `id → definição`, para resolver instância em O(1). */
export type BlockCatalog = Readonly<Record<string, BlockDefinition>>;

export function makeCatalog(definitions: readonly BlockDefinition[]): BlockCatalog {
  const out: Record<string, BlockDefinition> = {};
  for (const d of definitions) out[d.id] = d;
  return Object.freeze(out);
}

/**
 * Definição de um id desconhecido.
 *
 * Um mapa pode referenciar uma peça que saiu do catálogo — o asset foi apagado,
 * o projeto veio de outra máquina. Devolver uma definição de reserva mantém o
 * mapa carregável e visivelmente errado, que é melhor que carregável e
 * silenciosamente diferente.
 */
export function fallbackDefinition(id: string): BlockDefinition {
  return { id, label: id, kind: 'solid', material: 'pedra' };
}

export function definitionOf(catalog: BlockCatalog, id: string): BlockDefinition {
  return catalog[id] ?? fallbackDefinition(id);
}

// ---------------------------------------------------------------- catálogo padrão

/**
 * Peças de reserva do editor, com tipo e material declarados.
 *
 * Os matizes moram no map-builder porque são aparência; o que está aqui é o que
 * a física precisa. Manter os dois separados é o que impede "a Água ficou roxa"
 * de virar "a Água ficou sólida".
 */
export const DEFAULT_BLOCKS: readonly BlockDefinition[] = Object.freeze([
  { id: 'grama', label: 'Grama', kind: 'solid', material: 'grama' },
  { id: 'terra', label: 'Terra', kind: 'solid', material: 'terra' },
  { id: 'pedra', label: 'Pedra', kind: 'solid', material: 'pedra' },
  { id: 'areia', label: 'Areia', kind: 'solid', material: 'areia' },
  { id: 'agua', label: 'Água', kind: 'liquid', material: 'agua' },
  { id: 'madeira', label: 'Madeira', kind: 'solid', material: 'madeira' },
]);

export const DEFAULT_CATALOG: BlockCatalog = makeCatalog(DEFAULT_BLOCKS);
