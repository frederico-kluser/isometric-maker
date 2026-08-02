# Skill catalog

Index the router reads before selecting. One line per skill: what it owns, when it fires, and what
signal authorises changing it.

Source of truth: `.agents/skills/`. `.claude/skills` is a symlink to it, so any agent that reads
`.claude/skills` sees the same files. Frontmatter carries only `name`, `description` and `metadata`,
which keeps the skills portable to Cursor, Codex and others.

**This repository is an isometric game EDITOR** — local, single-user, no server, no multiplayer, no
netcode (`docs/adr/0010-pivo-para-editor-isometrico.md`). It used to be a permadeath MMORPG. If a
skill still reads as if a server decided anything, that is a leftover and a defect, not a rule.
`enforcing-server-authority` was retired with the pivot and has **no successor**.

## Entry point

| Skill | Type | Fires on |
|---|---|---|
| [`project-router`](project-router/SKILL.md) | router | **every** request that touches this repo — it asks clarifying questions in pt-BR, writes `TASK_PLAN.md`, selects the chain, and deletes the plan at the end |
| [`routing-pixijs-work`](routing-pixijs-work/SKILL.md) | router | sub-router, entered from `project-router` for anything drawn on screen — splits every question into "what the API does" (vendored upstream) and "how this editor does it" (the ten bridge skills below) |

Nothing else should be planned or edited before the router runs.

## Knowledge — what the model does not already know

| Skill | Owns | Verification signal |
|---|---|---|
| [`querying-pixellab-api`](querying-pixellab-api/SKILL.md) | **hub.** The vendored spec as the only source of API truth: how to query it, the three structural traps, the direction orderings, why the vendor's public pages fail checking | `node .agents/skills/scripts/check-spec-claims.mjs` |
| [`writing-repo-typescript`](writing-repo-typescript/SKILL.md) | Node 24 running `.ts` with no build step; why `.ts` extensions and `node:` prefixes are load-bearing; what the tsconfigs already enforce | `npm run typecheck` in both tools |

### PixelLab domain skills — one per covered spec group

Eight domain skills cover the v3 endpoints and the essential non-v3 families (objects, tilesets).
Three skills were retired with the v3 transition: standalone image generation, portraits/lip-sync,
and UI design — their endpoints exist in the API but are not covered by skills, as they are not
needed for an isometric editor. Each declares `check-spec-claims.mjs` as its signal, so every
endpoint and enum they name is checked against the spec on every run. Load the hub first, then the
family.

| Skill | Spec groups | Endpoints | The trap it exists for |
|---|---|---|---|
| [`generating-pixellab-characters`](generating-pixellab-characters/SKILL.md) | Character from template · Characters · Character Management | 12 | four endpoints for "a character with 8 directions", costing 1 to 40 generations |
| [`rotating-pixellab-sprites`](rotating-pixellab-sprites/SKILL.md) | Rotate | 3 | three direction orderings coexist; only one is the return order |
| [`animating-pixellab-sprites`](animating-pixellab-sprites/SKILL.md) | Animate · Animation Management | 12 | `mode='pro'` costs 160–320 for eight directions **and is worse** |
| [`composing-pixellab-objects`](composing-pixellab-objects/SKILL.md) | Objects · Object Management · Map Objects | 12 | the `review` status parks paid candidates until frames are selected |
| [`generating-pixellab-tilesets`](generating-pixellab-tilesets/SKILL.md) | Create map | 18 | Wang matching is on the vertex grid, via `pattern_4x4`, not `connections` |
| [`editing-pixellab-images`](editing-pixellab-images/SKILL.md) | Edit · Inpaint · Image Operations | 8 | mask polarity: white generates, black preserves |
| [`orchestrating-pixellab-jobs`](orchestrating-pixellab-jobs/SKILL.md) | Background Jobs · Account · Documentation | 3 + cross-cutting | 36 endpoints are async; only 23 say `202` |

## Knowledge — the isometric model, which is this repository's own

Four skills own `packages/iso-core` and `tools/character-builder/src/map` — the layer that decides *what is true*
about the world, as opposed to how it is drawn. Three of them existed as code with hundreds of
passing tests and no skill pointing at them, which is how an agent ends up reimplementing `canEnter`
or writing picking from the ADR's wrong constant. The fourth started as a decision **not** taken and
now documents the one that was. Signal for all four: the package's own test suite.

| Skill | Owns | The trap it exists for |
|---|---|---|
| [`projecting-isometric-geometry`](projecting-isometric-geometry/SKILL.md) | the 2:1 projection, the cube's vertical edge, the floor rule, the diagonal identity, the depth key, the declared anchor | `zStep` is not a taste parameter: it is `sqrt((W²−H²)/2)`, and the `16` this repo shipped drew blocks at 40.8% of a cube — see `docs/adr/0024` |
| [`simulating-isometric-physics`](simulating-isometric-physics/SKILL.md) | continuous xy over integer Z, support and edge rules, the one-level step, the screen-only jump parabola, deterministic replay | routing the step through `canCross` looks like deduplication and makes every staircase unwalkable |
| [`editing-isometric-maps`](editing-isometric-maps/SKILL.md) | picking as a diagonal walk, the RLE column store, autotiling from returned rules, the two formats — RLE to author, instances to export | hit-testing sprites picks the wrong cell exactly at the diamond edges, where the user aims |
| [`rotating-isometric-camera`](rotating-isometric-camera/SKILL.md) | the four views: discrete rotation state, Z invariance, the `x+y` term that must be recomputed, the animated turn, camera-fixed light | the reference engine ships **two** sort implementations and still calls its occlusion fix partial — and the sprite can never be rotated, only cross-faded |

`editing-isometric-maps` also carries the list of what the editor **does not have** — multi-cell
brushes, layer hiding by Z, placement validity feedback, and physics that actually consumes the
material table. Those are absences with no convention yet, and inventing one to fill the table is the
failure this library exists to prevent. Undo/redo and camera rotation used to be on that list and are
now implemented; the skill says so, because a stale absence wastes a whole task.

## Knowledge — PixiJS, and what upstream cannot know

The `pixi.js` package publishes its own 26 agent skills, vendored here with provenance. **These ten
do not restate the API.** Each carries what this game does and hands the API question to the upstream
skill named in its references. All ten share one verification signal:
`node .agents/skills/scripts/check-pixi-claims.mjs`, which resolves every PixiJS symbol they name
against the pinned declarations and **fails on deprecated ones**, because v8 kept the v7 methods as
shims and v7 code therefore typechecks clean.

| Skill | Owns |
|---|---|
| [`bootstrapping-pixi-app`](bootstrapping-pixi-app/SKILL.md) | async init, the ticker callback that is not a number, the integer-only upscale the 2:1 diamond needs, complete teardown |
| [`choosing-pixi-renderer`](choosing-pixi-renderer/SKILL.md) | the pixel-art policy, the three sharpness bugs and their three different causes, the whole-number stage scale the 2:1 diamond needs |
| [`composing-pixi-scene`](composing-pixi-scene/SKILL.md) | world/screen split, depth by isometric cell plus Z, the cull-area coordinate space that changed in 8.16.0 |
| [`animating-pixi-sprites`](animating-pixi-sprites/SKILL.md) | the two-file atlas contract, the canonical direction order, the measured anchor, wardrobe as a silhouette problem |
| [`rendering-pixi-tilemap`](rendering-pixi-tilemap/SKILL.md) | the batching container that no longer takes sprites, its empty bounds, and three questions this project has not answered |
| [`handling-pixi-input`](handling-pixi-input/SKILL.md) | in an editor the click **is** the edit, the interactivity default that emits nothing, picking as arithmetic instead of hit-testing |
| [`building-pixi-ui`](building-pixi-ui/SKILL.md) | pt-BR accents that break naive glyph atlases, why editor chrome needs glyph text, no verified UI toolkit |
| [`applying-pixi-filters`](applying-pixi-filters/SKILL.md) | the render-target budget, and which effects are cheaper as art than as shaders |
| [`interpolating-pixi-state`](interpolating-pixi-state/SKILL.md) | render clock apart from logic clock, smoothing motion between grid cells, the jump whose parabola exists only on screen |
| [`profiling-pixi-performance`](profiling-pixi-performance/SKILL.md) | there is no baseline yet, draw calls over sprite counts, the GC options that are now silently ignored |

## Task — procedures with a pass/fail signal

| Skill | Owns | Verification signal |
|---|---|---|
| [`guarding-generation-cost`](guarding-generation-cost/SKILL.md) | the hash contract, the guard that **informs and never refuses**, plan→estimate→generate ordering, and the traps that cost real money | `npm test && node src/cli.ts plan` in `tools/pixellab-pipeline` |
| [`testing-repo-code`](testing-repo-code/SKILL.md) | the Node test runner, what good tests look like here, and exactly which money-critical modules have **no** coverage | `npm test` in `tools/pixellab-pipeline` |
| [`writing-project-docs`](writing-project-docs/SKILL.md) | the twelve doc conventions — four checked, eight not — ADR authoring, and the `**Substitui:**` supersession mechanism | `bash scripts/check-docs.sh` |

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
| `node .agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs <cmd>` | query the spec without loading it — `summary`, `list`, `endpoint`, `response`, `flow`, `tag`, `grep`, `enums`, `limits` |

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
