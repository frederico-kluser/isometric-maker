---
name: rendering-pixi-tilemap
description: Carries what is actually known about drawing this game's ground at scale, which is less than it looks - the batching container that no longer accepts sprites, its empty bounds that break culling, and three open questions this project has not answered. Use whenever drawing terrain, laying out tiles, chunking the world, streaming a zone, or deciding how thousands of quads reach the GPU - including Portuguese phrasings like "desenhar o chao", "montar o mapa", "carregar o terreno", "dividir em pedacos", "muitos tiles", "o mapa esta pesado", "streaming de zona", "quantos sprites aguenta". Triggers on tilemap, terreno, chunk, tile, ParticleContainer, batching, quads, mundo aberto, zona.
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

1. Whether the community tilemap package supports v8, and from which version. It is not installed
   here and nothing about it has been verified.
2. Whether `ParticleContainer` is safe to build on — see the contradiction below.
3. How a chunked approach interacts with camera-driven culling at this game's scale.

Do not let a skill's confident tone paper over that. If a task requires choosing a tilemap
architecture, that choice is a **decision to record in an ADR**, not an implementation detail to
settle inline.

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
> — `tools/pixi-reference/vendor/pixi-api.d.ts:34642@e58b8ac3`

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
  (`tools/pixellab-pipeline/src/atlas.ts:39-40@e9504d6c`). Seams between tiles are a zoom problem, not
  an atlas problem.
- **An atlas page is capped at 2048×2048 and multipack is not implemented** — over the limit, packing
  throws (`tools/pixellab-pipeline/src/atlas.ts:235-240@e9504d6c`). Terrain that needs more than one
  page needs the multipack work done first, or a hand-split family.

Undecided, and needing a measurement rather than an opinion: chunk size, how many chunks stay
resident, whether chunks are cached to textures, and whether the ground is one batching container per
page or a plain container of sprites relying on ordinary batching.

### Sizing the problem before choosing

Before proposing an architecture, get these numbers from the task, because they change the answer
completely: tiles visible at maximum zoom, tile pixel size, how many distinct terrain textures a zone
uses, and whether any tile animates. A design chosen without them is a guess wearing a diagram.

The server is sharded by zone from the first commit
(`docs/adr/0007-fase1-vm-unica.md:15@385b9c10`), so zone boundaries are a real thing the client will
see. Terrain streaming should follow zone shape rather than inventing its own partition.

### What is not verified

Everything in the honest-state section, plus: no terrain has ever been rendered in this repository,
and no frame-rate measurement of any tilemap approach exists for this art style.

## References

- `tools/pixi-reference/vendor/skills/pixijs-scene-particle-container/SKILL.md` — the batching container in full
- `tools/pixi-reference/vendor/skills/pixijs-performance/SKILL.md` — what actually breaks batching
- `.agents/skills/composing-pixi-scene/SKILL.md` — the local-space cull change that bites here first
- `tools/pixellab-pipeline/src/atlas.ts` — extrusion, page ceiling, and the missing multipack
