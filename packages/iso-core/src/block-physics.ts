/**
 * Física de blocos — queda por falta de suporte, simulação determinística.
 *
 * ## O problema
 *
 * O editor coloca blocos e remove blocos. Colocar um bloco no ar cria uma
 * situação que o formato do mapa permite (coluna com ar explícito por baixo) mas
 * que a física real não tolera: o bloco deveria cair até encontrar suporte.
 *
 * Remover um bloco que sustentava outros também deveria fazê-los cair — efeito
 * dominó controlado pela simulação, não por uma regra estática.
 *
 * ## O que este módulo faz
 *
 * - {@link hasSupport}: um bloco em `(x, y, z)` tem suporte se `z = 0` ou se
 *   existe bloco sólido em `(x, y, z-1)`.
 * - {@link findUnsupported}: varre o mapa e devolve os blocos que estão sem
 *   suporte neste instante.
 * - {@link stepBlockPhysics}: avança a simulação um passo fixo. Cada bloco sem
 *   suporte desce 1 nível. Blocos que encontram suporte param. Blocos que caem
 *   sobre o ator empurram-no para fora.
 *
 * ## O que este módulo NÃO faz
 *
 * - Não altera o `MapData`. Os blocos que caem são entidades temporárias
 *   (`FallingBlock`) que existem apenas durante a simulação. Aplicar as mudanças
 *   ao documento é decisão do editor (botão "Aplicar").
 * - Não simula colisão horizontal de blocos. Um bloco que cai só se move em Z.
 * - Não simula empilhamento lateral (avalanche). Só queda vertical.
 *
 * ## Determinismo
 *
 * O passo é fixo e discreto: 1 nível por passo para cada bloco sem suporte.
 * Mesma entrada produz mesma saída — testável sem navegador.
 */

import { canEnter, type CollisionMap } from './collision.ts';
import {
  entityAabb,
  PLAYER_HALF,
  pushOutOf,
  solidAtOf,
  type EntityBox,
  type PlayerCell,
  type SolidAt,
} from './collision-box.ts';
import { aabbOverlaps, type GridAabb } from './map-instances.ts';

// ------------------------------------------------------------------ tipos

/** Bloco que está a cair durante a simulação. */
export interface FallingBlock {
  /** Posição actual (x, y são fixos; z desce a cada passo). */
  readonly x: number;
  readonly y: number;
  /** Nível z actual do bloco (inteiro). */
  z: number;
  /** Tipo do bloco (para recriar o MapData ao aplicar). */
  readonly blockType: string;
}

/** Resultado de um passo de simulação de física de blocos. */
export interface BlockPhysicsStep {
  /** Blocos que continuam a cair depois deste passo. */
  readonly falling: readonly FallingBlock[];
  /** Blocos que aterraram neste passo (encontraram suporte). */
  readonly landed: readonly FallingBlock[];
  /** Célula do ator depois do push-out, se um bloco caiu sobre ele. */
  readonly pushedPlayer: PlayerCell | null;
}

// ------------------------------------------------------------------ suporte

/**
 * Um bloco em `(x, y, z)` tem apoio por baixo?
 *
 * `z = 0` é sempre apoiado (plano de chão). Para `z > 0`, a célula `(x, y, z-1)`
 * precisa estar ocupada por um bloco.
 */
export function hasSupport(
  map: CollisionMap,
  x: number,
  y: number,
  z: number,
): boolean {
  if (z < 0) return false;
  if (z === 0) return true;
  return map.hasBlock(x, y, z - 1);
}

/**
 * Varre o mapa e devolve todos os blocos que estão sem suporte.
 *
 * Só devolve blocos cuja célula está ocupada E cuja célula de baixo está vazia.
 * Blocos em z=0 nunca são devolvidos (têm suporte pelo plano de chão).
 *
 * A ordem é determinística: por x, depois y, e dentro da coluna por z de baixo
 * para cima (um bloco mais alto não cai antes do que está por baixo).
 */
export function findUnsupported(
  map: CollisionMap,
  occupied: readonly { x: number; y: number; z: number; blockType: string }[],
): FallingBlock[] {
  const falling: FallingBlock[] = [];
  for (const cell of occupied) {
    if (cell.z > 0 && !hasSupport(map, cell.x, cell.y, cell.z)) {
      falling.push({ x: cell.x, y: cell.y, z: cell.z, blockType: cell.blockType });
    }
  }
  return falling;
}

// ------------------------------------------------------------------ simulação

/**
 * Configuração da simulação de física de blocos.
 *
 * `fixedDt` é o passo fixo de lógica, em segundos. `fallInterval` é quantos
 * passos fixos são necessários para um bloco descer 1 nível. Com `fixedDt =
 * 1/60` e `fallInterval = 6`, um bloco desce 1 nível a cada 100 ms (10 níveis
 * por segundo).
 */
export interface BlockPhysicsConfig {
  /** Passo fixo de lógica (s). */
  readonly fixedDt: number;
  /** Passos fixos por nível de queda. */
  readonly fallInterval: number;
}

/** Configuração padrão: 1/60s, 1 nível a cada 6 passos (~10 níveis/s). */
export const DEFAULT_BLOCK_PHYSICS_CONFIG: BlockPhysicsConfig = Object.freeze({
  fixedDt: 1 / 60,
  fallInterval: 6,
});

/**
 * Células ocupadas do mapa, para alimentar {@link stepBlockPhysics}.
 *
 * Separação de propósito: o simulador não sabe extrair células do mapa. Quem
 * fornece os dados é o editor (que conhece o `MapData` e o formato RLE).
 */
export interface BlockWorld {
  /** Blocos que podem cair (células ocupadas). */
  readonly occupied: readonly { x: number; y: number; z: number; blockType: string }[];
  /** Mapa de colisão (para consultar suporte e empurrar o ator). */
  readonly collisionMap: CollisionMap;
}

/**
 * Avança a simulação de física de blocos **um** passo fixo.
 *
 * Cada bloco sem suporte acumula progresso de queda. Quando o acumulador atinge
 * `fallInterval`, o bloco desce 1 nível. Se a nova posição tiver suporte, o
 * bloco aterra. Se um bloco em queda intersectar o ator, este é empurrado para
 * fora (MTV, via {@link pushOutOf}).
 *
 * @param world - Blocos ocupados e mapa de colisão.
 * @param falling - Blocos que já estão a cair (primeira chamada: `[]`).
 * @param accumulator - Acumulador de passos desde a última descida (0 no início).
 * @param player - Posição do ator (para push-out). `null` se não houver ator.
 * @param config - Configuração de física.
 * @returns Novo estado: blocos a cair, blocos que aterraram, ator empurrado.
 */
export function stepBlockPhysics(
  world: BlockWorld,
  falling: readonly FallingBlock[],
  accumulator: number,
  player: PlayerCell | null,
  config: BlockPhysicsConfig = DEFAULT_BLOCK_PHYSICS_CONFIG,
): BlockPhysicsStep {
  const solidAt: SolidAt = solidAtOf(world.collisionMap);

  // Conjunto de células ocupadas (inclui as que estão a cair) para o
  // push-out — um bloco que caiu sobre o ator no passo anterior já não está
  // no mapa, mas continua a ocupar espaço físico.
  const occupiedSet = new Set<string>();
  for (const cell of world.occupied) {
    occupiedSet.add(`${cell.x}:${cell.y}:${cell.z}`);
  }
  // Blocos que estão a cair ocupam a posição actual deles, não a original.
  for (const fb of falling) {
    occupiedSet.add(`${fb.x}:${fb.y}:${fb.z}`);
  }

  // Função de solidAt composta: o que está no mapa + o que está a cair.
  // Um bloco a cair é sólido — não pode ser atravessado.
  const composedSolidAt = (x: number, y: number, z: number): boolean => {
    if (occupiedSet.has(`${x}:${y}:${z}`)) return true;
    return solidAt(x, y, z);
  };

  // Função de suporte composta: um bloco a cair pode servir de apoio.
  const composedHasSupport = (x: number, y: number, z: number): boolean => {
    if (z === 0) return true;
    return occupiedSet.has(`${x}:${y}:${z - 1}`) || world.collisionMap.hasBlock(x, y, z - 1);
  };

  const advanced = accumulator + 1;
  const shouldDescend = advanced >= config.fallInterval;

  const nextFalling: FallingBlock[] = [];
  const landed: FallingBlock[] = [];
  let pushedPlayer: PlayerCell | null = null;

  for (const fb of falling) {
    if (!shouldDescend) {
      // Ainda não é hora de descer — mantém na mesma posição.
      nextFalling.push(fb);
      continue;
    }

    const nextZ = fb.z - 1;

    // Encontrou suporte na nova posição?
    if (composedHasSupport(fb.x, fb.y, nextZ)) {
      // O bloco aterra: adiciona ao conjunto de ocupadas para os próximos.
      occupiedSet.add(`${fb.x}:${fb.y}:${nextZ}`);
      landed.push({ ...fb, z: nextZ });
      continue;
    }

    // Continua a cair.
    const nextBlock: FallingBlock = { ...fb, z: nextZ };
    nextFalling.push(nextBlock);

    // Colisão com o ator: se o bloco intersectar o jogador, empurra-o.
    if (player && player.x === fb.x && player.y === fb.y && player.z === nextZ) {
      const playerBox: EntityBox = {
        cx: player.x + 0.5,
        cy: player.y + 0.5,
        z: player.z,
        half: PLAYER_HALF,
      };
      const pushed = pushOutOf(composedSolidAt, playerBox);
      if (pushed) {
        pushedPlayer = {
          x: Math.floor(pushed.cx),
          y: Math.floor(pushed.cy),
          z: pushed.z,
        };
      }
    }
  }

  // Se `shouldDescend`, também detectamos novos blocos sem suporte que não
  // estavam a cair antes — blocos cujo suporte foi removido neste passo
  // (porque o bloco de baixo caiu).
  //
  // Importante: `world.occupied` NÃO muda durante a simulação — é o snapshot
  // do mapa no início. Por isso `findUnsupported` vai sempre devolver os
  // mesmos blocos que `initBlockPhysics` já detetou. Para evitar duplicados,
  // mantemos um conjunto das colunas (x,y) que já estão a ser simuladas (têm
  // blocos a cair ou que já aterraram).
  if (shouldDescend) {
    // Colunas já cobertas: qualquer bloco em (x,y) que já está a cair ou que
    // aterrou significa que a coluna já está a ser processada.
    const coveredColumns = new Set<string>();
    for (const f of nextFalling) coveredColumns.add(`${f.x}:${f.y}`);
    for (const l of landed) coveredColumns.add(`${l.x}:${l.y}`);

    const newUnsupported = findUnsupported(world.collisionMap, world.occupied);
    for (const fb of newUnsupported) {
      // Coluna já coberta — o bloco original desta coluna já está na
      // simulação (a cair ou aterrado).
      if (coveredColumns.has(`${fb.x}:${fb.y}`)) continue;
      // Evita duplicados por posição exata.
      const alreadyFalling = nextFalling.some(
        (f) => f.x === fb.x && f.y === fb.y && f.z === fb.z,
      );
      const alreadyLanded = landed.some(
        (l) => l.x === fb.x && l.y === fb.y && l.z === fb.z,
      );
      if (!alreadyFalling && !alreadyLanded) {
        // Marca como ocupada a posição actual (ainda está lá).
        occupiedSet.add(`${fb.x}:${fb.y}:${fb.z}`);
        nextFalling.push(fb);
      }
    }
  }

  return { falling: nextFalling, landed, pushedPlayer };
}

/**
 * Configuração inicial para começar a simulação.
 *
 * Detecta blocos sem suporte no mundo e devolve o estado inicial da simulação.
 */
export function initBlockPhysics(world: BlockWorld): {
  falling: readonly FallingBlock[];
  accumulator: number;
} {
  return {
    falling: findUnsupported(world.collisionMap, world.occupied),
    accumulator: 0,
  };
}

/**
 * Devolve as células que ficariam ocupadas se a simulação fosse aplicada.
 *
 * Combina as células originais do mapa (removendo as que caíram) com os blocos
 * que aterraram e os que ainda estão a cair.
 */
export function resolveMapAfterSimulation(
  world: BlockWorld,
  falling: readonly FallingBlock[],
  landed: readonly FallingBlock[],
): readonly { x: number; y: number; z: number; blockType: string }[] {
  // Células que NÃO estão a cair nem aterraram — permanecem onde estavam.
  const fallingSet = new Set<string>();
  for (const fb of falling) fallingSet.add(`${fb.x}:${fb.y}:${fb.z}`);
  for (const lb of landed) fallingSet.add(`${lb.x}:${lb.y}:${lb.z}`);

  // Originais que não caíram.
  const result: { x: number; y: number; z: number; blockType: string }[] = [];
  const occupiedNew = new Set<string>();

  for (const cell of world.occupied) {
    const key = `${cell.x}:${cell.y}:${cell.z}`;
    // Remove a célula original de quem está a cair ou aterrou noutra posição.
    const isFallingFromHere = falling.some(
      (f) => f.x === cell.x && f.y === cell.y,
    ) || landed.some((l) => l.x === cell.x && l.y === cell.y);
    if (isFallingFromHere) continue;
    result.push(cell);
    occupiedNew.add(key);
  }

  // Blocos que aterraram.
  for (const lb of landed) {
    result.push({ x: lb.x, y: lb.y, z: lb.z, blockType: lb.blockType });
    occupiedNew.add(`${lb.x}:${lb.y}:${lb.z}`);
  }

  // Blocos que ainda estão a cair (posição actual).
  for (const fb of falling) {
    result.push({ x: fb.x, y: fb.y, z: fb.z, blockType: fb.blockType });
    occupiedNew.add(`${fb.x}:${fb.y}:${fb.z}`);
  }

  return result;
}
