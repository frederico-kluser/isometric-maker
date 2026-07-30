---
name: guarding-generation-cost
description: Runs the PixelLab asset pipeline without spending money by accident - the hash contract that makes regeneration free, a budget guard that warns on four thresholds and never refuses, and the plan-then-estimate-then-confirm order. Use whenever a task touches asset generation, the pixellab CLI, assets/catalog.ts, src/catalog.ts, src/cost.ts, src/generate.ts or src/queue.ts - including Portuguese phrasings like "gerar os sprites", "gerar os assets", "quanto custa", "regerar", "o cache invalidou", "retomar a fila", "travou no meio", "empacotar o atlas". Use it before running any command that could submit a job, and first of all after any interrupted run. Triggers on plan, estimate, generate, resume, rescue, atlas, lockfile, specHash, idempotencia, orcamento, saldo, limiar, confirmacao.
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
> mesmo spec **não deve gastar nada**. […] **O teste que prova isso ainda não existe; escrevê-lo é
> item de entrada da próxima onda.**" — `AGENTS.md:37@eb529ae5`

`plan` and `estimate` never touch the network in a paid way. `generate` spends. That asymmetry is
the whole design, and it only holds while the hashes hold.

The contract has two halves and only one of them is hard. **Idempotency is law** — it is what makes
the most common mistake, regenerating what already exists, cost zero. The budget guard is advice: it
informs and never refuses (`docs/adr/0012-guard-de-orcamento-informativo.md:26@23c76213`). So every
sentence below about hashing is load-bearing in a way no sentence about thresholds is, and the
honest reading of that is uncomfortable: the one hard defence left has **no test proving it**
(`docs/adr/0012-guard-de-orcamento-informativo.md:60@23c76213`). Treat any change to `catalog.ts` or
to a hash function as unprotected by the suite until those tests exist.

`--force` breaks **idempotency, not the budget** — that is why it still requires `--reason`
(`AGENTS.md:39@eb529ae5`). No CLI flag by that name exists in `cli.ts` today; the implemented lever
is the per-asset `salt` (`tools/pixellab-pipeline/src/catalog.ts:34-35@2a45b362`), and bumping it is
the same decision under a different name.

### What enters `specHash`, and what is excluded on purpose

`specHash` covers exactly `{endpoint, params, inputs, parents, pipelineVersion, salt?}`, with `salt`
omitted from the object when undefined — so `salt: undefined` and `salt: ""` are different specs
(`tools/pixellab-pipeline/src/catalog.ts:120@2a45b362`).

Three exclusions, each deliberate:

- **The OpenAPI snapshot hash.** If PixelLab edits a field the project never sends, including it
  would invalidate the whole catalog and produce a bill for zero benefit. Schema drift is a `doctor`
  warning, never invalidation (`tools/pixellab-pipeline/src/cli.ts:206@8d21d33a`).
- **`out` and `post`.** They live in `postHash` instead (`tools/pixellab-pipeline/src/catalog.ts:133@2a45b362`).
  Moving an output path therefore costs nothing.
- **`budgetGroup`.** Reporting metadata; regrouping the report must not rebill.

`inputHash` hashes **decoded pixels**, not file bytes:
`digest("WxHxC:" + digest(rawBuffer))` (`tools/pixellab-pipeline/src/catalog.ts:93@2a45b362`).
Re-encoding a PNG changes the bytes and not the image; hashing bytes would charge again for nothing.

`PIPELINE_VERSION = 1` (`tools/pixellab-pipeline/src/catalog.ts:15@2a45b362`). Bumping it regenerates
**everything**. That is a budget decision, never a refactor.

### The five plan actions, and the one that actually runs

`decide()` (`tools/pixellab-pipeline/src/catalog.ts:235@2a45b362`) returns
`skip | reprocess | redownload | generate | blocked-rejected`
(`tools/pixellab-pipeline/src/catalog.ts:160@2a45b362`), in that resolution order: rejected spec →
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

### The guard informs and never refuses

`GuardVerdict` loses the `refuse` variant. In its place comes a report carrying the estimate, the
session total, the month total, the balance, the warnings, and `requiresConfirmation` typed as the
literal `true` rather than `boolean` — that literal is what makes the compiler reject any future
path that generates without asking
(`docs/adr/0012-guard-de-orcamento-informativo.md:30-43@23c76213`). `RefusalCode` becomes
`WarningCode`; `DEFAULT_LIMITS` becomes `DEFAULT_THRESHOLDS` and **keeps the same four numbers** —
what changes is their meaning, from "refuse above this" to "warn above this"
(`docs/adr/0012-guard-de-orcamento-informativo.md:45@23c76213`). Confirmation is **per generation**
and shows three axes: this action, the session so far, the month so far
(`docs/adr/0012-guard-de-orcamento-informativo.md:46@23c76213`) — because a US$ 0.02 estimate
accepted three hundred times is exactly how an informative guard becomes a US$ 6 surprise
(`docs/adr/0012-guard-de-orcamento-informativo.md:59@23c76213`).

Numbers at `tools/pixellab-pipeline/src/cost.ts:293@e3fe3b1f`; evaluation order at `:326`.

| Threshold | Compares | Against |
|---|---|---|
| asset | most expensive single asset, **point** estimate | 0.30 |
| run | **high** (worst-case) estimate | 15 |
| monthly | spent-this-month + **point** | 60 |
| prompt | **point** | 5 |

`prompt` is a warning line, not the confirmation gate: confirmation is asked on **every** generation
whatever the estimate. Reading that row as "under US$ 5 goes through unasked" is exactly the
misreading the accumulated totals exist to prevent.

The balance check is a fourth branch with no stored number, evaluated before `prompt` — **point**
against 90% of the reported balance — and it is **skipped entirely** when the account reports a
subscription quota instead of dollars (`tools/pixellab-pipeline/src/api.ts:178@314e8627`).

The asset threshold exists to catch an accidental `mode='pro'` before submit: no single endpoint in
the cost table reaches 0.30, so it can only fire through the per-direction multiplier
(`docs/adr/0006-animacao-em-template-mode.md:27@554b0d42`) — `mode='pro'` bills **20–40 generations
per direction**, 160–320 for a full eight-direction set
(`docs/adr/0006-animacao-em-template-mode.md:21@554b0d42`). It still requires a recorded decision.
A guard warning is not that decision, and clicking through one is not either.

**The code still ships the old shape.** `cost.ts` still exports `DEFAULT_LIMITS`
(`tools/pixellab-pipeline/src/cost.ts:293@e3fe3b1f`) and a `refuse` variant
(`tools/pixellab-pipeline/src/cost.ts:300-305@e3fe3b1f`); `generate` still prints `RECUSADO` and
exits 2 on it (`tools/pixellab-pipeline/src/cli.ts:276-278@8d21d33a`), and `estimate` returns 2 on
the same verdict (`tools/pixellab-pipeline/src/cli.ts:165@8d21d33a`) — so `estimate` is **not yet**
the never-refuses command the ADR describes. Migrating both to the ADR shape is open work. Until
then, read a refusal you hit as a warning that has not been renamed yet — and never as a reason to
raise a number to get past it.

### Traps that cost real money

1. **`resume` breaks parent characters.** `runResume` rewrites the lock entry and drops `remote` and
   `requestSnapshot` (`tools/pixellab-pipeline/src/generate.ts:418@d7959fa4`). Child animations need
   `lock.assets[parent].remote.id` to inject `character_id` (`:136`), so resuming a parent
   permanently breaks every animation derived from it — recoverable only by paying again. Until this
   is fixed, back up `pixellab-lock.json` before `resume`.
2. **Same block sets `postHash: ''`** (`:420`), so `plan` reports `reprocess` forever afterwards.
3. **Non-PNG downloads vanish silently.** `extractImages` matches PNG/WebP URLs only (`:77`); a `.jpg`
   URL yields zero images, the record goes `stalled`, and the money is already gone.
4. **`map-objects` expiry is tighter than it looks.** The 8 h window is computed from *our*
   `completedAt`, not the API's creation time (`tools/pixellab-pipeline/src/queue.ts:211@2f4eeb8f`),
   so the real margin is under an hour. It is also the only ephemeral, non-re-downloadable resource
   — a lost local file means paying again.
5. **CI trap.** Non-TTY without `--yes` returns exit 2 even when nothing warned
   (`tools/pixellab-pipeline/src/cli.ts:285@8d21d33a`). Under the new contract that reading is
   correct: nobody confirmed.
6. **`verify` proves less than its name suggests.** It compares file existence and byte size only
   (`tools/pixellab-pipeline/src/cli.ts:176-181@8d21d33a`); the `sha256` recorded at generation time
   (`tools/pixellab-pipeline/src/generate.ts:169@d7959fa4`) is never re-read. A green `verify` means
   the artifacts are present and the right length — not that they are the right images. A truncated
   download that happens to match the recorded size passes.

### The never-resubmit rule

> "**Nunca resubmeta um job cujo id você tem.** É o bug mais caro possível neste sistema."
> — `docs/01-pixellab/modelo-assincrono.md:46@9335c20d`

Money leaves at submit, so the job id is written to disk atomically **before the first poll**
(`tools/pixellab-pipeline/src/generate.ts:265@d7959fa4`). Any record holding a `jobId` is re-polled
by `resume` and never resubmitted. The ledger is appended at submit too, which is why an interrupted
run still counts against the monthly threshold — and why the session and month totals shown at
confirmation time are trustworthy even after a crash.

## Procedure

```bash
cd tools/pixellab-pipeline

node src/cli.ts doctor        # environment, snapshot, catalog load
node src/cli.ts plan          # free, always. Read the action counts.
node src/cli.ts estimate      # free. Estimate + warnings — but still exits 2 on the old refuse path.
node src/cli.ts generate --dry-run --limit 1
node src/cli.ts generate --limit 1     # SPENDS. Confirm with the user, every time.
node src/cli.ts verify
node src/cli.ts atlas         # free
```

**After any crash, `rescue` comes first** — it downloads ephemeral resources before their deadline
(`tools/pixellab-pipeline/src/cli.ts:306@8d21d33a`). Then `resume`, which re-polls paid jobs and
never resubmits.

Exit codes are a contract: `0` ok · `1` error · `2` **the user did not confirm** · `4` paid jobs
pending, run `resume` · `5` artifact verification failed. Code `3` is documented and never returned —
no `return 3` exists (`tools/pixellab-pipeline/src/cli.ts:6@8d21d33a`). The meaning of `2` changed
with the guard: it used to mean "refused by budget"
(`docs/adr/0012-guard-de-orcamento-informativo.md:58@23c76213`), which is still what that header
comment says. Scripts that only test `!= 0` keep working; scripts that treat `2` as "over budget"
are now wrong.

`generate` has broad side effects and is **not** auto-invocable: confirm with the user, with the
estimate and both running totals in hand, before every run. Nothing mechanical will stop it for you.

## References

- `docs/adr/0012-guard-de-orcamento-informativo.md` — why the guard informs instead of refusing
- `docs/01-pixellab/custos-e-limites.md` — the per-endpoint estimated prices and their hedges
- `docs/01-pixellab/modelo-assincrono.md` — 202/poll/423/410/529 semantics
- Sibling skill `querying-pixellab-api` for anything about the API surface itself

## <evolution>

On task completion, run the memory pipeline. The external signal for this skill is
`cd tools/pixellab-pipeline && npm test && node src/cli.ts plan`: the suite must stay green **and**
`plan` must still report the same asset count on an unchanged catalog, with nothing new to generate
once the lockfile has entries. If `plan` starts wanting to generate what it previously skipped,
idempotency broke — that is a red signal, not a finding to record. The suite passing does **not**
prove idempotency: the six green tests cover atlas, util and endpoints only.

Record only what changes how future work here is done: a new trap, a corrected threshold, a
confirmed behaviour of the queue. Do not record run outcomes, asset counts, or costs of a particular
run — those are facts about a moment, not about the system. If the pipeline's untested modules
caused the finding, note that the signal was a user confirmation rather than a test, because
`catalog.ts`, `cost.ts`, `generate.ts` and `queue.ts` still have no coverage — the declared open
risk of loosening the guard (`docs/adr/0012-guard-de-orcamento-informativo.md:60@23c76213`).
