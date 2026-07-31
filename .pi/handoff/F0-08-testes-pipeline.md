# F0-08 — Testes de catalog, cost, queue e generate

**Onda:** W3 · **Worktree:** G-pipeline

## Arquivos produzidos

| Arquivo | Testes | Destaque |
|---|---|---|
| `tools/pixellab-pipeline/src/catalog.test.ts` | 21 | Idempotência, hashes, inputHash, ciclos, rejectedHashes, reprocess |
| `tools/pixellab-pipeline/src/cost.test.ts` | 17 | Interpolação/extrapolação, sumEstimates, checkBudget nos 4 thresholds |
| `tools/pixellab-pipeline/src/queue.test.ts` | 16 | Transições de estado, atRiskOfExpiry, WeightedSemaphore, AdaptiveLimiter |
| `tools/pixellab-pipeline/src/generate.test.ts` | 15 | Persistência antes de poll, resume, 422, dry-run, limit, extractImages |

**Total: 69 testes** (eram 6 antes; +63)

Nenhum arquivo em `src/` foi editado.

## API pública

Nenhuma mudança. Os testes importam e exercitam exatamente a API pública dos módulos.

## Decisões de design

### Cliente falso com contador

O fake client de `generate.test.ts` conta submits e polls em propriedades expostas. Para o
teste de idempotência em `catalog.test.ts`, o fluxo não precisa de cliente: `buildPlan` →
simula geração populando lockfile → regrava disco → recarrega → `buildPlan` de novo → assere
`toGenerate` vazio. O contador está em `FakeClientConfig.submitCount`, acessível após a
execução.

### Teste de idempotência

O headline test (`catalog.test.ts:76`) faz:
1. `buildPlan` com lockfile vazio → 3 assets `toGenerate`
2. Popula lockfile com entries simulando geração
3. **Regrava e recarrega do disco** (`loadLockfile` após `saveLockfile`)
4. `buildPlan` de novo → 0 `toGenerate`, estimativa zero, todos `skip`

O anti-regressão está em `specHash changes when prompt changes` (linha 120): se
`computeSpecHash` for quebrada para retornar constante, esse teste fica vermelho.

### Poll delay (5s) no teste de resume

`runResume` chama `pollJob`, que dorme 5s antes do primeiro poll. O teste `resume re-polls
existing jobs and never resubmits` aceita essa latência porque `pollJob` está no fonte e o
card proíbe editar `src/*.ts` que não seja `*.test.ts`. O delay não afeta os demais testes,
que usam endpoints não-assíncronos (`create-image-pixen`).

### Corrida no writeFileAtomic

`QueueStore.flush()` usa `writeFileAtomic`, cujo nome de arquivo temporário inclui
`Date.now().toString(36)`. Dois `store.put()` no mesmo milissegundo colidem (ENOENT no
rename). O card proíbe editar fonte; a correção pertence a outro card. Os testes de
generate contornam isso rodando sequencialmente em vez de `Promise.all`.

## Limitações conhecidas

- **Cobertura parcial de `runGenerate`:** Testes não cobrem o caminho de `pollJob` timeout
  (5s de sleep), nem o caminho `mapObject` (423 Locked), nem o fluxo de download por URL
  (usa só base64). O fake client injeta base64 para evitar `fetch`.
- **writeFileAtomic não é thread-safe:** Ver acima. Afeta qualquer uso concorrente da
  QueueStore.
- **Sem teste do caminho `stalled` em generate:** Quando `extractImages` retorna vazio, o
  job vai para `stalled`. O fake sempre retorna imagens, então esse branch não é exercitado.
- **Sem teste de `runRescue`** (não estava nos requisitos do card).
- **`sessionSpentUsd` chega 0 dos call sites:** F0-03 documentou essa limitação; os testes
  de cost.ts passam 0 em `spentThisSessionUsd` e verificam que o campo aparece no relatório.

## Caminhos de gasto sem cobertura

| Módulo | Caminho não coberto |
|---|---|
| `generate.ts` | `pollJob` timeout → `stalled` |
| `generate.ts` | `extractImages` vazio → `stalled` |
| `generate.ts` | Download via URL (fetch) |
| `generate.ts` | `runRescue` (fora do escopo) |
| `generate.ts` | Resolução de `character_id` via lockfile (dependências) |
| `queue.ts` | `clearDownloaded` |
| `cost.ts` | `checkBudget` com balance `undefined` e threshold `balance` (branch coberto) |

## Destinatários nomeados

- **G-0 (orquestrador):** 69 testes passando, todos os quatro módulos cobertos.
  Idempotência provada. Nenhum teste faz rede.
