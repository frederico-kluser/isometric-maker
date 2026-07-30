# Skill catalog

Index the router reads before selecting. One line per skill: what it owns, when it fires, and what
signal authorises changing it.

Source of truth: `.agents/skills/`. `.claude/skills` is a symlink to it, so any agent that reads
`.claude/skills` sees the same files. Frontmatter carries only `name`, `description` and `metadata`,
which keeps the skills portable to Cursor, Codex and others.

## Entry point

| Skill | Type | Fires on |
|---|---|---|
| [`project-router`](project-router/SKILL.md) | router | **every** request that touches this repo — it asks clarifying questions in pt-BR, writes `TASK_PLAN.md`, selects the chain, and deletes the plan at the end |
| [`routing-pixijs-work`](routing-pixijs-work/SKILL.md) | router | sub-router, entered from `project-router` for anything the client draws — splits every question into "what the API does" (vendored upstream) and "how this game does it" (the eleven bridge skills below) |

Nothing else should be planned or edited before the router runs.

## Knowledge — what the model does not already know

| Skill | Owns | Verification signal |
|---|---|---|
| [`querying-pixellab-api`](querying-pixellab-api/SKILL.md) | the vendored OpenAPI spec as the only source of API truth: how to query it, the two structural traps, the three direction orderings, what the spec cannot tell you | `node .agents/skills/scripts/check-spec-claims.mjs` |
| [`writing-repo-typescript`](writing-repo-typescript/SKILL.md) | Node 24 running `.ts` with no build step; why `.ts` extensions and `node:` prefixes are load-bearing; what the tsconfigs already enforce | `npm run typecheck` in both tools |
| [`enforcing-server-authority`](enforcing-server-authority/SKILL.md) | the non-negotiables for game code that does not exist yet: client decides nothing, failure favours the player, nothing is ever restored, the combat and anti-cheat design | explicit user confirmation — **the weakest signal in the library, and labelled as such** |

## Knowledge — PixiJS, and what upstream cannot know

The `pixi.js` package publishes its own 26 agent skills, vendored here with provenance. **These ten
do not restate the API.** Each carries what this game does and hands the API question to the upstream
skill named in its references. All ten share one verification signal:
`node .agents/skills/scripts/check-pixi-claims.mjs`, which resolves every PixiJS symbol they name
against the pinned declarations and **fails on deprecated ones**, because v8 kept the v7 methods as
shims and v7 code therefore typechecks clean.

| Skill | Owns |
|---|---|
| [`bootstrapping-pixi-app`](bootstrapping-pixi-app/SKILL.md) | async init, the ticker callback that is not a number, teardown that must be complete because nothing is restored |
| [`choosing-pixi-renderer`](choosing-pixi-renderer/SKILL.md) | the pixel-art policy, the three sharpness bugs and their three different causes, backend selection as a reach decision |
| [`composing-pixi-scene`](composing-pixi-scene/SKILL.md) | world/screen split, depth by feet position, the cull-area coordinate space that changed in 8.16.0 |
| [`animating-pixi-sprites`](animating-pixi-sprites/SKILL.md) | the two-file atlas contract, the canonical direction order, the feet anchor, paper-doll as a silhouette problem |
| [`rendering-pixi-tilemap`](rendering-pixi-tilemap/SKILL.md) | the batching container that no longer takes sprites, its empty bounds, and three questions this project has not answered |
| [`handling-pixi-input`](handling-pixi-input/SKILL.md) | a click is a request not a decision, the interactivity default that emits nothing, hit-test cost as scene shape |
| [`building-pixi-ui`](building-pixi-ui/SKILL.md) | pt-BR accents that break naive glyph atlases, why the HUD needs glyph text, no verified UI toolkit |
| [`applying-pixi-filters`](applying-pixi-filters/SKILL.md) | the render-target budget, and which effects are cheaper as art than as shaders |
| [`interpolating-pixi-state`](interpolating-pixi-state/SKILL.md) | drawing behind the newest snapshot, never extrapolating others, never letting a visual guess become state |
| [`profiling-pixi-performance`](profiling-pixi-performance/SKILL.md) | there is no baseline yet, draw calls over sprite counts, the GC options that are now silently ignored |

## Task — procedures with a pass/fail signal

| Skill | Owns | Verification signal |
|---|---|---|
| [`guarding-generation-cost`](guarding-generation-cost/SKILL.md) | the hash contract, the four guard branches, plan→estimate→generate ordering, and the traps that cost real money | `npm test && node src/cli.ts plan` in `tools/pixellab-pipeline` |
| [`testing-repo-code`](testing-repo-code/SKILL.md) | the Node test runner, what good tests look like here, and exactly which money-critical modules have **no** coverage | `npm test` in `tools/pixellab-pipeline` |
| [`writing-project-docs`](writing-project-docs/SKILL.md) | the twelve doc conventions — five checked, seven not — plus ADR authoring and the never-edit-an-accepted-ADR rule | `bash scripts/check-docs.sh` |

Every task skill ends with an `<evolution>` section. It runs at task completion and usually writes
nothing; that is the intended outcome.

## Meta — how the library changes

| Skill | Owns | Verification signal |
|---|---|---|
| [`meta-skill-evolution`](meta-skill-evolution/SKILL.md) | the five-step memory pipeline: importance → external verification → conflict detection → regression gating → git commit. Decides update / propose draft / discard | `lint-skills.mjs && run-skill-evals.mjs` |
| [`meta-skill-consolidate`](meta-skill-consolidate/SKILL.md) | periodic GC: dedupe, contradiction resolution, provenance staleness, token budget. Deletions need a second opinion and human approval | same, plus a diff for review |

## Tooling

| Command | Does |
|---|---|
| `node .agents/skills/scripts/lint-skills.mjs [name]` | frontmatter, naming, description triggers, body budget, provenance, `<evolution>` presence |
| `node .agents/skills/scripts/run-skill-evals.mjs [--skill N] [--write-token]` | routing evals, body invariants, citation resolution — and the **only** way to mint the token the write gate requires |
| `node .agents/skills/scripts/check-spec-claims.mjs` | every endpoint and enum a skill asserts exists in the vendored spec |
| `node .agents/skills/scripts/check-pixi-claims.mjs` | every PixiJS symbol a skill asserts exists in the pinned declarations, is not deprecated, and every upstream skill it cites is present |
| `node .agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs <cmd>` | query the PixiJS surface without loading 47.533 lines |
| `node tools/pixi-reference/scripts/vendor-types.mjs [--check]` | regenerate or verify the vendored PixiJS snapshot |
| `node .agents/skills/scripts/validate-bootstrap.mjs [--phase N]` | the phase gates |
| `node .agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs <cmd>` | query the spec without loading it |

## Enforcement, not advice

Three hooks in `.claude/settings.json` make the rules that matter deterministic:

- **write gate** — modifying an existing `SKILL.md` is blocked without a fresh validation token.
  Creating a new one is allowed, because a new file is a reviewable draft.
- **stop gate** — the bootstrap cannot be abandoned with a phase still open.
- **security guard** — `.env` and secrets are unreadable; destructive shell patterns are blocked.

Hooks are captured at session start, so edits to `settings.json` take effect on the next session.

## Scope against the machine-wide skills

`/home/ondokai/Projects/ferro-e-cinzas-skills/` installs `pixellab-assets` and `ferro-engine` into
every agent profile. Those carry general PixelLab lore and general engine design. The skills here
carry what is true of **this repository** — this snapshot, this CLI, these tsconfigs, these ADRs —
and defer to the global pair rather than restating them.

The same rule applies one level out, to a library that ships its own: `pixi.js` publishes 26 agent
skills inside the npm package, and they are vendored verbatim under
`tools/pixi-reference/vendor/skills/` rather than rewritten. They describe the API; the ten skills
above describe this game. Copying upstream's text into ours would fork a document that upstream keeps
current on every release and we would not — see
[`docs/adr/0009-conhecimento-pixijs-vendorizado.md`](../../docs/adr/0009-conhecimento-pixijs-vendorizado.md).
