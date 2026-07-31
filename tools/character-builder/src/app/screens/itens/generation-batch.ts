/**
 * Regra do disparo em lote e do contador de progresso do guarda-roupa.
 *
 * Mesmo papel de poses/generation-batch.ts, duplicado de propósito: cada
 * tela é dona da sua regra e os módulos divergem no que é "pendente" — aqui
 * a silhueta manda, e a hierarquia de bloqueio é a de item-state (que o
 * servidor repete: incompatível é recusado antes de qualquer gasto).
 *
 * Módulo puro, sem React — testável sem navegador.
 */
import {
  wardrobeKey,
  type Cell,
  type Character,
  type WardrobeItem,
} from '../../../../server/model.ts';
import { itemStatus } from './item-state.ts';

/** O mínimo que o contador precisa de um job de studio.jobs (que tem mais campos). */
export interface JobStatusLike {
  readonly status: string;
}

/** Lote disparado por esta tela — as chaves de célula cujos jobs o contador segue. */
export interface BatchDispatch {
  readonly characterId: string;
  readonly keys: readonly string[];
}

/** Peças que SERVEM na silhueta do personagem — o universo do resumo do disparo. */
export function fittingWardrobeItems(
  wardrobe: readonly WardrobeItem[],
  character: Character,
): WardrobeItem[] {
  return wardrobe.filter((item) => item.silhouette === character.silhouette);
}

/**
 * Peças cujo POST /api/generate ainda faz sentido: servem na silhueta
 * (incompatível NUNCA entra), há base remota e a célula está vazia ou falhou.
 * É exatamente o canGenerate testado em item-state.test.ts.
 */
export function pendingWardrobeItems(
  wardrobe: readonly WardrobeItem[],
  character: Character,
  cells: Record<string, Cell>,
): WardrobeItem[] {
  return wardrobe.filter(
    (item) =>
      itemStatus(item, character, cells[wardrobeKey(character.id, item.id)])
        .canGenerate,
  );
}

/** Quantos jobs, entre as chaves dadas, ainda estão gerando. */
export function countGenerating(
  keys: readonly string[],
  jobs: Record<string, JobStatusLike>,
): number {
  let n = 0;
  for (const key of keys) {
    if (jobs[key]?.status === 'gerando') n += 1;
  }
  return n;
}

/**
 * Junta um disparo novo ao lote rastreado. Se o lote anterior já assentou
 * (nada mais gerando) ou é de outro personagem, o novo SUBSTITUI — o "de Y"
 * do contador não carrega defuntos. Se ainda há job rodando, acumula sem
 * duplicar chave (o retry de uma peça do lote reusa a chave dela).
 */
export function mergeBatch(
  prev: BatchDispatch | null,
  characterId: string,
  newKeys: readonly string[],
  jobs: Record<string, JobStatusLike>,
): BatchDispatch {
  const prevActive =
    prev !== null &&
    prev.characterId === characterId &&
    countGenerating(prev.keys, jobs) > 0;
  if (!prevActive || prev === null) return { characterId, keys: newKeys };
  const keys = [...prev.keys];
  for (const key of newKeys) {
    if (!keys.includes(key)) keys.push(key);
  }
  return { characterId, keys };
}
