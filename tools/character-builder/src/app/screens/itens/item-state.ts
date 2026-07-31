/**
 * Estado de uma peça do guarda-roupa para o personagem selecionado.
 *
 * Módulo puro, sem React — a regra que decide se o botão Gerar está bloqueado
 * fica testável sem navegador. A hierarquia de bloqueio é a do servidor:
 * silhueta errada recusa antes de qualquer coisa; sem modelo base remoto não
 * há corpo para aplicar a edição; célula pronta é terminal (idempotência —
 * gerar de novo cobraria por nada).
 */
import type { Cell, Character, WardrobeItem } from '../../../../server/model.ts';

/** Por que a peça não pode ser gerada, quando não pode. */
export type ItemAvailability = 'fits' | 'mismatch' | 'no-base';

/** Estado visual do botão de geração (multi-state-button). */
export type GenerateAction = 'idle' | 'working' | 'done' | 'retry' | 'blocked';

export interface ItemStatus {
  readonly availability: ItemAvailability;
  readonly action: GenerateAction;
  /** true só quando o clique em Gerar pode sair: silhueta certa, base remota
   *  e célula vazia ou falhou. */
  readonly canGenerate: boolean;
}

export function itemStatus(
  item: WardrobeItem,
  character: Character,
  cell: Cell | undefined,
): ItemStatus {
  // Peça só vale na MESMA silhueta — recusa antes de gastar, como o servidor.
  if (item.silhouette !== character.silhouette) {
    return { availability: 'mismatch', action: 'blocked', canGenerate: false };
  }
  // A edição é aplicada sobre o personagem remoto; sem remoteId não há corpo.
  if (!character.remoteId) {
    return { availability: 'no-base', action: 'blocked', canGenerate: false };
  }
  const status = cell?.status ?? 'vazio';
  switch (status) {
    case 'pronto':
      // Idempotência: célula pronta = não gera de novo.
      return { availability: 'fits', action: 'done', canGenerate: false };
    case 'gerando':
    case 'na-fila':
      return { availability: 'fits', action: 'working', canGenerate: false };
    case 'falhou':
      return { availability: 'fits', action: 'retry', canGenerate: true };
    default:
      return { availability: 'fits', action: 'idle', canGenerate: true };
  }
}
