/**
 * Autoladrilhamento por máscara de 4 bits — F2-08.
 *
 * Dado um bloco numa célula, calcula uma máscara de vizinhança de 4 bits
 * (convenção F2-04: bit0=Norte, bit1=Leste, bit2=Sul, bit3=Oeste) e
 * selecciona a peça correspondente nas regras devolvidas pela API.
 *
 * Combinação sem peça correspondente → ERRO visível.
 *
 * ## Regras
 *
 * - Consome tile_rules que a API devolveu (F2-04), NÃO escreve tabela à mão.
 * - Máscara de 4 bits: bit a 1 se o vizinho naquela direcção tem o MESMO
 *   terreno no MESMO nível z.
 * - Se o tileset não trouxer as 16 combinações, o editor DIZ quais faltam.
 * - Todo texto de erro em pt-BR.
 */

import { BlockStore } from '../../../../packages/iso-core/src/map.ts';
import type { TileRule } from '../../../../packages/iso-core/src/tile-rules.ts';

// ------------------------------------------------------------------ máscara

/**
 * Constrói a máscara de vizinhança de 4 bits para uma célula.
 *
 * Convenção F2-04 (ABERTO AB-371):
 *   - bit 0 (valor 1): vizinho Norte (x, y+1) tem o mesmo terreno?
 *   - bit 1 (valor 2): vizinho Leste (x+1, y) tem o mesmo terreno?
 *   - bit 2 (valor 4): vizinho Sul (x, y-1) tem o mesmo terreno?
 *   - bit 3 (valor 8): vizinho Oeste (x-1, y) tem o mesmo terreno?
 *
 * @param blocks - Estado actual dos blocos.
 * @param x - Coordenada x da célula.
 * @param y - Coordenada y da célula.
 * @param z - Nível vertical.
 * @param terrain - Terreno de referência (tipo de bloco na célula).
 * @returns Máscara de 4 bits (0–15).
 */
export function buildMask(
  blocks: BlockStore,
  x: number,
  y: number,
  z: number,
  terrain: string,
): number {
  let mask = 0;

  // Norte (y+1) → bit 0
  if (blocks.getBlock(x, y + 1, z) === terrain) {
    mask |= 1;
  }

  // Leste (x+1) → bit 1
  if (blocks.getBlock(x + 1, y, z) === terrain) {
    mask |= 2;
  }

  // Sul (y-1) → bit 2
  if (blocks.getBlock(x, y - 1, z) === terrain) {
    mask |= 4;
  }

  // Oeste (x-1) → bit 3
  if (blocks.getBlock(x - 1, y, z) === terrain) {
    mask |= 8;
  }

  return mask;
}

// ------------------------------------------------------------------ procura de peça

/**
 * Encontra a regra de posicionamento que corresponde a uma máscara e terreno.
 *
 * Procura entre as regras fornecidas uma cuja máscara seja igual à pedida
 * e cujo array `terrains` contenha o terreno indicado.
 *
 * @param rules - Regras devolvidas pela API (F2-04).
 * @param mask - Máscara de vizinhança (0–15).
 * @param terrain - Terreno a procurar.
 * @returns A regra correspondente, ou `undefined` se não existir.
 */
export function findTileForMask(
  rules: readonly TileRule[],
  mask: number,
  terrain: string,
): TileRule | undefined {
  return rules.find(
    (r) => r.mask === mask && r.terrains.includes(terrain),
  );
}

// ------------------------------------------------------------------ autoladrilhar uma célula

/**
 * Calcula a máscara de vizinhança de uma célula e devolve o índice do tile
 * correspondente nas regras da API.
 *
 * Lança `Error` com mensagem em pt-BR se nenhuma regra corresponder à
 * combinação (máscara + terreno).
 *
 * @param blocks - Estado actual dos blocos.
 * @param x - Coordenada x da célula.
 * @param y - Coordenada y da célula.
 * @param z - Nível vertical.
 * @param terrain - Terreno da célula.
 * @param rules - Regras de posicionamento (F2-04).
 * @returns Índice do tile (tileIndex) a usar para esta célula.
 */
export function autotile(
  blocks: BlockStore,
  x: number,
  y: number,
  z: number,
  terrain: string,
  rules: readonly TileRule[],
): number {
  const mask = buildMask(blocks, x, y, z, terrain);
  const rule = findTileForMask(rules, mask, terrain);

  if (!rule) {
    throw new Error(
      `Nenhuma peça para a máscara ${mask} ` +
        `(célula ${x},${y},${z}, terreno "${terrain}"). ` +
        `O tileset não cobre esta combinação de vizinhança.`,
    );
  }

  return rule.tileIndex;
}

// ------------------------------------------------------------------ diagnóstico de cobertura

/**
 * Devolve as máscaras (0–15) que NÃO têm peça para um dado terreno.
 *
 * Se o array estiver vazio, o tileset cobre todas as 16 combinações.
 *
 * @param rules - Regras de posicionamento (F2-04).
 * @param terrain - Terreno a verificar.
 * @returns Array de máscaras em falta (ordenado).
 */
export function missingMasks(
  rules: readonly TileRule[],
  terrain: string,
): number[] {
  const covered = new Set<number>();
  for (const rule of rules) {
    if (rule.terrains.includes(terrain)) {
      covered.add(rule.mask);
    }
  }

  const missing: number[] = [];
  for (let m = 0; m < 16; m++) {
    if (!covered.has(m)) {
      missing.push(m);
    }
  }
  return missing;
}

// ------------------------------------------------------------------ actualização de vizinhança

/**
 * Células afectadas quando se pinta ou apaga um bloco.
 *
 * Inclui a própria célula e os 4 vizinhos cardeais, porque a máscara de
 * cada um depende do estado dos outros.
 */
export function affectedCells(
  x: number,
  y: number,
): ReadonlyArray<{ x: number; y: number }> {
  return [
    { x, y },         // célula alterada
    { x, y: y + 1 },  // Norte (afectado pela mudança em x,y)
    { x: x + 1, y },  // Leste
    { x, y: y - 1 },  // Sul
    { x: x - 1, y },  // Oeste
  ];
}
