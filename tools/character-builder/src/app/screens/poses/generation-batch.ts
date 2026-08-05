/**
 * Regra do disparo em lote e do contador de progresso da grade de poses.
 *
 * Módulo puro, sem React — a decisão do que entra na fila fica testável sem
 * navegador (mesmo padrão de itens/item-state.ts). O que está em jogo é
 * dinheiro: pedir uma célula pronta de novo cobraria por nada, e esquecer
 * uma pendente deixaria a grade buracada sem aviso.
 */
import { cellKey, type Cell, type Pose } from '../../../../server/model.ts';
import { isBusyStatus } from '../../job-scope.ts';

/** O mínimo que o contador precisa de um job de studio.jobs (que tem mais campos). */
export interface JobStatusLike {
  readonly status: string;
}

/** Lote disparado por esta tela — as chaves de célula cujos jobs o contador segue. */
export interface BatchDispatch {
  readonly characterId: string;
  readonly keys: readonly string[];
}

/** A célula ainda aceita um POST de geração: ausente, vazia ou com falha. */
export function isPoseCellPending(cell: Cell | undefined): boolean {
  return cell === undefined || cell.status === 'vazio' || cell.status === 'falhou';
}

/** Poses do personagem cujo POST /api/generate ainda faz sentido disparar. */
export function pendingPoses(
  characterId: string,
  poses: readonly Pose[],
  cells: Record<string, Cell>,
): Pose[] {
  return poses.filter((p) => isPoseCellPending(cells[cellKey(characterId, p.id)]));
}

/**
 * Quantos jobs, entre as chaves dadas, ainda NÃO acabaram.
 *
 * Conta `'na-fila'` junto com `'gerando'`, e essa é a correção: com a fila
 * (`server/job-queue.ts`) um lote inteiro nasce enfileirado e só entra em
 * execução aos poucos. Contando só `'gerando'`, um lote de oito poses recém
 * disparado lia "0 rodando" — o contador de progresso sumia da tela e, pior,
 * `mergeBatch` tratava o lote como ASSENTADO e o substituía no disparo
 * seguinte, perdendo o "X de Y" das poses que ainda nem tinham começado.
 */
export function countBusy(
  keys: readonly string[],
  jobs: Record<string, JobStatusLike>,
): number {
  let n = 0;
  for (const key of keys) {
    if (isBusyStatus(jobs[key]?.status)) n += 1;
  }
  return n;
}

/**
 * Junta um disparo novo ao lote rastreado. Se o lote anterior já assentou
 * (nada na fila nem gerando) ou é de outro personagem, o novo SUBSTITUI — o
 * "de Y" do contador não carrega defuntos. Se ainda há job ocupado, acumula sem
 * duplicar chave (o retry de uma pose do lote reusa a chave dela).
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
    countBusy(prev.keys, jobs) > 0;
  if (!prevActive || prev === null) return { characterId, keys: newKeys };
  const keys = [...prev.keys];
  for (const key of newKeys) {
    if (!keys.includes(key)) keys.push(key);
  }
  return { characterId, keys };
}
