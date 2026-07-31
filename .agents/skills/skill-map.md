# Skill Map

> **HISTORICAL — describes the library as designed for the pre-pivot product.** The game it assumed
> no longer exists: `docs/adr/0010-pivo-para-editor-isometrico.md` turned this repository into
> **isometric-maker**, a local single-user isometric game editor. `enforcing-server-authority`, which
> this map argues for in §2.7, has been retired with no successor. Kept because `project-router` names
> it part of the audit trail. The live index is `catalog.md`.

Phase 2 artifact. Proposes the library before any file is generated. Input: `project-analysis.md`.

Nine skills: one router, three knowledge, three task, two meta.

---

## 1. Granularity: why nine and not four or twenty

Routing degrades as the catalog grows — every extra description is another chance for the selector
to pick the near-miss. So the question is not "what could be a skill" but "what would be *mis-routed*
if merged, or *never retrieved* if split".

**The split test applied to each borderline pair:**

| Pair considered | Decision | Why |
|---|---|---|
| PixelLab API facts × pipeline cost workflow | **split** | Different questions with different answers. "Does `/create-tileset` accept `tile_size: 64`?" is answered by reading the spec and costs nothing. "Should I generate these 17 assets?" is answered by the budget guard and costs money. Merging would put a 400-line reference in front of every cheap lookup. |
| Doc conventions × ADR authoring | **merge** | Both are markdown authoring under `docs/`, both are validated by the same `check-docs.sh`, and their triggers overlap enough that a router asked to "document this decision" could plausibly pick either. One skill with a clearly-headed ADR section routes better than two competing ones. |
| TypeScript conventions × testing | **split** | The verification signals differ (`typecheck` vs `test`) and testing is a *dependency of the evolution system itself* — every task skill needs it to produce the external signal. Burying it inside a style skill would hide the backbone. |
| Server authority × combat design | **merge** | Both are ADR-derived constraints on code that does not exist yet. Two speculative skills would be twice the sprawl for the same zero implementations. |
| Evolution × consolidation | **split** | Mandated by the architecture, and genuinely different: evolution is per-task and additive, consolidation is periodic and subtractive. Merging would put deletion logic on a hot path. |

**Minimal-set discipline.** The reference minimal set is router + style + 2–3 domains + testing =
six or seven. This map lands at seven functional skills plus the two mandated meta-skills. Nothing
was added "for completeness": there is no skill for the character-builder UI (its README already carries
that knowledge and it is a leaf tool), none for git workflow (three rules, they live in `AGENTS.md`),
and none for cloud/infra (`AGENTS.md:73@e451cfee` forbids documenting infra that does not exist).

**Scope boundary against the global skills.** `/home/ondokai/Projects/ferro-e-cinzas-skills/` already
installs `pixellab-assets` and `ferro-engine` machine-wide. Those carry *general* API lore and
*general* engine design. The in-repo skills carry what is true of **this repository**: this vendored
spec, this CLI, these tsconfigs, this test runner, these ADRs. Each in-repo skill that overlaps names
its global counterpart and defers to it rather than restating it.

---

## 2. The catalog

### 2.1 `project-router` — router

- **Type:** router · **Verification signal:** n/a (routers are validated by routing evals, not by content)
- **Triggers:** every implementation request — change, fix, feature, refactor, analysis — whether or
  not the user mentions skills.
- **Why it exists:** it is the only entry point. Without a single mandated router, skill selection
  falls back to the model's judgement over nine descriptions, which is exactly the unreliable-judge
  problem the architecture is built to avoid.
- **Load-bearing behaviours:** asks many clarifying questions **in Brazilian Portuguese**; writes
  `TASK_PLAN.md` in Portuguese; assembles the skill chain; runs each involved skill's `<evolution>`
  at the end; **deletes `TASK_PLAN.md`** and never touches the bootstrap artifacts.

### 2.2 `querying-pixellab-api` — knowledge

- **Type:** knowledge · **Verification signal:** `node .agents/skills/scripts/check-spec-claims.mjs`
  — every endpoint path and enum value the skill asserts must resolve in the vendored spec. This is
  the deterministic form of the repo's hardest rule.
- **Triggers:** any mention of a PixelLab endpoint, parameter, enum, size limit, price, animation
  template, direction ordering, `background_job_id`, or refreshing the spec.
- **Why it exists:** `AGENTS.md:22@e451cfee` forbids writing about this API from memory, and the
  spec is 387 KB with enums nested under `anyOf: [{real},{null}]` so naive lookups silently miss
  constraints. The skill's job is to make consulting the spec cheaper than guessing.
- **Bundles:** `scripts/inspect-spec.mjs` (tested `jq`/node queries as a CLI), plus
  `references/spec-queries.md`.
- **Must carry:** the three coexisting direction orderings; that `template_animation_id` has **no
  enum** and is therefore unenumerable; that all prices are estimates; the unresolved
  `create-character-v3` price conflict.
- **Defers to:** global `pixellab-assets` for general cost lore and licensing.

### 2.3 `guarding-generation-cost` — task

- **Type:** task · **Verification signal:**
  `cd tools/pixellab-pipeline && npm test && node src/cli.ts plan` — the suite must stay green and
  `plan` must remain free and idempotent (same catalog, same lockfile → nothing to generate).
- **Triggers:** generating assets; editing `assets/catalog.ts`, `src/catalog.ts`, `src/cost.ts`,
  `src/generate.ts`, `src/queue.ts`; running any `pixellab` command; asking what something costs;
  recovering from an interrupted run.
- **Why it exists:** this is where real money leaves. The hash contract and the guard thresholds are
  precise, their exclusions are deliberate, and several of them look like bugs until you know why.
- **Must carry:** what enters `specHash` and what is deliberately excluded; `postHash` vs `inputHash`;
  the five `decide()` actions and the fact that only `generate` is ever executed; the four guard
  branches and *which statistic each uses*; the `resume`-drops-`remote` trap; the `map-objects` 7 h
  effective margin; `rescue` first after any crash.
- **Depends on:** `querying-pixellab-api` (endpoint facts), `writing-repo-typescript` (it edits `.ts`),
  `testing-repo-code` (it needs the signal).

### 2.4 `writing-repo-typescript` — knowledge

- **Type:** knowledge · **Verification signal:**
  `cd tools/pixellab-pipeline && npm run typecheck && cd ../character-builder && npm run typecheck`
- **Triggers:** writing or editing any `.ts` under `tools/`; adding an import; adding a dependency;
  wondering why a construct is rejected.
- **Why it exists:** the execution model is unusual (Node 24 type-stripping, no build step) and it
  makes two normally-cosmetic choices load-bearing: the `.ts` extension on relative imports and the
  `node:` prefix on builtins are what let the same file resolve under `NodeNext` and `bundler` at once.
- **Must carry:** the tooling-guaranteed table (pointing at `typecheck`, never restating the rules);
  the cross-package import at `tools/character-builder/server/api.ts:15@8fb78ce5` and the constraint it
  creates; that there is no workspace and no root manifest.
- **Explicitly must NOT carry:** prose restating `strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`
  or `noUncheckedIndexedAccess`. Those are compiler flags; the compiler is the documentation.

### 2.5 `testing-repo-code` — task

- **Type:** task · **Verification signal:** `cd tools/pixellab-pipeline && npm test`
- **Triggers:** writing or running a test; changing money-critical modules; needing an objective
  signal before persisting anything; asking whether something is covered.
- **Why it exists:** it is the backbone of the whole evolution design. `<external_validation_rule>`
  requires an objective signal, and in this repo that signal is almost always `node --test`.
- **Must carry:** the runner invocation and the single-test filter; the co-located `*.test.ts`
  convention; **the coverage gap** — `catalog.ts`, `cost.ts`, `generate.ts` and `queue.ts` have no
  tests, so a change there currently produces no signal and therefore cannot authorise a skill update.
- **Known tension, stated honestly:** until those tests exist, `guarding-generation-cost` can only
  evolve on a user confirmation, not on a test. The skill says so rather than pretending otherwise.

### 2.6 `writing-project-docs` — task

- **Type:** task · **Verification signal:** `bash scripts/check-docs.sh`
- **Triggers:** creating or editing anything under `docs/`, the README, or an ADR; recording a
  decision; revising a decision already recorded.
- **Why it exists:** twelve conventions, five of them enforced. The other seven are the ones an agent
  silently violates — especially "update the `docs/README.md` table, always".
- **Must carry:** which five are checked and which seven are not; the pt-BR/English split by axis;
  **ADR mechanics** — accepted ADRs are never edited, a revision is a new ADR that supersedes, and
  editing one is the irreversible act this skill guards.

### 2.7 `enforcing-server-authority` — knowledge

- **Type:** knowledge · **Verification signal:** eval invariants + explicit user confirmation.
  **This is the weakest signal in the system and is labelled as such**: there is no server code, so
  there is no test to run. Any evolution of this skill therefore requires a human to confirm, per
  `<external_validation_rule>`'s explicit-confirmation clause.
- **Triggers:** writing client, server, netcode, combat, damage, hit, death, loot, inventory,
  trade, or anti-cheat code; designing a protocol message; anything where the client could decide
  something.
- **Why it exists:** the decisions are already made and recorded in ADRs 0003/0004/0007; the code
  that must obey them has not been written yet. Encoding them now is distillation, not speculation —
  the first server commit should not have to rediscover that infrastructure failure must never kill
  a character.
- **Must carry:** the five non-negotiables; fail-in-the-player's-favour; one living character per
  account; the angle multipliers and the four anti-cheat layers; detection log-only for 4–6 weeks;
  and the two open problems (group combat, ranged) marked as unresolved.
- **Defers to:** global `ferro-engine` for the broader design rationale.

### 2.8 `meta-skill-evolution` — meta

- **Type:** meta · **Verification signal:**
  `node .agents/skills/scripts/lint-skills.mjs && node .agents/skills/scripts/run-skill-evals.mjs`
- **Triggers:** end of every task, via each task skill's `<evolution>` section; or when no skill
  covers a request.
- **Why it exists:** it owns the five-step memory pipeline and the decision among *update an existing
  skill*, *propose a new one as a draft*, and *discard*. Discard is the default and the common case.
- **Enforced by:** the `guard-skill-write` PreToolUse hook, which blocks modification of an existing
  SKILL.md without a fresh validation token. The skill describes the policy; the hook is the guarantee.

### 2.9 `meta-skill-consolidate` — meta

- **Type:** meta · **Verification signal:** same as above, plus a diff for human review before any
  deletion.
- **Triggers:** periodic garbage collection; a skill exceeding its token budget; stale-provenance
  warnings from the linter; a suspected contradiction between skills.
- **Why it exists:** unrestricted memory growth is measurably harmful; selective addition *plus*
  deletion is what makes the system improve rather than accrete. Deletion is the irreversible half,
  so it is separated, gated by a second-opinion review, and always emitted as a diff.

---

## 3. Dependency and composition graph

```text
                        ┌──────────────────┐
   every user request → │  project-router  │ ── asks (pt-BR) → TASK_PLAN.md → chain
                        └────────┬─────────┘
                                 │ selects
        ┌────────────────┬───────┴────────┬──────────────────┐
        ▼                ▼                ▼                  ▼
 querying-        guarding-        writing-           enforcing-
 pixellab-api ◄── generation- ──►  project-docs       server-authority
        ▲          cost                                     │
        │            │                                      │
        │            ├──────► writing-repo-typescript ◄─────┤
        │            │                    ▲
        │            └──────► testing-repo-code ────────────┘
        │                              (supplies the external signal)
        │
        └── defers to global skill `pixellab-assets` for general API lore
            (enforcing-server-authority defers to global `ferro-engine`)

   at task completion, every task skill runs:
        <evolution> ──► meta-skill-evolution ──► [update | propose draft | discard]
                                  │
                                  └── blocked by guard-skill-write unless a fresh
                                      validation token exists

   periodically:
        meta-skill-consolidate ──► dedupe · conflict · staleness · budget ──► diff for review
```

**Parallelisable:** `querying-pixellab-api` and `writing-project-docs` are read-mostly and can be
loaded by isolated-context subagents concurrently. `guarding-generation-cost` is **never**
parallelised with another money-touching chain — concurrent `generate` runs would race the ledger,
which is append-at-submit (`tools/pixellab-pipeline/src/generate.ts:265@d7959fa4`).

**Auto-invocation policy:** `guarding-generation-cost` may plan and estimate freely, but `generate`
has broad side effects (it spends) and requires explicit user confirmation.
`meta-skill-consolidate`'s deletions likewise require confirmation.

---

## 4. Eval contract

Every skill gets `.agents/skills/evals/<name>.json`, and the shape is fixed so the runner stays
deterministic:

```json
{
  "skill": "guarding-generation-cost",
  "min_overlap": 2,
  "routing": [
    { "query": "gerar os sprites das criaturas", "should_trigger": true },
    { "query": "trocar a cor do botão da UI",    "should_trigger": false }
  ],
  "invariants": [
    { "must_contain": "plan", "why": "the free-first workflow is the point of the skill" }
  ],
  "check_provenance": true
}
```

- **routing** — deterministic vocabulary overlap between the query and the skill's `description`.
  A `should_trigger: true` case that does not overlap means the description lacks the words a real
  request would use; a `should_trigger: false` case that *does* overlap means the description is too
  broad and will steal traffic from a sibling skill. Both are real defects in the only signal the
  selector sees.
- **invariants** — substrings that must survive in the body. This is the regression gate: if an
  evolution edit removes a load-bearing constraint, the eval flips red and the change is discarded.
- **check_provenance** — every `file:line@hash` citation must resolve. A missing file or an
  out-of-range line fails; a changed hash warns (stale → revalidate), because otherwise every edit to
  a cited file would break every skill citing it.

---

## 5. What Phase 3 must produce

| Path | Contents |
|---|---|
| `.agents/skills/<name>/SKILL.md` | nine skills, per `<skill_template>` |
| `.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs` | spec query CLI |
| `.agents/skills/querying-pixellab-api/references/spec-queries.md` | the tested query recipes |
| `.agents/skills/scripts/check-spec-claims.mjs` | verification signal for the API skill |
| `.agents/skills/scripts/run-skill-evals.mjs` | the eval runner and token writer |
| `.agents/skills/catalog.md` | llms.txt-style index the router reads |

Phase 4 adds the hooks wiring, the eval suites, and the `<evolution>` sections; Phase 5 proves the
whole loop with an accepted case, a blocked case, and a discarded regression.

---

## 6. Amendment: the PixelLab knowledge split

Sections 1–5 record the library as first designed and are left intact as the audit trail. This
section records a later, deliberate departure from section 1's granularity argument.

**What changed.** `querying-pixellab-api` was one 123-line skill standing in for 79 endpoints across
20 spec groups. Section 1 argued against splitting on the grounds that routing degrades as the
catalog grows. That argument was right about the *cost* and wrong about the *balance*: the single
skill was not mis-routed, it was **under-informed**. It could tell an agent where to look and almost
nothing about what it would find there, so every non-trivial question fell back to reading a 387 KB
JSON — or, worse, to memory, which is exactly what `AGENTS.md:22@e451cfee` forbids.

**The new shape.** One hub plus nine domain skills, sliced along the spec's own tag groups:

| Hub | Families |
|---|---|
| `querying-pixellab-api` — spec discipline, the three structural traps, provenance, refresh | characters · rotation · animation · objects · tilesets · image creation · image editing · portraits · interfaces · jobs |

**Why tag groups and not some other axis.** The spec already partitions itself, the partition matches
how work actually arrives ("gerar o tileset" is not "animar o personagem"), and it is mechanically
checkable: `inspect-spec.mjs tag` enumerates the groups, so drift between the library and the snapshot
is visible rather than inferred. Coverage is 79/79 with no endpoint in two skills.

**The routing risk section 1 warned about is real and is handled by measurement, not by assertion.**
Ten sibling descriptions share heavy vocabulary. Every one carries a routing eval with negative cases
drawn from its closest siblings, and three descriptions were rewritten during Phase 3 because the eval
proved they lacked the words a real request uses. Descriptions are a measured surface here, not prose.

**What this cost.** Nine more `SKILL.md` and nine more eval suites to keep green, and a real risk of
duplicated passages across siblings — which is `meta-skill-consolidate`'s job to catch on its next
sweep. The hub deliberately keeps the cross-cutting rules so the families do not each restate them.
