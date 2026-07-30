---
name: profiling-pixi-performance
description: Carries how this project decides whether the editor is fast enough - measure before optimising because no baseline exists yet, watch draw calls rather than sprite counts, and know that the garbage collector was unified in a way that silently ignores the old settings. Use whenever frame rate drops, memory grows, opening another map leaks, or someone proposes an optimisation - including Portuguese phrasings like "esta lento", "caiu o fps", "travando", "engasga quando entra em um mapa maior", "consumindo memoria", "vazamento", "quantos tiles aguenta", "quantos sprites cabem no mapa", "vale a pena otimizar". Triggers on desempenho, fps, draw call, batch, memoria, vazamento, GPU, profiling, otimizacao, gargalo.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Profiling the editor

## When to use

Whenever performance is the question, and — more importantly — **before** accepting any optimisation
proposal, including the ones in this repository's own skills.

For the API and the techniques read
`tools/pixi-reference/vendor/skills/pixijs-performance/SKILL.md`.

## Injected knowledge

### There is no baseline, and that is the most important fact here

Nothing in this repository has ever rendered a frame, and PixiJS is not installed
(`docs/00-produto/visao.md:60@613eaec7`). Every performance claim in the PixiJS skills — the filter
budget in `applying-pixi-filters`, the tilemap options in `rendering-pixi-tilemap`, the sorting
advice in `composing-pixi-scene` — is **reasoning from how the renderer works, not a measurement of
this editor**.

So the first performance task is not an optimisation. It is establishing a baseline, and in an
editor that baseline is a size question with a number attached: how many tiles and how many sprites
the open map holds before frame time moves. A stated map size, a frame-time number, a draw-call
number. Until those exist, "this will be faster" is an opinion, and this skill's job is to say so.

### Measure draw calls, not sprites

Sprite count is a poor predictor. Ten thousand sprites sharing one atlas and no effects can batch
into very few draw calls; two hundred sprites that alternate textures, blend modes and filters cannot.
What ends a batch is a change of state between adjacent draws — a different texture source, a filter
or mask forcing a render target, a blend-mode change.

That is why the pipeline packs whole families into single atlas pages
(`tools/pixellab-pipeline/src/atlas.ts:204-215@a8bede59`) and why the page ceiling is 2048, the safe
limit on integrated and mobile GPUs (`tools/pixellab-pipeline/src/atlas.ts:43@a8bede59`). Splitting a
family across pages is a batching cost, not just a packing detail — worth knowing before splitting
one to dodge the missing multipack support.

Interleaving is the subtle version: drawing A-atlas, B-atlas, A-atlas costs three batches where
sorting by atlas would cost two. The isometric draw order is `2*(x+y+z)` plus an integer edge bias
(`docs/adr/0013-geometria-isometrica-64x32-z16.md:40@e194895c`), which is deliberately something
other than texture, so a map that stacks floor, wall and prop **will** interleave. That tension is
real and unresolved, and resolving it needs a measurement, not a preference.

### The garbage collector was unified, and the old settings are silently dead

Post-8.15.0, and therefore outside most recollection: the separate texture and renderable collectors
are deprecated in favour of one system.

```bash
S=.agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs
node $S exists GCSystem              # the current one
node $S exists TextureGCSystem       # exits 1 — deprecated since 8.15.0
node $S exists RenderableGCSystem    # exits 1 — deprecated since 8.15.0
node $S options GCSystemOptions      # the three options that replace six
```

The failure mode is the dangerous kind: the deprecated shims still accept their old options and
**silently do not forward them**, so an editor configured the v7 way has no garbage collection tuning
at all and no warning saying so. If memory grows in a way that looks like the collector is not
running, check which system is configured before looking for a leak.

The same release added a per-node release of GPU resources that keeps the node usable
(`inspect-pixi.mjs exists ViewContainer.unload` — the vendored type documents it as "Unloads the GPU
data from the view"). That is the right tool when switching maps for the nodes the new map no longer
draws: their GPU side goes, the scene structure stays. It acts on **a view, not on an atlas** —
releasing a whole atlas is `Assets.unload`, which is the next item.

### Leaks in this editor have a specific shape

An editor session is long-lived and drops state repeatedly without ever reloading the page: opening
another map, closing a project, re-running the preview, reimporting an atlas that was just
regenerated. Each of those is a teardown, and a teardown that leaks accumulates across an afternoon
of authoring instead of ending when a session does.

Watch, in order of likelihood:

1. **Ticker callbacks** from a previous map or a previous preview run, still running.
2. **Event listeners** on destroyed containers, and DOM keyboard listeners which Pixi never owned.
3. **Textures from atlases the newly opened map does not use.** Loading is deduplicated by URL and
   alias, so repeated loads are cheap and idempotent — but unloading is explicit (`Assets.unload`,
   `Assets.unloadBundle`) and is the half people forget.
4. **Pooled objects** whose pool grows and never shrinks.

The teardown order that avoids most of this is in `bootstrapping-pixi-app`.

### Do not optimise what this project has already decided

Two things look like optimisation opportunities and are not:

- **The atlas is tight NPOT rather than power-of-two, deliberately.** Pixi 8 requires WebGL2 or
  WebGPU, both handle NPOT, pixel art uses no mipmaps, and POT would waste up to 72% of the texture
  (`tools/pixellab-pipeline/src/atlas.ts:202-204@a8bede59`).
- **Regeneration is idempotent by design** and the atlas PNG is byte-stable
  (`tools/pixellab-pipeline/src/atlas.ts:100-101@a8bede59`). Anything that makes packing
  non-deterministic to save time breaks caching and costs real money in the generation pipeline —
  see `guarding-generation-cost`.

### What is not verified

- No baseline, no profile, no frame-time number, no draw-call count. All of it.
- No map has ever been opened, so "how many tiles and sprites does this hold" has no answer here.
- Research did not establish what exactly breaks a batch in v8, the real texture-unit limit, or the
  profiling counters available — read `pixijs-performance` rather than trusting a recalled list.
- The batching-versus-draw-order tension described above has not been measured for this art style.
- Of the two halves of the idempotency above, only one is tested. Packing determinism **is** checked
  — `tools/pixellab-pipeline/src/atlas.test.ts:100@d28e4f8a` builds the same atlas twice from
  shuffled input and asserts a byte-identical PNG. The half with no test is the one that costs
  money: that regenerating from an unchanged spec submits no job at all.

## References

- `tools/pixi-reference/vendor/skills/pixijs-performance/SKILL.md` — destroy patterns, culling, pooling, counters
- `.agents/skills/bootstrapping-pixi-app/SKILL.md` — the teardown order
- `.agents/skills/testing-repo-code/SKILL.md` — why a measurement, not a claim, is what authorises change here
- `tools/pixellab-pipeline/src/atlas.ts` — the packing decisions that already shape batching
- `docs/adr/0013-geometria-isometrica-64x32-z16.md` — the draw order that fights texture batching
