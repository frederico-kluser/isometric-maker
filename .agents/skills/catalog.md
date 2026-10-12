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
| [`simulating-isometric-physics`](simulating-isometric-physics/SKILL.md) | continuous xy over integer Z, support and edge rules, the one-level step, the screen-only jump parabola, the swept AABB box (0.65) that gives the character a body, deterministic replay | routing the step through `canCross` looks like deduplication and makes every staircase unwalkable |
| [`editing-isometric-maps`](editing-isometric-maps/SKILL.md) | the Raycaster face-normal picking contract, the pure MapData→MapData editing state, the RLE column store, autotiling rules that never reached the UI, the export contract | clicking the face of a cube places in the adjacent cell, not on it — and the first ray hit is the surface the camera sees, not a sprite |
| [`rotating-isometric-camera`](rotating-isometric-camera/SKILL.md) | the four views: discrete rotation state, Z invariance, the `x+y` term that must be recomputed, the animated turn, camera-fixed light | the reference engine ships **two** sort implementations and still calls its occlusion fix partial — and the sprite can never be rotated, only cross-faded |

`editing-isometric-maps` also carries the list of what the editor **does not have** — multi-cell
brushes, layer hiding by Z, placement validity feedback, and physics that actually consumes the
material table. Those are absences with no convention yet, and inventing one to fill the table is the
failure this library exists to prevent. Undo/redo and camera rotation used to be on that list and are
now implemented; the skill says so, because a stale absence wastes a whole task.

## Knowledge — Three.js, the editor and runtime renderer

The map editor is **Three.js only**: the 2D renderer was removed with the pivot. Ten skills
carry how this editor renders and behaves — scene boot, mesh, art, camera, picking, shadow,
instancing, profiling, live physics — plus the runtime's sprite rendering from the PixelLab atlas.
Verification signals vary: editor skills use `cd tools/character-builder && npx tsc --noEmit`;
sprite rendering uses `cd tools/pixellab-pipeline && npm run typecheck && npm test`.

| Skill | Owns |
|---|---|
| [`bootstrapping-threejs-scene`](bootstrapping-threejs-scene/SKILL.md) | WebGLRenderer boot, the single coalescing frame loop, the sync-world/draw-camera split, ResizeObserver, teardown |
| [`creating-threejs-cubes`](creating-threejs-cubes/SKILL.md) | the block **mesh**: one unlit material, BoxGeometry group order, NearestFilter, geometry cached per sprite proportion, preview/highlight helpers |
| [`mapping-sprites-onto-cubes`](mapping-sprites-onto-cubes/SKILL.md) | what the mesh **shows**: one sprite stretched over three faces, the exact corner-to-corner UV, the cube yaw that follows the camera, the canonical view chosen by silhouette |
| [`controlling-threejs-camera`](controlling-threejs-camera/SKILL.md) | the orbit target that pan moves, continuous damped zoom anchored on the cursor, discrete 90° turns, no OrbitControls |
| [`raycasting-threejs-blocks`](raycasting-threejs-blocks/SKILL.md) | Raycaster, face normal → adjacent cell, ground plane, 6 traps |
| [`casting-threejs-shadows`](casting-threejs-shadows/SKILL.md) | the light that only casts, the `ShadowMaterial` catcher, why cubes do not receive, `autoUpdate = false` |
| [`instancing-threejs-cubes`](instancing-threejs-cubes/SKILL.md) | InstancedMesh per block type, cell-to-instance map, free-list slot reuse, hidden-cell culling, per-instance matrix for cube yaw, `instanceColor` for cell tinting, and why picking left the Raycaster |
| [`profiling-threejs-performance`](profiling-threejs-performance/SKILL.md) | `renderer.info` as the only honest number, draw calls vs object counts, the coalescing frame loop that stops when nothing animates, what InstancedMesh and culling do to the draw-call budget |
| [`simulating-editor-physics`](simulating-editor-physics/SKILL.md) | test mode: the rAF loop, refs over React state, the collision index, the two direction conversions, push-out |
| [`animating-threejs-sprites`](animating-threejs-sprites/SKILL.md) | the two-file atlas contract (TexturePacker JSON Hash + sidecar), how the runtime clones the sheet texture with `repeat`/`offset` per frame, V inversion, `NearestFilter`, the canonical 8-direction order, and the measured anchor |

The split between the first three (bootstrapping, cubes, sprite mapping) and the rest is deliberate.
`creating-threejs-cubes` owns the
**object**; `mapping-sprites-onto-cubes` owns the **image on it**. A task about art that looks sheared
needs the second; a task about a cube that renders black needs the first. Loading only one of the
pair is how a UV bug gets fixed by changing a material.

## Task — procedures with a pass/fail signal

| Skill | Owns | Verification signal |
|---|---|---|
| [`guarding-generation-cost`](guarding-generation-cost/SKILL.md) | the hash contract, the guard that **informs and never refuses**, plan→estimate→generate ordering, and the traps that cost real money | `npm test && node src/cli.ts plan` in `tools/pixellab-pipeline` |
| [`testing-repo-code`](testing-repo-code/SKILL.md) | the Node test runner, what good tests look like here, and exactly which money-critical modules have **no** coverage | `npm test` in `tools/pixellab-pipeline` |
| [`writing-project-docs`](writing-project-docs/SKILL.md) | the twelve doc conventions — four checked, eight not — ADR authoring, and the `**Substitui:**` supersession mechanism | `bash scripts/check-docs.sh` |

Every task skill ends with an registo de aprendizado (memória CoALA local) section. It runs at task completion and usually writes
nothing; that is the intended outcome.

## Meta — how the library changes

| Skill | Owns | Verification signal |
|---|---|---|

## Tooling

| Command | Does |
|---|---|
| `node .agents/skills/scripts/lint-skills.mjs [name]` | frontmatter, naming, description triggers, body budget, provenance, registo de aprendizado (memória CoALA local) presence |
| `node .agents/skills/scripts/run-skill-evals.mjs [--skill N] [--write-token]` | routing evals, body invariants, citation resolution — and the **only** way to mint the token the write gate requires |
| `node .agents/skills/scripts/check-spec-claims.mjs` | every endpoint and enum a skill asserts exists in the vendored spec |
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

