---
name: profiling-pixi-performance
description: Carries how this project decides whether the client is fast enough - measure before optimising because no baseline exists yet, watch draw calls rather than sprite counts, and know that the garbage collector was unified in a way that silently ignores the old settings. Use whenever frame rate drops, memory grows, a zone change leaks, or someone proposes an optimisation - including Portuguese phrasings like "esta lento", "caiu o fps", "travando", "engasga quando entra na zona", "consumindo memoria", "vazamento", "quantos sprites aguenta", "vale a pena otimizar". Triggers on desempenho, fps, draw call, batch, memoria, vazamento, GPU, profiling, otimizacao, gargalo.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Profiling the client

## When to use

Whenever performance is the question, and — more importantly — **before** accepting any optimisation
proposal, including the ones in this repository's own skills.

For the API and the techniques read
`tools/pixi-reference/vendor/skills/pixijs-performance/SKILL.md`.

## Injected knowledge

### There is no baseline, and that is the most important fact here

Nothing in this repository has ever rendered a frame. Every performance claim in the PixiJS skills —
the filter budget in `applying-pixi-filters`, the tilemap options in `rendering-pixi-tilemap`, the
sorting advice in `composing-pixi-scene` — is **reasoning from how the renderer works, not a
measurement of this game**.

So the first performance task is not an optimisation. It is establishing a baseline: a scene with a
realistic entity count, a frame-time number, and a draw-call number. Until that exists, "this will be
faster" is an opinion, and this skill's job is to say so.

### Measure draw calls, not sprites

Sprite count is a poor predictor. Ten thousand sprites sharing one atlas and no effects can batch
into very few draw calls; two hundred sprites that alternate textures, blend modes and filters cannot.
What ends a batch is a change of state between adjacent draws — a different texture source, a filter
or mask forcing a render target, a blend-mode change.

That is why the pipeline packs whole families into single atlas pages
(`tools/pixellab-pipeline/src/atlas.ts:204-215@e9504d6c`) and why the page ceiling is 2048, the safe
limit on integrated and mobile GPUs (`tools/pixellab-pipeline/src/atlas.ts:43@e9504d6c`). Splitting a
family across pages is a batching cost, not just a packing detail — worth knowing before splitting
one to dodge the missing multipack support.

Interleaving is the subtle version: drawing A-atlas, B-atlas, A-atlas costs three batches where
sorting by atlas would cost two. Depth sorting by feet position (`composing-pixi-scene`) deliberately
sorts by something other than texture, so this game **will** interleave. That tension is real and
unresolved, and resolving it needs a measurement, not a preference.

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
**silently do not forward them**, so a client configured the v7 way has no garbage collection tuning
at all and no warning saying so. If memory grows in a way that looks like the collector is not
running, check which system is configured before looking for a leak.

The same release added a per-node release of GPU resources that keeps the node usable
(`inspect-pixi.mjs exists ViewContainer.unload`), which is the right tool for a zone change: drop the
GPU side of what is off-screen without tearing down the scene structure.

### Leaks in this game have a specific shape

Zone changes and character death are the moments state is dropped, and both are frequent. Permadeath
means a session ends abruptly and completely (`docs/adr/0003-permadeath-total.md:17@b24cc681`), so
anything that survives it is a leak with gameplay consequences, not just memory.

Watch, in order of likelihood:

1. **Ticker callbacks** from a previous session or zone, still running.
2. **Event listeners** on destroyed containers, and DOM keyboard listeners which Pixi never owned.
3. **Textures from atlases the new zone does not use.** Loading is deduplicated by URL and alias, so
   repeated loads are cheap and idempotent — but unloading is explicit and is the half people forget.
4. **Pooled objects** — damage numbers especially — whose pool grows and never shrinks.

The teardown order that avoids most of this is in `bootstrapping-pixi-app`.

### Do not optimise what this project has already decided

Two things look like optimisation opportunities and are not:

- **The atlas is tight NPOT rather than power-of-two, deliberately.** Pixi 8 requires WebGL2 or
  WebGPU, both handle NPOT, pixel art uses no mipmaps, and POT would waste up to 72% of the texture
  (`tools/pixellab-pipeline/src/atlas.ts:202-204@e9504d6c`).
- **Regeneration is idempotent by design** and the atlas PNG is byte-stable
  (`tools/pixellab-pipeline/src/atlas.ts:100-101@e9504d6c`). Anything that makes packing
  non-deterministic to save time breaks caching and costs real money in the generation pipeline —
  see `guarding-generation-cost`.

### What is not verified

- No baseline, no profile, no frame-time number, no draw-call count. All of it.
- Research did not establish what exactly breaks a batch in v8, the real texture-unit limit, or the
  profiling counters available — read `pixijs-performance` rather than trusting a recalled list.
- The batching-versus-depth-sorting tension described above has not been measured for this art style.

## References

- `tools/pixi-reference/vendor/skills/pixijs-performance/SKILL.md` — destroy patterns, culling, pooling, counters
- `.agents/skills/bootstrapping-pixi-app/SKILL.md` — the teardown order
- `.agents/skills/testing-repo-code/SKILL.md` — why a measurement, not a claim, is what authorises change here
- `tools/pixellab-pipeline/src/atlas.ts` — the packing decisions that already shape batching
