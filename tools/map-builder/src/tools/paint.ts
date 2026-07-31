/**
 * Ferramenta de pintura de chão — F2-07.
 *
 * Coloca um bloco no chão (z=0) da célula seleccionada.
 * Se a célula já tiver um bloco, substitui-o (pinta por cima).
 *
 * ## Regras
 *
 * - Opera sobre o modelo (BlockStore), não sobre a tela.
 * - Desfazer/refazer via comandos imutáveis.
 * - Todo texto em pt-BR.
 * - Nada escreve no estado directo — tudo por operações do iso-core.
 */

import { BlockStore } from '@isometric-maker/iso-core/map';

// ------------------------------------------------------------------ tipos

/** Contexto partilhado pelas ferramentas de edição. */
export interface EditorContext {
  readonly blocks: BlockStore;
}

/** Resultado de uma operação de pintura. */
export interface PaintResult {
  /** Novo estado dos blocos. */
  readonly blocks: BlockStore;
  /** Mensagem para o utilizador (pt-BR). */
  readonly mensagem: string;
}

// ------------------------------------------------------------------ pintar chão

/**
 * Pinta o chão na célula (x, y) com o tipo de bloco dado.
 *
 * - Se a célula já tiver um bloco em z=0, substitui-o.
 * - Se a célula não tiver bloco em z=0, coloca um novo.
 * - Cria a coluna se não existir.
 *
 * @param blocks - Estado actual dos blocos.
 * @param x - Coordenada x da célula.
 * @param y - Coordenada y da célula.
 * @param tipo - Tipo de bloco a colocar (ex.: 'grass', 'stone', 'dirt').
 * @returns Novo estado e mensagem.
 */
export function pintarChao(
  blocks: BlockStore,
  x: number,
  y: number,
  tipo: string,
): PaintResult {
  // Clona o BlockStore para imutabilidade
  const novosBlocos = cloneBlocks(blocks);

  const existente = novosBlocos.getBlock(x, y, 0);

  if (existente && existente !== '') {
    // Substitui o bloco existente
    novosBlocos.setBlock(x, y, 0, tipo);
    return {
      blocks: novosBlocos,
      mensagem: `Piso em (${x},${y}) alterado de "${existente}" para "${tipo}".`,
    };
  }

  // Coloca um bloco novo
  novosBlocos.setBlock(x, y, 0, tipo);
  return {
    blocks: novosBlocos,
    mensagem: `Piso em (${x},${y}) pintado com "${tipo}".`,
  };
}

// ------------------------------------------------------------------ apagar chão

/**
 * Remove o bloco no chão da célula (x, y).
 *
 * @returns Novo estado e mensagem. Se não houver bloco, retorna o mesmo estado.
 */
export function apagarChao(
  blocks: BlockStore,
  x: number,
  y: number,
): PaintResult {
  const existente = blocks.getBlock(x, y, 0);

  if (!existente || existente === '') {
    return {
      blocks,
      mensagem: `Nenhum piso em (${x},${y}) para apagar.`,
    };
  }

  const novosBlocos = cloneBlocks(blocks);
  novosBlocos.removeBlock(x, y, 0);
  return {
    blocks: novosBlocos,
    mensagem: `Piso em (${x},${y}) removido.`,
  };
}

// ------------------------------------------------------------------ utilitários

/**
 * Clona um BlockStore.
 *
 * O BlockStore não tem método clone. Recriamos via RLE (serialização +
 * desserialização), que é a forma canónica de cópia profunda.
 */
function cloneBlocks(blocks: BlockStore): BlockStore {
  return BlockStore.fromRle(blocks.toRle());
}
