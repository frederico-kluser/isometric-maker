---
name: guarding-generation-cost
description: Runs the PixelLab asset pipeline without spending money by accident - the hash contract that makes regeneration free, the four budget-guard branches, and the plan-then-estimate-then-generate order. Use whenever a task touches asset generation, the pixellab CLI, assets/catalog.ts, src/catalog.ts, src/cost.ts, src/generate.ts or src/queue.ts - including Portuguese phrasings like "gerar os sprites", "gerar os assets", "quanto custa", "regerar", "o cache invalidou", "retomar a fila", "travou no meio", "empacotar o atlas". Use it before running any command that could submit a job, and first of all after any interrupted run. Triggers on plan, estimate, generate, resume, rescue, atlas, lockfile, specHash, idempotencia, orcamento, saldo.
metadata:
  type: task
  verification_signal: cd tools/pixellab-pipeline && npm test && node src/cli.ts plan
---

# Guarding generation cost

## When to use

Any time a command could submit a job, any time the catalog or the hashing changes, and immediately
after any crash or interruption.

## Injected knowledge

### The contract

> "Todo asset gerado gasta dinheiro real. O pipeline é idempotente por design: gerar de novo com o
> mesmo spec **não deve gastar nada**." — `AGENTS.md:37@4a84b2d0`

`plan` and `estimate` never touch the network in a paid way. `generate` spends. That asymmetry is
the whole design, and it only holds while the hashes hold.

### What enters `specHash`, and what is excluded on purpose

`specHash` covers exactly `{endpoint, params, inputs, parents, pipelineVersion, salt?}`, with `salt`
omitted from the object when undefined — so `salt: undefined` and `salt: ""` are different specs
(`tools/pixellab-pipeline/src/catalog.ts:120@2a45b362`).

Three exclusions, each deliberate:

- **The OpenAPI snapshot hash.** If PixelLab edits a field the project never sends, including it
  would invalidate the whole catalog and produce a bill for zero benefit. Schema drift is a `doctor`
  warning, never invalidation (`tools/pixellab-pipeline/src/cli.ts:206@b333647e`).
- **`out` and `post`.** They live in `postHash` instead (`tools/pixellab-pipeline/src/catalog.ts:133@2a45b362`).
  Moving an output path therefore costs nothing.
- **`budgetGroup`.** Reporting metadata; regrouping the report must not rebill.

`inputHash` hashes **decoded pixels**, not file bytes:
`digest("WxHxC:" + digest(rawBuffer))` (`tools/pixellab-pipeline/src/catalog.ts:93@2a45b362`).
Re-encoding a PNG changes the bytes and not the image; hashing bytes would charge again for nothing.

`PIPELINE_VERSION = 1` (`tools/pixellab-pipeline/src/catalog.ts:15@2a45b362`). Bumping it regenerates
**everything**. That is a budget decision, never a refactor.

### The five plan actions, and the one that actually runs

`decide()` returns `skip | reprocess | redownload | generate | blocked-rejected`
(`tools/pixellab-pipeline/src/catalog.ts:235@2a45b362`), in that resolution order: rejected spec →
no lock entry → specHash mismatch → artifacts present (postHash equal ⇒ `skip`, else `reprocess`) →
artifacts missing but remotely cacheable and not ephemeral ⇒ `redownload` (free) → else `generate`
(paid).

**Known gap:** `runGenerate` filters `action === 'generate'` only
(`tools/pixellab-pipeline/src/generate.ts:186@d7959fa4`). `reprocess` and `redownload` are planned
and executed by nothing. If a plan shows them, the work has to be done another way — do not assume
`generate` will pick them up.

`rejectedHashes` is keyed by **specHash, not asset id**, so rejecting one blocks that exact spec
anywhere in the catalog (`tools/pixellab-pipeline/src/catalog.ts:240@2a45b362`). No code writes it;
it is hand-edited into the lockfile.

### The guard: four branches, and which statistic each one reads

Thresholds at `tools/pixellab-pipeline/src/cost.ts:293@e3fe3b1f`; branch order at `:326`.

| Branch | Compares | Against |
|---|---|---|
| asset cap | most expensive single asset, **point** estimate | 0.30 |
| run cap | **high** (worst-case) estimate | 15 |
| monthly cap | spent-this-month + **point** | 60 |
| balance | **point** | 90% of balance |

The asset cap exists to catch an accidental `mode='pro'` before submit: no single endpoint in the
cost table reaches 0.30, so this branch can only fire through the per-direction multiplier
(`docs/adr/0006-animacao-em-template-mode.md:27@554b0d42`). The balance branch is **skipped entirely**
when the account reports a subscription quota instead of dollars
(`tools/pixellab-pipeline/src/api.ts:178@314e8627`) — on such an account one of the four guards is
silently inactive.

### Traps that cost real money

1. **`resume` breaks parent characters.** `runResume` rewrites the lock entry and drops `remote` and
   `requestSnapshot` (`tools/pixellab-pipeline/src/generate.ts:418@d7959fa4`). Child animations need
   `lock.assets[parent].remote.id` to inject `character_id` (`:136`), so resuming a parent
   permanently breaks every animation derived from it — recoverable only by paying again. Until this
   is fixed, back up `pixellab-lock.json` before `resume`.
2. **Same block sets `postHash: ''`** (`:420`), so `plan` reports `reprocess` forever afterwards.
3. **Non-PNG downloads vanish silently.** `extractImages` recognises PNG/WebP only (`:73`); a `.jpg`
   URL yields zero images, the record goes `stalled`, and the money is already gone.
4. **`map-objects` expiry is tighter than it looks.** The 8 h window is computed from *our*
   `completedAt`, not the API's creation time (`tools/pixellab-pipeline/src/queue.ts:211@2f4eeb8f`),
   so the real margin is under an hour. It is also the only ephemeral, non-re-downloadable resource
   — a lost local file means paying again.
5. **CI trap.** Non-TTY without `--yes` returns exit 2 even when the verdict is `allow`
   (`tools/pixellab-pipeline/src/cli.ts:285@b333647e`).

### The never-resubmit rule

> "**Nunca resubmeta um job cujo id você tem.** É o bug mais caro possível neste sistema."
> — `docs/01-pixellab/modelo-assincrono.md:46@1be351ba`

Money leaves at submit, so the job id is written to disk atomically **before the first poll**
(`tools/pixellab-pipeline/src/generate.ts:265@d7959fa4`). Any record holding a `jobId` is re-polled
by `resume` and never resubmitted. The ledger is appended at submit too, which is why an interrupted
run still counts against the monthly cap.

## Procedure

```bash
cd tools/pixellab-pipeline

node src/cli.ts doctor        # environment, snapshot, catalog load
node src/cli.ts plan          # free, always. Read the action counts.
node src/cli.ts estimate      # guard verdict: allow | confirm | refuse
node src/cli.ts generate --dry-run --limit 1
node src/cli.ts generate --limit 1     # SPENDS. Ask the user first.
node src/cli.ts verify
node src/cli.ts atlas         # free
```

**After any crash, `rescue` comes first** — it downloads ephemeral resources before their deadline
(`tools/pixellab-pipeline/src/cli.ts:306@b333647e`). Then `resume`, which re-polls paid jobs and
never resubmits.

Exit codes are a contract: `0` ok · `1` error · `2` refused by budget · `4` paid jobs pending, run
`resume` · `5` artifact verification failed. Code `3` is documented and never returned.

`generate` has broad side effects and is **not** auto-invocable: confirm with the user, with the
estimate in hand, before running it.

## References

- `docs/01-pixellab/custos-e-limites.md` — the per-endpoint estimated prices and their hedges
- `docs/01-pixellab/modelo-assincrono.md` — 202/poll/423/410/529 semantics
- Sibling skill `querying-pixellab-api` for anything about the API surface itself

## <evolution>

On task completion, run the memory pipeline. The external signal for this skill is
`cd tools/pixellab-pipeline && npm test && node src/cli.ts plan`: the suite must stay green **and**
`plan` must still report the same asset count with nothing to generate on an unchanged catalog. If
`plan` starts wanting to generate what it previously skipped, idempotency broke — that is a red
signal, not a finding to record.

Record only what changes how future work here is done: a new trap, a corrected threshold, a
confirmed behaviour of the queue. Do not record run outcomes, asset counts, or costs of a particular
run — those are facts about a moment, not about the system. If the pipeline's untested modules
caused the finding, note that the signal was a user confirmation rather than a test, because
`catalog.ts`, `cost.ts`, `generate.ts` and `queue.ts` still have no coverage.
