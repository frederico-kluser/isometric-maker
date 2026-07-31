/**
 * Ferramenta de empilhar e remover blocos — F2-07.
 *
 * Empilha um bloco sobre o topo da coluna ou remove o bloco do topo.
 * Opera sobre o modelo (BlockStore), não sobre a tela.
 *
 * ## Regras
 *
 * - Empilhar: coloca um bloco no primeiro z vazio acima do topo actual.
 * - Remover: tira o bloco do topo da coluna (z mais alto).
 * - Nada escreve no estado directo — tudo por operações do iso-core.
 * - Todo texto em pt-BR.
 */

import { BlockStore } from '@isometric-maker/iso-core/map';

// ------------------------------------------------------------------ tipos

/** Resultado de uma operação de empilhamento. */
export interface StackResult {
  /** Novo estado dos blocos. */
  readonly blocks: BlockStore;
  /** Mensagem para o utilizador (pt-BR). */
  readonly mensagem: string;
  /** z onde o bloco foi colocado ou removido, ou -1 se não houve alteração. */
  readonly z: number;
}

// ------------------------------------------------------------------ empilhar

/**
 * Empilha um bloco no topo da coluna (x, y).
 *
 * O bloco é colocado no primeiro z vazio acima do topo actual.
 * Se a coluna não existir, cria-a com um bloco em z=0.
 *
 * @param blocks - Estado actual dos blocos.
 * @param x - Coordenada x da célula.
 * @param y - Coordenada y da célula.
 * @param tipo - Tipo de bloco a empilhar (ex.: 'stone', 'wood').
 * @returns Novo estado, mensagem e z onde foi colocado.
 */
export function empilharBloco(
  blocks: BlockStore,
  x: number,
  y: number,
  tipo: string,
): StackResult {
  const novosBlocos = cloneBlocks(blocks);

  // Determina o topo actual
  const altura = novosBlocos.heightAt(x, y);
  const z = altura; // altura é o primeiro z vazio

  novosBlocos.setBlock(x, y, z, tipo);

  return {
    blocks: novosBlocos,
    mensagem: `Bloco "${tipo}" empilhado em (${x},${y},${z}).`,
    z,
  };
}

// ------------------------------------------------------------------ remover

/**
 * Remove o bloco do topo da coluna (x, y).
 *
 * Se a coluna estiver vazia ou não existir, não faz nada.
 *
 * @returns Novo estado, mensagem e z removido (-1 se não havia bloco).
 */
export function removerBloco(
  blocks: BlockStore,
  x: number,
  y: number,
): StackResult {
  const altura = blocks.heightAt(x, y);

  if (altura === 0) {
    return {
      blocks,
      mensagem: `Nenhum bloco em (${x},${y}) para remover.`,
      z: -1,
    };
  }

  const z = altura - 1; // último z com bloco
  const existente = blocks.getBlock(x, y, z);

  const novosBlocos = cloneBlocks(blocks);
  novosBlocos.removeBlock(x, y, z);

  return {
    blocks: novosBlocos,
    mensagem: `Bloco "${existente ?? '?'}" removido de (${x},${y},${z}).`,
    z,
  };
}

// ------------------------------------------------------------------ altura

/**
 * Devolve a altura da coluna (x, y) — o primeiro z vazio.
 *
 * @returns Altura (0 se a coluna não existir).
 */
export function alturaColuna(blocks: BlockStore, x: number, y: number): number {
  return blocks.heightAt(x, y);
}

// ------------------------------------------------------------------ utilitários

function cloneBlocks(blocks: BlockStore): BlockStore {
  return BlockStore.fromRle(blocks.toRle());
}
