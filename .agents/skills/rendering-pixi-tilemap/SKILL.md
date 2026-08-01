---
name: rendering-pixi-tilemap
description: Carries what is actually known about drawing the editor's isometric ground - the geometry that is already fixed (64x32 diamond, 16px per level of Z, integer Z), the depth key that provably cannot be made correct for multi-cell art, the batching container that no longer accepts sprites and whose empty bounds silently delete the floor, and three open questions this project has not answered. Use whenever drawing terrain, laying out tiles, stacking blocks, sorting what covers what on the grid, chunking the world, streaming a zone, or deciding how thousands of quads reach the GPU - including Portuguese phrasings like "desenhar o chao", "montar o mapa", "carregar o terreno", "empilhar blocos", "a parede aparece na frente do chao", "dividir em pedacos", "muitos tiles", "o mapa esta pesado", "streaming de zona", "quantos sprites aguenta". Triggers on tilemap, terreno, chunk, tile, isometrico, altura, parede, ParticleContainer, batching, quads, zona.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Rendering the tilemap

## When to use

Before drawing terrain, and before assuming any approach to it is settled. Read the honest-state
section first: **this is the least-resolved area in the whole PixiJS surface for this project.**

There is no upstream skill for tilemaps. The nearest is
`tools/pixi-reference/vendor/skills/pixijs-scene-particle-container/SKILL.md`, which covers the
batching container but not tilemaps as such.

## Injected knowledge

### The honest state

Deep research over more than a hundred agents produced **no** verified answer to three questions that
have to be answered before terrain is built:

1. ~~Whether the community tilemap package supports v8~~ — **partly answered, see below.** What
   remains open is whether it suits an *isometric* map with stacked Z, which a second research round
   left explicitly unresolved.
2. Whether `ParticleContainer` is safe to build on — see the contradiction below.
3. How a chunked approach interacts with camera-driven culling at the scale of a map this editor is
   expected to author.

Do not let a skill's confident tone paper over that. If a task requires choosing a tilemap
architecture, that choice is a **decision to record in an ADR**, not an implementation detail to
settle inline.

What is *not* open is the geometry. Read the next two sections before proposing anything: they are
the part of this surface that is already decided, and the part whose limits are provable.

### The community tilemap package, verified from its own source

Still **not installed here**, and adopting it is still a dependency decision. But these are no longer
unknowns — each was read from the package registry or the upstream source, not from a summary of it:

- **It declares v8 compatibility from 8.5.0.** `peerDependencies` is `pixi.js: ">=8.5.0"`; the latest
  release is 5.0.2. This repo's pin satisfies that range.
- **It consumes texture references, never sprites.** The word "Sprite" does not appear once in the
  package's main tilemap source file. Tiles are added by texture name, texture, or tileset index — a
  v7 mental model of "add sprites to a tilemap" does not apply.
- **One tilemap holds 16 textures**, from `TEXTURES_PER_TILEMAP` in the package's settings. The
  composite variant exists for exactly one reason: to chain tilemaps once that limit is reached. It
  is not a general-purpose grouping abstraction.
- **Per-tile tint is impossible without forking the package.** Its vertex format carries seven
  attributes — position, texture coordinate, frame, animation, texture id, animation divisor and
  alpha — and **no colour attribute at all**. Per-tile alpha, size, rotation and animation *do*
  exist, so "it has no per-tile properties" would be false; tint specifically does not.
- **Per-tile rotation is an 8-orientation flip/rotate enum**, which is directly the shape autotiling
  and mirrored variants want.

**The staleness risk is the real one.** The latest release predates this repo by about a year, and
the package has already broken once against a PixiJS minor — an upstream commit exists whose message
is that the tilemap stopped rendering as of Pixi 8.7.0. Meanwhile PixiJS keeps shipping behaviour
changes; `composing-pixi-scene` documents one that landed in 8.16.0. Adopting this package means
accepting that a Pixi upgrade can break the floor, with no vendor on the hook.

Two things a first round of research asserted and a verification pass **killed** — do not repeat
them: that the project publishes a Pixi-to-tilemap compatibility table, and that it is
rectangular-only by explicit design. Isometric suitability is **unresolved**, not refuted.

### The geometry is fixed, and it is the sort key

Three numbers are settled by ADR and are not open to inline reinterpretation: the tile diamond is
**64×32 px**, one level of Z is **16 px**, and **Z is an integer** — stacked blocks per cell, with no
half heights (`docs/adr/0013-geometria-isometrica-64x32-z16.md:24-26@e194895c`). Changing any of them
later invalidates every project file already written and every tile already generated
(`docs/adr/0013-geometria-isometrica-64x32-z16.md:16@e194895c`), so a tilemap that quietly assumes
another diamond is not a style choice, it is a migration.

Two consequences land directly on the renderer:

- **The stage scale must be a whole number.** A 1.5× upscale destroys the seam of the 2:1 diamond,
  and no amount of edge extrusion repairs it
  (`docs/adr/0013-geometria-isometrica-64x32-z16.md:38@e194895c`). That is a renderer setting rather
  than a tilemap one — the sharpness rules live in `choosing-pixi-renderer`.
- **Draw order is `x + y + z`, but the sort key is not.** Walls sit on a half cell — the north edge
  of cell `(x, y)` is at `(x, y-0.5)` — so the value that actually sorts is `2*(x+y+z)` plus an
  integer bias per edge, which keeps the whole comparison in integer arithmetic
  (`docs/adr/0013-geometria-isometrica-64x32-z16.md:40@e194895c`). Doubling first is what buys the
  half cell without floats.

### Two places where the sort key is provably wrong

Both are limits of any single linear order on this grid, not defects waiting for a cleverer
comparator:

1. **A sprite taller than one level of Z.** It claims one cell in the model and occupies four on
   screen, so it ties with walls that should draw behind it. Its footprint and its silhouette
   disagree, and the key only knows the footprint.
2. **An object occupying more than one cell.** It can produce **cyclic occlusion** — A over B, B over
   C, C over A — and a cycle has *no* correct linear order at all. Sorting harder cannot fix a cycle;
   only splitting the object can.

The mitigation for the second one is a decision about the data model, not about rendering: **the
project format forbids multi-cell sprites**, and anything larger is sliced at authoring time
(`docs/adr/0013-geometria-isometrica-64x32-z16.md:40@e194895c`). An editor can refuse the impossible
combination at the moment it is authored; a shipped game inheriting arbitrary art could not. So when
a task asks for a multi-cell sprite, the answer is the format, not a better sort.

### `ParticleContainer` is a different class than the one you remember

The v7 habit — pour thousands of `Sprite` into one and get free batching — does not work. In v8 the
container takes `Particle` (or anything implementing `IParticle`) through a dedicated add method, and
keeps them in a separate child list outside the ordinary scene graph. Verify the surface directly:

```bash
S=.agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs
node $S members ParticleContainer --own
node $S exists ParticleContainer.addParticle
node $S show Particle
```

The consequences that decide whether it fits terrain at all:

- **Everything in one container shares a single base texture source.** An atlas satisfies this; two
  atlases do not. Terrain that outgrows one page needs one container per page.
- **No per-particle filters, masks or blend modes, and no nesting.** A tile that needs any of those
  cannot live here.
- **Only some properties re-upload per frame**, controlled by the container's default property flags.
  Static terrain wants nearly all of them off, which is what makes the approach fast — and what makes
  it wrong for anything animated.

### The bounds trap, which silently deletes your terrain

`ParticleContainer` returns **empty bounds**. The vendored declaration says so in as many words:

> "@returns {Bounds} An empty bounds object (0,0,0,0)"
> — `tools/pixi-reference/vendor/pixi-api.d.ts:34640@e58b8ac3`

With culling active — which a camera-scrolled world will have — an empty-bounds container is always
outside the view and is therefore **always culled**. The ground simply never draws, with no error.
Point containment misses for the same reason, so clicks on the ground land nowhere.

The fix is to set the container's bounds area explicitly (`inspect-pixi.mjs exists
Container.boundsArea`). Treat it as required rather than optional, and remember that `cullArea` is
now local-space — the trap described in `composing-pixi-scene` applies here first.

### Three first-party sources disagree about whether this is stable

This is worth stating precisely, because "the docs say it's fine" is true and so is the opposite:

| Source | Says |
|---|---|
| bundled declarations, `tools/pixi-reference/vendor/pixi-api.d.ts:34451@e58b8ac3` | tagged `@standard` |
| the shipped upstream skill, `vendor/skills/pixijs-scene-particle-container/SKILL.md` | "stable for production use" |
| the per-module declarations inside the installed package | a boxed `EXPERIMENTAL` banner: "This is a new API, things may change and it may not work as expected" |

All three ship in the same npm package, at the same version. The per-module file is **not vendored**,
so this last one cannot be checked from a clone — it was observed in `node_modules` and is recorded
here for that reason, labelled rather than resolved.

The operational reading: it is not experimental enough to avoid, and not settled enough to build the
whole world on without a fallback to ordinary containers of sprites.

### What the project already fixes, and what it does not

Two things are already decided and should not be re-litigated:

- **Tiles get 2px extrusion, sprites 1px**, because tiles abut and sprites do not
  (`tools/pixellab-pipeline/src/atlas.ts:39-40@a8bede59`). Seams between tiles are a zoom problem, not
  an atlas problem.
- **An atlas page is capped at 2048×2048 and multipack is not implemented** — over the limit, packing
  throws (`tools/pixellab-pipeline/src/atlas.ts:235-240@a8bede59`). Terrain that needs more than one
  page needs the multipack work done first, or a hand-split family.

Undecided, and needing a measurement rather than an opinion: chunk size, how many chunks stay
resident, whether chunks are cached to textures, and whether the ground is one batching container per
page or a plain container of sprites relying on ordinary batching.

### Sizing the problem before choosing

Tile size is not one of the open numbers — it is 64×32, fixed. What is still missing from any
proposal, and changes the answer completely, is: tiles visible at maximum zoom, how many levels of Z
a map is expected to stack, how many distinct terrain and wall textures one map uses, and whether any
tile animates. A design chosen without them is a guess wearing a diagram.

Nothing outside the editor defines the partition. There is no server and no zone sharding
(`docs/adr/0010-pivo-para-editor-isometrico.md:27@2fd6d75f`), so chunk shape is the editor's own
choice and has to be earned by a measurement instead of inherited from someone else's boundary.

### What is not verified

Everything in the honest-state section, plus: no terrain has ever been rendered in this repository,
and no frame-rate measurement of any tilemap approach exists for this art style. The geometry section
is decided, not measured — nobody has drawn a 64×32 diamond here to confirm the seam behaves as the
ADR expects, and no tile has been generated to sit in it.

## References

- `docs/adr/0013-geometria-isometrica-64x32-z16.md` — the diamond, the Z level, the sort key and its two failure modes
- `tools/pixi-reference/vendor/skills/pixijs-scene-particle-container/SKILL.md` — the batching container in full
- `tools/pixi-reference/vendor/skills/pixijs-performance/SKILL.md` — what actually breaks batching
- `.agents/skills/composing-pixi-scene/SKILL.md` — the local-space cull change that bites here first
- `.agents/skills/choosing-pixi-renderer/SKILL.md` — why the stage scale has to be an integer
- `tools/pixellab-pipeline/src/atlas.ts` — extrusion, page ceiling, and the missing multipack
