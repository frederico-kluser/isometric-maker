/**
 * Acumulador de gasto da sessão — metade volátil do guard de orçamento.
 *
 * Toda geração paga chama `trackSpend` assim que a resposta chega (o dinheiro
 * sai na submissão, não no poll). O registro durável é o ledger ndjson em
 * assets/ledger.ndjson, escrito pelos mesmos módulos (ADR 0012: o servidor
 * estima, loga e escreve ledger — nunca recusa, nunca aparece na UI).
 *
 * O leitor deste acumulador era o GET /api/estimate, que morreu com o
 * diálogo de orçamento da v1: hoje o total da sessão não sai do processo.
 * O acumulador fica como a costura pronta caso um indicador de sessão volte.
 */

// ------------------------------------------------------------------ tracking de sessão

/** Acumulador de gasto da sessão (em memória, zera no restart do servidor). */
let sessionSpentUsd = 0;

/** Regista um gasto no acumulador da sessão. */
export function trackSpend(usd: number): void {
  sessionSpentUsd += usd;
}
