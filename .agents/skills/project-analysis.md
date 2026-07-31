# Project Analysis — Power Abuse

> **HISTORICAL — describes the product before the pivot.** This file surveys a permadeath MMORPG.
> That product no longer exists: `docs/adr/0010-pivo-para-editor-isometrico.md` replaced it with
> **isometric-maker**, a local single-user isometric game editor. Server authority, combat, permadeath
> and anti-cheat are out of scope. Kept because `project-router` names it part of the audit trail and
> forbids deleting it. Read it as a record of how the skill library came to be, never as current truth.

Phase 1 artifact of the knowledge-skills bootstrap. Input for `skill-map.md`.

Provenance format throughout: `path:line@blob8`, where `blob8` is the first 8 chars of
`git hash-object -- <path>` at analysis time. A changed hash means the citation is stale and the
passage must be revalidated, not that it is wrong.

**Language note.** This artifact and every generated SKILL.md body are in English, per the
architect directive that commissioned this system. That diverges from `AGENTS.md:5@e451cfee`,
which puts documentation in pt-BR. The divergence is deliberate and narrow: it covers only the
skills system (agent-facing instructions), not `docs/`, not the README, not game text. Router
questions and `TASK_PLAN.md` are pt-BR by hard requirement. Quotes from project docs stay verbatim
in Portuguese. If the owner prefers pt-BR skill bodies, that is a one-pass translation and an ADR.

---

## 1. Normative grounding

These are the rules that must shape every skill. Quoted, not paraphrased.

### 1.1 Money is the primary hazard

> "Todo asset gerado gasta dinheiro real. O pipeline é idempotente por design: gerar de novo com o
> mesmo spec **não deve gastar nada**." — `AGENTS.md:37@e451cfee`

> "**Sempre rode `pixellab plan` e `pixellab estimate` antes de qualquer geração.** Nunca use
> `--force` sem `--reason`. `generate` gasta dinheiro real." — `AGENTS.md:39@e451cfee`

> "**Nunca resubmeta um job cujo id você tem.** É o bug mais caro possível neste sistema."
> — `docs/01-pixellab/modelo-assincrono.md:46@b581e174`

Two hashing decisions are called out as load-bearing, and both are implemented as stated:

> "O `inputHash` é dos **pixels decodificados**, não dos bytes do arquivo." — `AGENTS.md:42@e451cfee`
> — implemented at `tools/pixellab-pipeline/src/catalog.ts:93@2a45b362`.

> "O hash do schema OpenAPI **não entra** no `specHash`. […] Drift de schema é **aviso** do
> `doctor`, nunca invalidação de cache." — `AGENTS.md:43@e451cfee` — implemented at
> `tools/pixellab-pipeline/src/catalog.ts:106@2a45b362`, warning at
> `tools/pixellab-pipeline/src/cli.ts:206@8d21d33a`.

### 1.2 Never write about the PixelLab API from memory

> "A API do PixelLab **muda sem versionar** — o `info.version` do spec é literalmente `"dev"`."
> — `AGENTS.md:22@e451cfee`

The vendored spec at `tools/pixellab-pipeline/openapi/openapi-v2.json` is the single source of
truth: `openapi 3.1.0`, `info.version="dev"`, 79 paths, 56 POST, 235 schemas, sha256
`5b11c9a7afa1…`, captured 2026-07-29 (`tools/pixellab-pipeline/openapi/PROVENIENCIA.txt:1@86625fb2`).

> Every price is an estimate: "All prices are estimates and will vary because of variation in the
> GPU processing time." — quoted at `docs/01-pixellab/custos-e-limites.md:14@0c85bc2b`. Skills must
> write "preço estimado", per `AGENTS.md:33@e451cfee`.

### 1.3 `mode='pro'` in animation is forbidden by default

> "custa 20–40 gerações **por direção** (160–320 para as 8). O default do projeto é
> `mode='template'`, que custa 1 geração por direção." — `AGENTS.md:45@e451cfee`,
> ratified by `docs/adr/0006-animacao-em-template-mode.md:5@554b0d42`.

### 1.4 Server authority is not negotiable

> "Nenhuma decisão de dano, acerto, morte, loot ou transação de item pode originar no cliente."
> — `AGENTS.md:51@e451cfee`

> "**nenhuma restauração, nunca.** Nem por bug do servidor, nem por queda de rede, nem por decisão
> de suporte." — `docs/adr/0003-permadeath-total.md:17@b24cc681`

Derived requirements, all normative: fail in the player's favour — "a morte só é real quando a
transação commita"; deterministic death-replay audit kept 30 days; exactly one living character per
account (`docs/adr/0003-permadeath-total.md:21-24@b24cc681`).

### 1.5 Language and commit conventions

Docs and player-facing text pt-BR; code identifiers, code folder names and commit messages English
(`docs/adr/0008-idioma-docs-ptbr-codigo-en.md:20@fff4be23`). And:

> "**Nunca assine `Co-authored-by Claude` automaticamente** — o usuário decide caso a caso."
> — `AGENTS.md:18@e451cfee`

### 1.6 Canonical direction order

`S, SW, W, NW, N, NE, E, SE` — "Nomear na ordem errada faz o sprite andar de lado, e é um bug
silencioso." (`docs/adr/0005-low-top-down-8-direcoes.md:25@0f447499`). Also: `TilesetCameraView`
accepts `low top-down` but **defaults to `high top-down`**, so it must be passed explicitly
(`docs/adr/0005-low-top-down-8-direcoes.md:19@0f447499`).

---

## 2. What is already guaranteed by tooling

Per the operating doctrine, none of this may be restated as prose in a skill. A skill points at the
check instead.

| Guarantee | Enforced by | Consequence for skills |
|---|---|---|
| One `# H1`; `> **Quick Start (TL;DR)**` blockquote; `## Referências`; `**Última atualização:** YYYY-MM-DD` | `scripts/check-docs.sh:14-17@45c21969` | Do not describe the format. Say "run the checker." |
| Every backticked `/endpoint` in `docs/**` exists in the vendored spec | `scripts/check-docs.sh:28-44@45c21969` | Same. Note the `DELIBERATE_V1` allowlist. |
| No `enum`, no `namespace`, no constructor parameter properties | `erasableSyntaxOnly` — `tools/pixellab-pipeline/tsconfig.json:16@e8e110a2`, `tools/character-builder/tsconfig.json:13@0e018a20` | Do not write a style rule. `npm run typecheck` is the rule. |
| `import type` mandatory for type-only imports | `verbatimModuleSyntax` — same files, `:15` / `:12` | Same. |
| Indexed reads are `T \| undefined` | `noUncheckedIndexedAccess` — `:11` / `:10` | Explains why `process.env['X']` bracket access is everywhere. |
| Optional properties are not assignable from `undefined` | `exactOptionalPropertyTypes` — `:12` / `:11` | Explains the conditional-spread idiom at `tools/pixellab-pipeline/src/cli.ts:240@8d21d33a`. |
| Switch fallthrough and missing `override` rejected — **pipeline only** | `noFallthroughCasesInSwitch`, `noImplicitOverride` — `tools/pixellab-pipeline/tsconfig.json:13-14@e8e110a2` | Scope matters: character-builder does not set these. |
| Atlas packing is byte-deterministic | `tools/pixellab-pipeline/src/atlas.test.ts:35@d28e4f8a` (6 tests) | The one existing regression net. |

**Not guaranteed by anything, currently prose only** (`AGENTS.md:55@e451cfee`): absolute paths,
ISO dates, syntax hint on every code block, honest pitfalls section, marking estimate/derived/
unverified, "Atualizar a tabela de `docs/README.md` ao adicionar uma doc nova — sempre", no
speculative docs, and the whole language split. These are the candidates where a skill's prose is
genuinely the only carrier — and where a new deterministic check would be worth more than more prose.

---

## 3. Annotated map

```text
power-abuse/
├── AGENTS.md                 5.6k, pt-BR, 12 doc conventions + 3 hard rules. CLAUDE.md -> symlink.
├── README.md                 entry point; 2 broken links (see §5)
├── scripts/check-docs.sh     the only pre-existing deterministic gate
├── docs/                     16 files on disk, 57 listed in the index -> 42 pending
│   ├── 01-pixellab/          5 written, 10 pending. The densest verified material in the repo.
│   ├── 02-design/            1 written (combate), 7 pending
│   ├── 03-arquitetura/       1 written (paper-doll), 7 pending
│   └── adr/                  0001..0008, all accepted. The normative core.
├── tools/pixellab-pipeline/  2.6k LoC. Money-critical. 6 tests, all on atlas/util/endpoints.
│   ├── openapi/              vendored spec + PROVENIENCIA.txt (source of truth for the API)
│   ├── assets/catalog.ts     17 assets; code that evaluates to data
│   └── src/                  api, catalog, cost, endpoints, generate, queue, atlas, util, cli
├── tools/character-builder/      1.5k LoC. Vite middleware; token stays server-side.
└── packages/game-assets/atlas/   empty. Nothing has ever been generated.
```

Runtime: Node 24.15.0 executing `.ts` directly via type stripping. **No build step, no workspace,
no root `package.json`** — each tool is installed and run independently
(`tools/pixellab-pipeline/package.json:11@395c57f1` is a no-op `build` that says exactly this).

---

## 4. Candidate knowledge areas

Ranked by (cost of not knowing) × (how non-inferable it is). This feeds `skill-map.md`.

### A. Pipeline cost and idempotency — highest value
The hash contract is precise and its exclusions are intentional: `specHash` covers exactly
`{endpoint, params, inputs, parents, pipelineVersion, salt?}` with `salt` omitted when undefined
(`tools/pixellab-pipeline/src/catalog.ts:120@2a45b362`); `postHash` covers only `{post, out}`
(`:133`); `PIPELINE_VERSION = 1` (`:15`) — bumping it regenerates everything and is a budget
decision, not a refactor.

Budget thresholds and, critically, *which statistic each branch uses*: asset cap 0.30 on the
**point** estimate, run cap 15 on the **high** estimate, monthly cap 60 on spent+point, balance
check skipped entirely when balance is undefined
(`tools/pixellab-pipeline/src/cost.ts:293-298,326-366@e3fe3b1f`).

### B. The PixelLab spec as a queryable artifact
The spec is 387 KB and nests enums under `anyOf: [{real}, {type:"null"}]`, so a flat
`.properties.x.enum` lookup misses most constraints. Verified recursive `jq` queries exist and
belong in a bundled script rather than in prose.

Three direction orderings coexist and this is a live trap: the spec's `Direction` enum starts at
`north` clockwise; `DIRECTIONS_8` at `tools/pixellab-pipeline/src/endpoints.ts:45@08e4ea43` starts
at `south` counter-clockwise (documented as the *return* order); and
`create-character-with-{4,8}-directions` has its own inline enum starting `south` clockwise.

`template_animation_id` is a plain string with **no enum** in the spec; its description lists 10 ids
then literally truncates with `...`. Any skill claiming a complete template list would be inventing
one — which `AGENTS.md:20@e451cfee` forbids.

### C. TypeScript execution model
`.ts` extension on every relative import and `node:` prefix on every builtin are not style — they
are what makes the same file resolve under both `NodeNext` (pipeline) and `bundler` (Vite). This
matters because `tools/character-builder/server/api.ts:15@8fb78ce5` imports the pipeline's client across
package boundaries by relative path, with no dependency declared in
`tools/character-builder/package.json@47dd51fc`. Code added to the pipeline's `api.ts` must satisfy the
stricter of the two tsconfigs.

### D. Testing as the verification backbone
`node --test src/*.test.ts` (`tools/pixellab-pipeline/package.json:16@395c57f1`). The existing
suite covers `atlas.ts`, `util.ts`, `endpoints.ts`. It does **not** cover `catalog.ts`, `cost.ts`,
`generate.ts` or `queue.ts` — the modules that decide whether money is spent. This is the single
largest correctness gap and it directly undermines the evolution design, which needs objective
signals.

### E. Documentation authoring
12 conventions, 5 enforced. Plus ADR mechanics: accepted ADRs are never edited; a revised decision
gets a new ADR that supersedes (`docs/adr/0008-idioma-docs-ptbr-codigo-en.md:29@fff4be23`,
`docs/README.md:116@fa318430`).

### F. Server authority rules for code that does not exist yet
Normative and complete in the ADRs, with zero implementation. Encoding them is not speculative
documentation — the decisions are already made and recorded; a skill distils them so the first
server commit does not have to rediscover them. Combat specifics: deterministic function of tick,
angle multipliers 1.0×/1.5×/2.5×, four anti-cheat layers, detection in log-only mode for 4–6 weeks
(`docs/02-design/combate-zonas-oscilantes.md:52-68@793c7279`,
`docs/adr/0004-combate-alvo-travado-zonas-oscilantes.md:15@baea0827`).

---

## 5. Defects found during analysis

Recorded here because several are traps a skill must warn about, and because a knowledge system
built on top of them would otherwise encode the bug as the rule.

**Money-losing:**
1. `runResume` rewrites the lock entry and drops `remote` and `requestSnapshot`
   (`tools/pixellab-pipeline/src/generate.ts:418-427@d7959fa4`). Since `resolveParams` needs
   `lock.assets[parent].remote.id` to inject `character_id` (`:136-144`), resuming a parent
   character permanently breaks every child animation — recoverable only by paying again.
2. Same block sets `postHash: existing?.postHash ?? ''` (`:420`), so `plan` reports `reprocess`
   forever after any resume.
3. `runGenerate` filters `action === 'generate'` only (`:186`). The `reprocess` and `redownload`
   actions are planned by `decide()` and executed by nothing.
4. `extractImages` recognises PNG/WebP only (`:73-78`); a `.jpg` download URL yields zero images and
   the record goes `stalled` with the money already spent.
5. The `map-objects` 8 h expiry is computed from *our* `completedAt`, not the API's creation time
   (`tools/pixellab-pipeline/src/queue.ts:211@2f4eeb8f`), so the real margin is under 1 h.

**Correctness / contract:**
6. Exit code 3 (`API drift (strict)`) is documented at `tools/pixellab-pipeline/src/cli.ts:6@8d21d33a`
   and never returned.
7. Non-TTY without `--yes` returns 2 even when the guard verdict is `allow` (`:285-288`) — a CI trap.
8. `verify` compares byte size only; the `sha256` recorded at
   `tools/pixellab-pipeline/src/generate.ts:169@d7959fa4` is never re-checked.
9. `packGrid` writes `specHashes: {}` and a hardcoded `fps: 8` into the sidecar
   (`tools/pixellab-pipeline/src/atlas.ts:312-313@e9504d6c`) — the provenance it claims to emit is
   not actually written.
10. `validateFrameBudget` (`tools/pixellab-pipeline/src/endpoints.ts:208@08e4ea43`) is never called
    from `buildPlan`.

**Referential:**
11. `npm run refresh-openapi` points at `tools/pixellab-pipeline/scripts/refresh-openapi.mjs`; the
    directory does not exist.
12. `npm run codegen` emits `openapi/schema.d.ts`, which nothing imports and which is not on disk —
    so the compile-error drift detector promised by `AGENTS.md:31@e451cfee` and
    `docs/adr/0002-cliente-rest-gerado-do-openapi.md:30@fbd2951e` is inert.
13. `README.md:13@8c45aa64` links `ferramentas/pixellab-pipeline/` (folder is `tools/`), and
    `README.md:11` links `docs/00-visao-geral/conceito.md`, which was never written. 15 broken
    markdown links repo-wide.
14. Dangling references in comments to a `guard.ts` and a `pixellab calibrate` command that do not
    exist (`tools/pixellab-pipeline/src/cost.ts:7,94@e3fe3b1f`).

These are **reported, not fixed** — fixing them is outside this mission's scope and each one is a
separate reviewable change.

---

## 6. Pre-existing skills outside this repo

`/home/ondokai/Projects/ferro-e-cinzas-skills/` holds two globally-installed skills,
`pixellab-assets` and `ferro-engine`, symlinked into every agent profile on the machine by its
`install.sh`. Both use pt-BR descriptions in a "what it does → Use ao … → load-bearing facts → NÃO
use para …" shape, and both are validated by a `validate.sh` that vendors Anthropic's
`quick_validate.py`.

They cover general PixelLab API lore and general engine design. They do **not** know that
`tools/pixellab-pipeline` and `tools/character-builder` exist — both landed after their
`last-reviewed` date — and they cover none of the repo's doc conventions, ADR workflow, or
build/test commands.

**Consequence for this system:** the in-repo skills must be repo-anchored and operational (how to
query *this* vendored spec, how to run *this* CLI, what *this* tsconfig already enforces), and must
cross-reference the global skills for general lore rather than restating it. Overlap is the main
sprawl risk here, and it is avoided by scope, not by omission.

---

## 7. Declared "not found"

- **No CI configuration.** No `.github/`, no pipeline definition anywhere. Every gate in this system
  therefore runs locally; wiring it to CI is future work, not something to describe as existing.
- **No linter or formatter.** No ESLint, Prettier, Biome, or editorconfig. "Code style" in this repo
  means exactly what the tsconfigs enforce plus what the existing code demonstrates — nothing else
  exists to cite.
- **No game code.** No client, no server, no netcode, no shared protocol package. `packages/`
  contains only an empty `game-assets/atlas/`.
- **No `.env`.** Only `.env.example`. The token is expected in the environment.
- **No exhaustive animation template list** anywhere — not in the spec, not in the docs.
- **No generated `openapi/schema.d.ts`.**
- **Tier concurrency for tiers 1–2, generations-per-month per tier, and regional price variation**
  are explicitly marked unverified at `docs/01-pixellab/custos-e-limites.md:237@0c85bc2b` and must
  stay marked that way.
