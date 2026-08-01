---
name: composing-pixi-scene
description: Carries how this isometric editor arranges what it draws - the world/screen split that makes a camera possible, depth ordered by the grid key x+y+z with walls on a half cell, the two occlusion failures that no comparator can fix, and the culling behaviour that changed underneath camera-scrolled worlds. Use whenever building the scene graph, moving the camera, deciding what draws on top of what, grouping layers, or cutting what is off-screen - including Portuguese phrasings like "mover a camera pelo mapa", "a parede aparece na frente do personagem", "ordem de desenho", "z-index", "montar a cena", "sumiu da tela", "esconder o que esta fora", "agrupar as camadas". Triggers on camera, cena, profundidade, ordenacao, culling, cullArea, camada, zIndex, sortableChildren, viewport, isometrico, ancora.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Composing the scene

## When to use

Before adding the first `Container`, before implementing the editor camera, and whenever something
draws in front of what it should be behind.

For the API — containers, transforms, bounds, render groups — read
`tools/pixi-reference/vendor/skills/pixijs-scene-core-concepts/SKILL.md`, which has seven reference
documents, and `pixijs-scene-container`.

## Injected knowledge

### Two coordinate spaces, and the camera is the transform between them

PixiJS is only a renderer: scene, tilemap, collision, camera and UI are all ours — and for this
product that is the requirement rather than a cost reluctantly accepted, because those four things
*are* the editor (`docs/adr/0014-pixijs-para-o-editor.md:30@c4bf785c`). There is no camera object; a
camera is a `Container` whose transform is the inverse of where you want to look.

The split that keeps this manageable:

| Space | Holds | Moves with the camera |
|---|---|---|
| world | ground, blocks, walls, characters, the cell highlight | yes — it *is* the camera transform |
| screen | toolbar, properties panel, cost bar, coordinate readout | no |

The case that catches people is a label pinned to a world position — the coordinates of the cell
under the cursor, a name over a block — which must follow that position but must **not** scale with
camera zoom. It belongs in screen space, with its position converted each frame. `Container`
provides local/global conversion in both directions — check the exact names with
`inspect-pixi.mjs members Container` rather than recalling them.

**Keep the camera transform on integer device pixels.** A fractional camera offset reintroduces the
shimmering that `choosing-pixi-renderer` exists to prevent, it does so for every sprite at once —
which makes it look like an art problem rather than a transform problem — and on a 2:1 diamond it
also splits the tile seam, which no amount of edge extrusion repairs
(`docs/adr/0013-geometria-isometrica-64x32-z16.md:38@e194895c`).

### Depth is `x + y + z`, and walls sit on a half cell

The geometry is fixed: a 64×32 diamond, one level of Z worth 16 px, and **Z is an integer** — stacked
blocks per cell, no half heights (`docs/adr/0013-geometria-isometrica-64x32-z16.md:24@e194895c`).
Draw order therefore comes from the **grid**, not from the screen: the ordering is `x + y + z`.

Walls are not cell contents, they are **edges**, and an edge sits on a half cell — the north edge of
`(x, y)` is at `(x, y-0.5)`. So the value that actually sorts is `2*(x+y+z)` plus an integer bias per
edge, which keeps the whole comparison in integer arithmetic
(`docs/adr/0013-geometria-isometrica-64x32-z16.md:40@e194895c`). Doubling first is what buys the half
cell without introducing floats into a comparator that runs per element per frame.

Sorting by screen `y` — the reflex from three-quarter top-down — is wrong here and wrong silently.
With `sy = (x+y)*16 - z*16` (`docs/adr/0013-geometria-isometrica-64x32-z16.md:8@e194895c`), raising a
block one level *decreases* its screen `y`, so a screen-`y` sort draws the higher block **behind** the
lower one. On a flat map the two orders agree, which is exactly why this survives the first test map
and breaks on the first staircase.

The perspective itself — `low top-down`, 8 directions — is still the choice, but its reason changed:
it is now the perspective that matches the 2:1 dimetric projection and the eight directions are the
cardinality of the movement space, not a legibility argument
(`docs/adr/0015-low-top-down-8-direcoes-isometrico.md:29@0a0dfd33`). Perspective decides how the art
*looks*; the grid decides what draws first.

### The two failure modes, said plainly

Both are limits of any single linear order over this grid, not defects waiting for a cleverer
comparator (`docs/adr/0013-geometria-isometrica-64x32-z16.md:40@e194895c`):

1. **A sprite taller than one level of Z.** It claims one cell in the model and covers roughly four
   on screen, so it ties with walls that should draw behind it. Its footprint and its silhouette
   disagree, and the key only knows the footprint.
2. **An object occupying more than one cell.** It can produce **cyclic occlusion** — A over B, B over
   C, C over A — and a cycle has *no* correct linear order at all. Sorting harder cannot resolve a
   cycle; only splitting the object can.

The mitigation for the second is a decision about the **model**, not about the renderer: the project
format **forbids multi-cell sprites**, and anything larger than one cell is sliced at authoring time.
An editor can refuse the impossible combination at the moment it is authored — a shipped game
inheriting arbitrary art could not. So when a task asks for a multi-cell prop, the answer is the
project format, never a better comparator.

### The anchor the sort key reads is not measured yet

The key needs each sprite's cell, and a sprite's cell comes from where its feet sit inside its frame.
The atlas packer still emits a fixed anchor, `{ x: 0.5, y: 0.875 }`
(`tools/pixellab-pipeline/src/atlas.ts:216@a8bede59`) — an empirical guess against the roughly 40%
canvas inflation the character endpoint applies. With Z discrete that guess is now expensive: one
level is 16 px, so about 12% of error on a canvas of about 90 px is about 11 px, nearly a whole level
of displacement (`docs/adr/0013-geometria-isometrica-64x32-z16.md:42@e194895c`).

The decided replacement is a **measured** anchor: the opaque bounding box of the **union of every
frame in the family**. Union, not per frame — a per-frame box makes the raised foot of a walk cycle
shift the sprite by a pixel from one frame to the next.

**This is not implemented.** `atlas.ts` still writes the constant. Scene code must read the anchor out
of the atlas data instead of assuming either value, or it inherits whichever one happened to be
current the day it was written.

### Sorting cost, and how to avoid paying it

`Container` supports per-child ordering and an opt-in automatic sort. The vendored declaration is
explicit that the opt-in sorts the child list when the next render is called
(`inspect-pixi.mjs member Container sortableChildren`), so for a container holding a whole map that is
a sort every frame. Three ways to keep it cheap, in order of preference:

1. **Bucket by the integer key.** `2*(x+y+z)` is a small-range integer, so pre-create one
   sub-container per key value and add each element to its bucket. Insertion is a push, no comparator
   runs, and the order is correct by construction. This is the only option that does not scale with
   element count.
2. **Never sort the world container.** Ground and static decoration have a fixed relative order.
   Whatever must be sorted belongs in its own child container, alone.
3. **If a sort is unavoidable, give it a stable key** — the integer above, never a float — so that
   equal values do not reshuffle between frames and make elements flicker past each other.

Bucket count, and whether buckets should be chunked spatially as well, is the same open question as
chunking in `rendering-pixi-tilemap`, and it is open there too.

### Layers exist, and are labelled experimental

`RenderLayer` lets draw order be decided independently of parent/child structure, which is the
natural fit for "this highlight belongs to the selected block but must draw above everything". The
vendored declaration says of it:

> "This is a new API and therefore considered experimental at this stage."
> — `tools/pixi-reference/vendor/pixi-api.d.ts:16554@e58b8ac3`

Use it if it is the right tool, but record that it is experimental where the decision is made, and do
not build something load-bearing on it without a fallback that uses ordinary ordering.

### Culling changed underneath camera-scrolled worlds

`Container.cullArea` is interpreted in the container's **local** coordinate space and projected to
global before the test. This changed in 8.16.0, and the pre-change idiom — pre-transforming the rect
into world coordinates yourself — now double-applies the transform.

That lands squarely here: the world container's transform is non-identity by construction, because it
*is* the camera. A cull rect computed the old way gets offset and scaled twice.

**The symptom is bigger than it sounds.** `_cullRecursive` returns before descending whenever
`container.culled` is true, so a wrongly-culled world container skips its **entire subtree** — the
whole map vanishes, not a fringe of tiles near the edge. The error grows with camera offset, so it
often reads as "the map disappears once I scroll far enough". Scope it before applying the rule:
this bites only containers that have an **explicit `cullArea`** *and* a non-identity
`worldTransform`. Containers without `cullArea` go through `getGlobalBounds`, which was always
transform-correct and was not touched.

Note the shape of the trap. The documentation said "local space" the whole time; it was the
**observed** behaviour that changed. Code written by testing what worked breaks here, while code
written from the docs does not.

Culling is opt-in per container and there is a plugin that runs the cull each frame; get the exact
names from `inspect-pixi.mjs prop cullable` and `inspect-pixi.mjs exists CullerPlugin`. Turn culling
**off** for containers whose children are all on screen anyway — the test is not free, and running it
over the editor chrome is pure cost.

### Caching a container is a method call, not an assignment

v7's cache flag was a property you assigned. v8 replaced it with a method taking a boolean or an
options object (`inspect-pixi.mjs member Container cacheAsTexture`). Assigning to it the v7 way is a
type error, which is one of the few v7 habits that fails loudly instead of silently.

It is the right tool for a composed layer that does not change — a finished Z level below the one
being edited — and the wrong tool for anything that moves or is being edited, because every change
re-renders the cache to a texture. In an editor "does not change" is a statement about the current
tool, not about the data, so the cache has to be invalidated by the same command that mutates the
layer.

Render groups are the other half of that trade-off: they move a subtree onto the GPU as a unit so its
own transform is cheap to change, which suits a large static map that pans. Both are described
properly in `pixijs-scene-core-concepts`; the project rule is simply **measure before applying
either**, because both trade memory for CPU and this project has no measurements yet.

### `name` is gone

`Container.name` is deprecated since 8.0.0 in favour of `label`. It still exists, so v7 code compiles
— see `routing-pixijs-work` for why that is the general hazard here, not the exception.

### What is not verified

No scene has ever been built in this repository, and nothing here has ever rendered a frame
(`docs/00-produto/visao.md:58@613eaec7`). The API facts are checked against the vendored 8.19.0
declarations; the depth and camera rules are derived from accepted ADRs. What has **not** been
measured is the interaction between them at the size of map this editor is meant to open — how many
buckets a real map produces, what bucketing costs in container count, and whether per-bucket culling
is cheaper than the sort it replaces.

The measured anchor is decided and unimplemented, which makes every depth calculation written today
dependent on a number that is known to be wrong.

## References

- `tools/pixi-reference/vendor/skills/pixijs-scene-core-concepts/SKILL.md` — scene graph, transforms, layers, masking
- `tools/pixi-reference/vendor/skills/pixijs-scene-container/SKILL.md` — the Container API in full
- `tools/pixi-reference/vendor/skills/pixijs-performance/SKILL.md` — culling and caching, measured
- `docs/adr/0013-geometria-isometrica-64x32-z16.md` — the diamond, the Z level, the sort key and its two failure modes
- `docs/adr/0014-pixijs-para-o-editor.md` — why the scene, the camera and the tilemap are ours to write
- `.agents/skills/rendering-pixi-tilemap/SKILL.md` — the ground itself, and the empty-bounds trap that culls it away
