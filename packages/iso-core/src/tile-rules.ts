/**
 * Parser de tile_rules — F2-04.
 *
 * Converte as regras de posicionamento que a API devolve (formato livre,
 * `additionalProperties: true` no spec) num formato tipado e verificável.
 *
 * ## Suposições (ABERTO)
 *
 * A fixture real de E4 não foi gerada.  Todas as suposições abaixo são
 * marcadas com `// ABERTO AB-nnn` e devem ser verificadas contra uma resposta
 * real da API antes de o autoladrilhamento (F2-08) entrar em produção.
 *
 * - **AB-370**: O shape completo de `tile_rules` — os campos listados aqui
 *   (`tile_index`, `rule_type`, `arity`, `connectivity`, `terrains`, `mask`)
 *   são inferidos da descrição em prosa no spec e podem não corresponder ao
 *   payload real.  `additionalProperties: true` significa que o parser tem de
 *   rejeitar campos que não reconhece.
 * - **AB-371**: A máscara para `edge/4` é um inteiro de 4 bits onde
 *   `bit0 = Norte, bit1 = Leste, bit2 = Sul, bit3 = Oeste` (convenção F2-02).
 *   A ordem real dos bits não está documentada em lado nenhum.
 * - **AB-372**: A identificação de porta, pilar e escada é feita por
 *   heurística sobre o nome do terreno (`terrains`).  A API pode ter um campo
 *   `tile_kind` ou `tile_role` não documentado que torna esta heurística
 *   obsoleta.
 * - **AB-373**: O campo `mask` para `corner/4` e `outline/4` segue a mesma
 *   convenção de bits que `edge/4`.  A semântica de corners pode ser
 *   diferente (ex.: dois bits por canto).
 * - **AB-374**: `connectivity: 'other'` indica que a peça faz a transição
 *   entre dois terrenos diferentes.  O spec menciona mas não exemplifica.
 * - **AB-375**: `arity: 6` é para hexágonos.  A máscara de 6 bits não tem
 *   convenção estabelecida neste projecto (não usamos hexágonos).
 */

import type { EdgeSide } from './map.ts';

// ------------------------------------------------------------------ tipos raw (como vêm da API)

/** Regra de posicionamento tal como a API a devolve. */
export interface RawTileRule {
  /** Índice do tile no array `tiles` da resposta. */
  readonly tile_index: number;
  /** Tipo de regra: aresta, canto ou contorno. */
  readonly rule_type: 'edge' | 'corner' | 'outline';
  /** Número de lados considerados: 4 (quadrado/isométrico) ou 6 (hex). */
  readonly arity: 4 | 6;
  /** Conectividade: `same` (mesmo terreno) ou `other` (terrenos diferentes). */
  readonly connectivity: 'same' | 'other';
  /** Terrenos envolvidos.  Para `same`, um elemento; para `other`, dois. */
  readonly terrains: readonly string[];
  /**
   * Máscara de bits.
   *
   * Para `edge/4`: 4 bits (0–15).  Cada bit representa um lado.
   *   ABERTO AB-371: bit0=N, bit1=L, bit2=S, bit3=O (convenção F2-02).
   */
  readonly mask: number;
}

/** Resposta completa de GET /tiles-pro/{tile_id}. */
export interface RawTilesProResponse {
  readonly tile_id: string;
  readonly kind: string;
  readonly tiles: ReadonlyArray<{
    readonly index: number;
    readonly label?: string;
    readonly storage_url: string;
  }>;
  readonly tile_rules: readonly RawTileRule[];
}

// ------------------------------------------------------------------ tipos processados

/** Uma regra de posicionamento processada e validada. */
export interface TileRule {
  readonly tileIndex: number;
  readonly ruleType: 'edge' | 'corner' | 'outline';
  readonly arity: 4 | 6;
  readonly connectivity: 'same' | 'other';
  readonly terrains: readonly string[];
  /** Máscara de bits (4 ou 6 bits, dependendo de `arity`). */
  readonly mask: number;
  /**
   * Lados activos (apenas para `edge/4`).
   *
   * Derivado da máscara: um array com os lados cujo bit está a 1.
   *   ABERTO AB-371: bit0=N, bit1=L, bit2=S, bit3=O.
   */
  readonly activeSides: readonly EdgeSide[];
}

/**
 * Classificação heurística de uma peça do kit de construção.
 *
 *   ABERTO AB-372: identificação por nome de terreno, não por campo da API.
 */
export type TileHeuristic =
  | { readonly kind: 'floor' }
  | { readonly kind: 'wall' }
  | { readonly kind: 'doorway' }
  | { readonly kind: 'pillar' }
  | { readonly kind: 'staircase' }
  | { readonly kind: 'unknown'; readonly terrains: readonly string[] };

// ------------------------------------------------------------------ erros

/** Erro lançado quando um campo desconhecido aparece na resposta da API. */
export class UnknownTileRuleFieldError extends Error {
  public readonly field: string;

  constructor(field: string) {
    super(
      `Campo desconhecido em tile_rules: "${field}". ` +
        `O spec declara additionalProperties: true — ` +
        `este parser rejeita campos que não reconhece para evitar ` +
        `processamento silencioso de dados que podem alterar o comportamento. ` +
        `Adicione o campo ao tipo RawTileRule ou verifique se a API mudou.`,
    );
    this.name = 'UnknownTileRuleFieldError';
    this.field = field;
  }
}

/** Erro lançado quando um tile_index referencia um tile que não existe. */
export class InvalidTileIndexError extends Error {
  public readonly tileIndex: number;
  public readonly maxIndex: number;

  constructor(tileIndex: number, maxIndex: number) {
    super(
      `tile_index ${tileIndex} referencia um tile que não existe ` +
        `(índices válidos: 0–${maxIndex}).`,
    );
    this.name = 'InvalidTileIndexError';
    this.tileIndex = tileIndex;
    this.maxIndex = maxIndex;
  }
}

// ------------------------------------------------------------------ validação

/** Campos conhecidos de uma RawTileRule. */
const KNOWN_TILE_RULE_FIELDS = new Set([
  'tile_index',
  'rule_type',
  'arity',
  'connectivity',
  'terrains',
  'mask',
]);

/** Valores válidos para rule_type. */
const VALID_RULE_TYPES = new Set(['edge', 'corner', 'outline']);

/** Valores válidos para connectivity. */
const VALID_CONNECTIVITIES = new Set(['same', 'other']);

/**
 * Verifica se um objecto tem campos desconhecidos e lança
 * `UnknownTileRuleFieldError` se encontrar algum.
 */
function checkUnknownFields(
  obj: Record<string, unknown>,
  knownFields: Set<string>,
  context: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!knownFields.has(key)) {
      throw new UnknownTileRuleFieldError(key);
    }
  }
}

// ------------------------------------------------------------------ parse

/**
 * Converte uma RawTileRule num TileRule processado.
 *
 * Valida:
 *   - Campos desconhecidos → UnknownTileRuleFieldError
 *   - rule_type inválido → Error
 *   - arity inválida → Error
 *   - connectivity inválida → Error
 *   - mask fora do intervalo para a arity → Error
 *   - tile_index referenciando tile inexistente → InvalidTileIndexError
 *
 * Mapeia a máscara para lados activos usando a convenção F2-02:
 *   ABERTO AB-371: bit0=N, bit1=L, bit2=S, bit3=O.
 */
export function parseTileRule(
  raw: RawTileRule,
  maxTileIndex: number,
): TileRule {
  // Verifica campos desconhecidos
  checkUnknownFields(
    raw as unknown as Record<string, unknown>,
    KNOWN_TILE_RULE_FIELDS,
    'RawTileRule',
  );

  // Valida rule_type
  if (!VALID_RULE_TYPES.has(raw.rule_type)) {
    throw new Error(
      `rule_type inválido: "${raw.rule_type}". ` +
        `Valores aceites: edge, corner, outline.`,
    );
  }

  // Valida arity
  if (raw.arity !== 4 && raw.arity !== 6) {
    throw new Error(
      `arity inválida: ${raw.arity}. Valores aceites: 4, 6.`,
    );
  }

  // Valida connectivity
  if (!VALID_CONNECTIVITIES.has(raw.connectivity)) {
    throw new Error(
      `connectivity inválida: "${raw.connectivity}". ` +
        `Valores aceites: same, other.`,
    );
  }

  // Valida mask (intervalo)
  const maxMask = raw.arity === 4 ? 15 : 63; // 4 bits ou 6 bits
  if (!Number.isInteger(raw.mask) || raw.mask < 0 || raw.mask > maxMask) {
    throw new Error(
      `mask inválida: ${raw.mask}. ` +
        `Para arity=${raw.arity}, a máscara deve ser um inteiro entre 0 e ${maxMask}.`,
    );
  }

  // Valida tile_index
  if (raw.tile_index < 0 || raw.tile_index > maxTileIndex) {
    throw new InvalidTileIndexError(raw.tile_index, maxTileIndex);
  }

  // Deriva lados activos (apenas para edge/4 e corner/4)
  // ABERTO AB-371: bit0=N, bit1=L, bit2=S, bit3=O
  const activeSides: EdgeSide[] = [];
  if (raw.arity === 4) {
    const sideMap: [EdgeSide, number][] = [
      ['N', 1], // bit0
      ['L', 2], // bit1
      ['S', 4], // bit2
      ['O', 8], // bit3
    ];
    for (const [side, bit] of sideMap) {
      if (raw.mask & bit) {
        activeSides.push(side);
      }
    }
  }
  // ABERTO AB-375: arity 6 sem mapeamento definido.

  return {
    tileIndex: raw.tile_index,
    ruleType: raw.rule_type,
    arity: raw.arity,
    connectivity: raw.connectivity,
    terrains: raw.terrains,
    mask: raw.mask,
    activeSides,
  };
}

/**
 * Faz parse de todas as tile_rules de uma resposta tiles-pro.
 *
 * @returns Array de TileRule processadas.
 */
export function parseTileRules(response: RawTilesProResponse): TileRule[] {
  const maxTileIndex = response.tiles.length - 1;
  return response.tile_rules.map((raw) => parseTileRule(raw, maxTileIndex));
}

// ------------------------------------------------------------------ heurísticas

/**
 * Classifica uma peça do kit de construção por heurística.
 *
 *   ABERTO AB-372: A identificação é feita pelo nome do terreno (`terrains`),
 *   não por um campo dedicado da API.  Se a API tiver um campo `tile_kind`
 *   ou `tile_role`, esta função deve ser reescrita para o usar.
 *
 * Heurísticas actuais:
 *   - Terrain contém "floor" → floor
 *   - Terrain contém "door" → doorway
 *   - Terrain contém "pillar" → pillar
 *   - Terrain contém "stair" → staircase
 *   - Terrain contém "wall" → wall
 *   - Nenhuma das anteriores → unknown
 */
export function classifyTileHeuristic(rule: TileRule): TileHeuristic {
  const terrainsLower = rule.terrains.map((t) => t.toLowerCase());

  for (const t of terrainsLower) {
    if (t.includes('door')) return { kind: 'doorway' };
    if (t.includes('pillar')) return { kind: 'pillar' };
    if (t.includes('stair')) return { kind: 'staircase' };
  }

  for (const t of terrainsLower) {
    if (t.includes('floor')) return { kind: 'floor' };
    if (t.includes('wall')) return { kind: 'wall' };
  }

  return { kind: 'unknown', terrains: rule.terrains };
}

/**
 * Classifica todas as regras e devolve um conjunto com os tipos encontrados.
 *
 * Útil para saber se o kit tem porta, pilar e escada — as três peças que
 * o spec menciona mas não tipa.
 */
export function classifyKit(
  rules: readonly TileRule[],
): Set<TileHeuristic['kind']> {
  const kinds = new Set<TileHeuristic['kind']>();
  for (const rule of rules) {
    const h = classifyTileHeuristic(rule);
    kinds.add(h.kind);
  }
  return kinds;
}
