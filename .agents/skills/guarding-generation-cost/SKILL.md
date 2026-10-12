---
name: guarding-generation-cost
description: Runs the PixelLab asset pipeline without spending money by accident - the hash contract that makes regeneration free, the v3 cost formulas (create-character-v3 publishes ceil(w*h*8/65536) generations and enhance_prompt bills +0.05 generations in enhance_usage), a budget guard that warns on four thresholds and never refuses, and the plan-then-estimate-then-confirm order. Use whenever a task touches asset generation, the pixellab CLI, assets/catalog.ts, src/catalog.ts, src/cost.ts, src/generate.ts or src/queue.ts - including Portuguese phrasings like "gerar os sprites", "gerar os assets", "quanto custa", "regerar", "o cache invalidou", "retomar a fila", "travou no meio", "empacotar o atlas". Triggers on plan, estimate, generate, resume, rescue, atlas, lockfile, specHash, idempotencia, orcamento, saldo, limiar, confirmacao, v3, create-character-v3, animate-with-text-v3, generate-8-rotations-v3, inpaint-v3, enhance_prompt, enhance_usage, formula de custo, 65536.
metadata:
  type: task
  verification_signal: cd tools/pixellab-pipeline && npm test && node src/cli.ts plan
---

# Guarding generation cost

## When to use

Any time a command could submit a job, any time the catalog or the hashing changes, and immediately
after any crash or interruption. The v3 endpoints (`create-character-v3`, `animate-with-text-v3`,
`generate-8-rotations-v3`, `inpaint-v3`) changed what a "generation" costs and how it is reported —
read **The v3 cost model** below before budgeting any run that touches them.

## Injected knowledge

### The contract

> "Todo asset gerado gasta dinheiro real. O pipeline é idempotente por design: gerar de novo com o
> mesmo spec **não deve gastar nada**." — `AGENTS.md:39@2fce737a`

O teste de idempotência existe e passa em `catalog.test.ts` (`same catalog + lockfile ⇒ skip,
zero actions, zero cost`), mas não cobre todos os caminhos de regressão (reencode de PNG,
drift de schema, `runResume`). Trate mudanças em `catalog.ts` ou nas funções de hash como
parcialmente protegidas: o caso base está coberto, os casos de borda não.

`--force` breaks **idempotency, not the budget** — that is why it still requires `--reason`
(`AGENTS.md:41@2fce737a`). No CLI flag by that name exists in `cli.ts` today; the implemented lever
is the per-asset `salt` (`tools/pixellab-pipeline/src/catalog.ts:52@2d060d9d`), and bumping it is
the same decision under a different name.

### What enters `specHash`, and what is excluded on purpose

`specHash` covers exactly `{endpoint, params, inputs, parents, pipelineVersion, salt?}`, with `salt`
omitted from the object when undefined — so `salt: undefined` and `salt: ""` are different specs
(`tools/pixellab-pipeline/src/catalog.ts:158@2d060d9d`).

Three exclusions, each deliberate:

- **The OpenAPI snapshot hash.** If PixelLab edits a field the project never sends, including it
  would invalidate the whole catalog and produce a bill for zero benefit. Schema drift is a `doctor`
  warning, never invalidation (`tools/pixellab-pipeline/src/catalog.ts:150@2d060d9d`).
- **`out` and `post`.** They live in `postHash` instead (`tools/pixellab-pipeline/src/catalog.ts:181@2d060d9d`).
  Moving an output path therefore costs nothing.
- **`budgetGroup`.** Reporting metadata; regrouping the report must not rebill.

`inputHash` hashes **decoded pixels**, not file bytes:
`digest("WxHxC:" + digest(rawBuffer))` (`tools/pixellab-pipeline/src/catalog.ts:134@2d060d9d`).
Re-encoding a PNG changes the bytes and not the image; hashing bytes would charge again for nothing.

`PIPELINE_VERSION = 1` (`tools/pixellab-pipeline/src/catalog.ts:33@2d060d9d`). Bumping it regenerates
**everything**. That is a budget decision, never a refactor.

### The five plan actions, and the one that actually runs

`decide()` (`tools/pixellab-pipeline/src/catalog.ts:363@2d060d9d`) returns
`skip | reprocess | redownload | generate | blocked-rejected`
(`tools/pixellab-pipeline/src/catalog.ts:213@2d060d9d`), in that resolution order: rejected spec →
no lock entry → specHash mismatch → artifacts present (postHash equal ⇒ `skip`, else `reprocess`) →
artifacts missing but remotely cacheable and not ephemeral ⇒ `redownload` (free) → else `generate`
(paid).

**Known gap:** `runGenerate` filters `action === 'generate'` only
(`tools/pixellab-pipeline/src/generate.ts:225@0363a7a0`). `reprocess` and `redownload` are planned
and executed by nothing. If a plan shows them, the work has to be done another way — do not assume
`generate` will pick them up.

`rejectedHashes` is keyed by **specHash, not asset id**, so rejecting one blocks that exact spec
anywhere in the catalog (`tools/pixellab-pipeline/src/catalog.ts:368@2d060d9d`). No code writes it;
it is hand-edited into the lockfile.

Validation runs before anything is submitted, because a 422 arrives after the charge — including
the rule that **every spec must lock its seed**: `seed` omitted or null is a validation error, never
a submission (`tools/pixellab-pipeline/src/catalog.ts:268@2d060d9d`).

### The v3 cost model — published formulas, and where they stop

**`create-character-v3` publishes an exact generations formula** in the endpoint description — the
only endpoint in the whole API that does. Most others live on unpublished price-page tables.

- Reference-image mode: `ceil(w*h*8 / 65536)` generations (w, h = the `reference_image`).
- From scratch: `1 + ceil(s²*8 / 65536)` generations, where s = max(width, height) — one Pixen
  generation plus the v3 rotation.
- **Divergence:** the formula and the price-page table disagree. 64×64 → 1 (formula) vs 2
  (published); 128×128 → 2 vs 3; 168×168 → 4 vs 5; 256×256 → 8 vs unpublished. Both sources are
  PixelLab's own. **Budget with the larger** — erring up only leaves balance
  (`docs/01-pixellab/custos-e-limites.md:57@fe52f3d5`).
- `enhance_prompt` is a separate billing line: **+0.05 generations**, returned in `enhance_usage`
  alongside the generation `usage`. Only valid from scratch — combining it with `reference_image`
  is a 422 (`docs/adr/0019-create-character-v3-e-o-caminho-do-personagem.md:115@f0a55da7`).
- The other v3 endpoints have **no published generations formula**: `animate-with-text-v3`,
  `generate-8-rotations-v3` and `inpaint-v3` are estimated from price-page USD points
  (`tools/pixellab-pipeline/src/cost.ts:139@84fca7a8`, `:158`, `:225`). `animate-with-text-v3` also
  charges +0.05 generations for `enhance_prompt`, per the spec prose.
- Standalone prompt enhancement (`enhance-character-v3-prompt`, `enhance-animation-v3-prompt`)
  costs ~US$ 0,002 per call (`docs/01-pixellab/custos-e-limites.md:119@fe52f3d5`) — cheap, **not free**.
- `generate-8-rotations-v3` at 64×64 costs almost 2× `create-character-with-8-directions` and does
  less — it returns frames, no `character_id`, so nothing animatable
  (`docs/01-pixellab/custos-e-limites.md:83@fe52f3d5`).
- "v3" is a **model generation name, not an API version** — all six v3 endpoints are served under
  `https://api.pixellab.ai/v2` (`docs/adr/0019-create-character-v3-e-o-caminho-do-personagem.md:125@f0a55da7`).

`cost.ts` still models the v3 endpoints by USD points read from the price page
(`tools/pixellab-pipeline/src/cost.ts:4@84fca7a8`), and `create-character-v3` carries a generations
range `[2, 9]` (`tools/pixellab-pipeline/src/cost.ts:72@84fca7a8`). The real charge arrives in
`usage` (and `enhance_usage`) in the submit response and is recorded in the ledger
(`tools/pixellab-pipeline/src/generate.ts:312@0363a7a0`) — that is the reconciliation point where
formula, table and reality get compared. Nothing automated reads that back yet: closing the
formula-vs-table divergence costs one paid generation, and nobody has spent it.

Size constraints that change the formula inputs:

- `reference_image` max 256×256; from-scratch `image_size` is 32–256 per `V3OutputImageSize` even
  though the endpoint prose says 16–256 — a 16×16 request is documented as legal and invalid at the
  same time. Use 32 as the floor (`docs/adr/0019-create-character-v3-e-o-caminho-do-personagem.md:113@f0a55da7`).
- `image_size` is **advisory** in reference mode; the model derives the output size from the input
  (`docs/adr/0019-create-character-v3-e-o-caminho-do-personagem.md:108@f0a55da7`).
- Final canvas comes back **padded ~2×** for animation room, capped at 256
  (`docs/adr/0019-create-character-v3-e-o-caminho-do-personagem.md:110@f0a55da7`).
- `animate-with-text-v3` pixel budget: `width × height × frame_count ≤ 524.288`, `frame_count` 4–16.

### The guard informs and never refuses

The ADR 0012 shape is now exactly what the code ships — the migration an older text of this skill
called "open work" is done. `checkBudget` always returns `requiresConfirmation: true` as a literal
(`tools/pixellab-pipeline/src/cost.ts:516@84fca7a8`); `estimate` always exits 0
(`tools/pixellab-pipeline/src/cli.ts:243@ba05ffb8`); `generate` exits 2 only when the user did not
confirm (`tools/pixellab-pipeline/src/cli.ts:396@ba05ffb8`).

Four warning codes are live: `asset-cap`, `run-cap`, `monthly-cap`, `balance`
(`tools/pixellab-pipeline/src/cost.ts:391@84fca7a8`). `promptAboveUsd` still exists in
`BudgetThresholds` but no code reads it — a vestige, not a gate.

| Code | Compares | Against |
| --- | --- | --- |
| `asset-cap` | most expensive single asset, **point** estimate | 0.30 |
| `run-cap` | **high** (worst-case) estimate | 15 |
| `monthly-cap` | spent-this-month + **point** | 60 |
| `balance` | **point** against 90% of the reported balance; skipped when the account reports a subscription quota | — |

Numbers at `tools/pixellab-pipeline/src/cost.ts:384@84fca7a8`; checks at `:464`, `:475`, `:486`,
`:497`. Confirmation is asked on **every** generation whatever the estimate — the accumulated totals
exist precisely because a US$ 0,02 estimate accepted three hundred times is how an informative guard
becomes a US$ 6 surprise (`docs/adr/0012-guard-de-orcamento-informativo.md:59@23c76213`).

The `asset-cap` threshold exists to catch an accidental `mode='pro'` before submit: no single
endpoint in the cost table reaches 0.30, so it can only fire through the per-direction multiplier
(`docs/adr/0006-animacao-em-template-mode.md:27@554b0d42`). It still requires a recorded decision.
A guard warning is not that decision, and clicking through one is not either.

### The money traps

1. **Re-encoding a PNG changes bytes, not pixels.** `inputHash` hashes decoded pixels
   (`tools/pixellab-pipeline/src/catalog.ts:134@2d060d9d`; `AGENTS.md:45@2fce737a`). Hashing bytes
   would charge again for nothing.
2. **Schema drift is a `doctor` warning, never cache invalidation.** The schema hash never enters
   `specHash` (`AGENTS.md:46@2fce737a`); a revendor that changes nothing the project sends must not
   bill.
3. **`mode='pro'` in animation costs 20–40 generations per direction**, 160–320 for a full
   eight-direction set; `mode='template'` is 1 per direction and the project default
   (`docs/adr/0006-animacao-em-template-mode.md:21@554b0d42`; `AGENTS.md:48@2fce737a`).
4. **Re-submitting without a seed is a new charge.** `seed` is optional on every v3 endpoint (the
   spec only marks it `min=0`, never required) and the API rolls a random one — the same prompt, a
   different image, a new bill. The catalog refuses to plan an unseeded spec
   (`tools/pixellab-pipeline/src/catalog.ts:268@2d060d9d`). Manual API calls have no such guard.
5. **Status-code branching: a 200 can be async.** `create-character-v3`, `animate-with-text-v3` and
   `generate-8-rotations-v3` all answer **200 + `background_job_id`**; only `inpaint-v3` answers
   **202**. All four are async in reality — branch on the presence of `background_job_id`, never on
   the status code. The pipeline never sees this trap because it dispatches on `ENDPOINTS[].async`
   and polls, not on the status code.
6. **v3-specific traps:**
   - `enhance_prompt` is a billing line, not a free switch — +0.05 generations reported in
     `enhance_usage`, 422 with `reference_image`
     (`docs/adr/0019-create-character-v3-e-o-caminho-do-personagem.md:115@f0a55da7`).
   - The published formula and the price-page table disagree on `create-character-v3`; budget with
     the larger of the two (`docs/01-pixellab/custos-e-limites.md:68@fe52f3d5`).
   - Closed schemas: `CreateCharacterV3Request` is `additionalProperties: false`, and the PixelLab
     MCP advertises fields it rejects (`proportions`, `text_guidance_scale`, `shading`) — a 422
     arrives after the charge (`docs/adr/0019-create-character-v3-e-o-caminho-do-personagem.md:100@f0a55da7`).
   - `reference_image` must be **south-facing** for best results; the model is trained around it.

### Operational traps

Still true, and independent of v3:

- **`map-objects` expiry is tighter than it looks.** The 8 h window is computed from *our*
  `completedAt` with an hour of margin (`tools/pixellab-pipeline/src/queue.ts:236@35e0e71d`), and it
  is the only ephemeral, non-re-downloadable resource — a lost local file means paying again.
  `rescue` exists for this; it is the FIRST command after any crash
  (`tools/pixellab-pipeline/src/cli.ts:429@ba05ffb8`).
- **`resume` edge cases.** Current `resume` reconstructs `remote` from the queue record's
  `resourceId` and preserves an existing `postHash` (`tools/pixellab-pipeline/src/generate.ts:505@0363a7a0`),
  so a parent character survives a resume — but when no lock entry exists, `postHash` falls back to
  `""` and `plan` reports `reprocess` forever afterwards (`tools/pixellab-pipeline/src/generate.ts:59@0363a7a0`),
  and `reprocess` is planned by nothing. Back up `pixellab-lock.json` before `resume`.
- **Non-PNG download URLs vanish silently.** `extractImages` matches only `.png`/`.webp` URLs
  (`tools/pixellab-pipeline/src/generate.ts:97@0363a7a0`); a `.jpg` URL yields zero images, the
  record goes `stalled`, and the money is already gone.
- **CI trap.** Non-TTY without `--yes` returns exit 2 even when nothing warned
  (`tools/pixellab-pipeline/src/cli.ts:400@ba05ffb8`). Under the new contract that reading is
  correct: nobody confirmed.
- **`verify` proves less than its name suggests.** It compares file existence and byte size only
  (`tools/pixellab-pipeline/src/cli.ts:261@ba05ffb8`); the `sha256` recorded at generation time is
  never re-read. A truncated download that matches the recorded size passes.

### The never-resubmit rule

> "**Nunca resubmeta um job cujo id você tem.** É o bug mais caro possível neste sistema."
> — `docs/01-pixellab/modelo-assincrono.md:46@9335c20d`

Money leaves at submit, so the job id is written to disk atomically **before the first poll**
(`tools/pixellab-pipeline/src/generate.ts:305@0363a7a0`). Any record holding a `jobId` is re-polled
by `resume` and never resubmitted. The ledger is appended at submit too
(`tools/pixellab-pipeline/src/generate.ts:312@0363a7a0`), which is why an interrupted run still
counts against the monthly threshold — and why the session and month totals shown at confirmation
time are trustworthy even after a crash.

## Procedure

```bash
cd tools/pixellab-pipeline

node src/cli.ts doctor        # environment, snapshot, catalog load
node src/cli.ts plan          # free, always. Read the action counts.
node src/cli.ts estimate      # free, never refuses, always exits 0.
node src/cli.ts generate --dry-run --limit 1
node src/cli.ts generate --limit 1     # SPENDS. Confirm with the user, every time.
node src/cli.ts verify
node src/cli.ts atlas         # free
```

**After any crash, `rescue` comes first** — it downloads ephemeral resources before their deadline
(`tools/pixellab-pipeline/src/cli.ts:429@ba05ffb8`). Then `resume`, which re-polls paid jobs and
never resubmits.

Exit codes are a contract: `0` ok · `1` error · `2` **the user did not confirm** · `4` paid jobs
pending, run `resume` · `5` artifact verification failed. Code `3` is documented and never returned
(`tools/pixellab-pipeline/src/cli.ts:5@ba05ffb8`). The meaning of `2` changed with the guard: it
used to mean "refused by budget"; scripts that only test `!= 0` keep working, scripts that treat
`2` as "over budget" are now wrong.

`generate` has broad side effects and is **not** auto-invocable: confirm with the user, with the
estimate and both running totals in hand, before every run. Nothing mechanical will stop it for you.

## References

- `docs/adr/0012-guard-de-orcamento-informativo.md` — why the guard informs instead of refusing
- `docs/adr/0019-create-character-v3-e-o-caminho-do-personagem.md` — the v3 path, its costs and its traps
- `docs/adr/0006-animacao-em-template-mode.md` — mode='template' vs mode='pro' generation math
- `docs/01-pixellab/custos-e-limites.md` — the per-endpoint estimated prices and the formula/table divergence
- `docs/01-pixellab/modelo-assincrono.md` — 202/poll/423/410/529 semantics
- Sibling skill `querying-pixellab-api` for anything about the API surface itself

## registo de aprendizado (memória CoALA local)

On task completion, run the memory pipeline. The external signal for this skill is
`cd tools/pixellab-pipeline && npm test && node src/cli.ts plan`: the suite must stay green **and**
`plan` must still report the same asset count on an unchanged catalog, with nothing new to generate
once the lockfile has entries. If `plan` starts wanting to generate what it previously skipped,
idempotency broke — that is a red signal, not a finding to record.

**The v3 transition changed what this skill vouches for.** Every v3 cost claim here comes from spec
prose or the price page — the published formula (`ceil(w*h*8/65536)`, `1 + ceil(s²*8/65536)`), the
+0.05 `enhance_prompt` charge, the formula-vs-table divergence — and none of it has been checked
against a real billed response. The first paid run that reads `usage`/`enhance_usage` back and
compares with the estimate closes that gap; the ledger already records both sides at submit
(`tools/pixellab-pipeline/src/generate.ts:312@0363a7a0`). If the divergence resolves, or the 0.05
enhance charge turns out to be different, that is a finding that changes how every future budget is
computed — record it with the note that the signal came from a paid run's `usage` readout, not from
a test. That is also the moment to revalidate the formula trap text above.

The suite passing proves the common idempotency path (`catalog.test.ts`), but the uncovered edge
cases — `runResume` lockfile entries, POST retry without idempotency key, `WeightedSemaphore`
interleaving — can still produce silent regressions. Record only what changes how future work here
is done: a new trap, a corrected threshold, a confirmed behaviour of the queue. Do not record run
outcomes, asset counts, or costs of a particular run — those are facts about a moment, not about
the system.
