---
name: projecting-isometric-geometry
description: Owns the coordinate math of this editor - the 2:1 dimetric projection, the floor rule that decides which cell a screen point belongs to, the diagonal identity that makes picking arithmetic instead of raycasting, and the depth key x+y+z with walls on a half cell. Use whenever converting between screen and grid, picking a cell under the cursor, deciding draw order, placing a wall, or diagnosing a sprite that draws in front of what it should be behind - including Portuguese phrasings like "converter tela para celula", "que celula esta sob o cursor", "ordem de desenho", "a parede aparece na frente", "por que meia celula", "o picking pega o bloco errado", "quantos pixels por nivel". Triggers on worldToScreen, screenToWorld, screenToCell, depthKey, sortByDepth, diamante, dimetrica, projecao, ancora, arredondamento, meia celula.
metadata:
  type: knowledge
  verification_signal: cd packages/iso-core && npm test
---

# Projecting isometric geometry

## When to use

Before converting a pixel to a cell, before deciding what draws on top of what, and before writing
any number that relates screen space to grid space. This is the layer everything else stands on: a
wrong constant here produces artefacts three modules away that look like rendering bugs.

## The projection is fixed and the numbers are not negotiable

Tile of 48×24 px, one Z level worth **29 px**, Z integer and discrete. This is decided, not a default —
changing it invalidates every project file written and every asset generated.

```text
worldToScreen(x,y,z):   sx = (x−y)·24          sy = (x+y)·12 − z·29
screenToWorld(sx,sy,z): a = sx/24   b = (sy + z·29)/12   x = (b+a)/2   y = (b−a)/2
```

**It is dimetric 2:1, not true isometry.** True isometry has a 2:1.1547 ratio and produces diamond
edges at an irrational angle, which aliases in pixel art. The 2:1 ratio makes the edge rise exactly
two pixels horizontally for one vertically, and the diamond seams cleanly. With integer world
coordinates and valid geometry, `worldToScreen` returns exact integers — no rounding, no drift.

The height of the diamond must be exactly half its width. `geometry.ts` enforces this rather than
trusting the caller; any other ratio breaks the seam property.

### `zStep` is not a taste parameter — it is the cube's vertical edge

This projection is a genuine orthographic one only if the two matrix rows are orthogonal **and equal
in magnitude**:

```text
row_x = ( W/2, −W/2,  0 )     row_x · row_y = 0  holds for any W, H, d
row_y = ( H/2,  H/2, −d )     |row_x|² = |row_y|²  ⟹  d = sqrt((W² − H²)/2)
```

With `H = W/2` that is **`d = W·√6/4 ≈ 0.6124·W`**, so a correct cube sprite is `H + d ≈ 1.1124·W`
tall — about 11% taller than square. It is **never** `W/2`, and never `H`.

This project shipped `64 / 32 / 16` for a while, where a cube needs 39: blocks were drawn at **40.8%
of a cube's height**, and the symptom read as "the generated art does not fit the map"
(`docs/adr/0024-cubo-isometrico-canonico.md`).

**No integer 2:1 tile width has an exact integer vertical edge** — it would require `3W²/8` to be a
perfect square, which needs `W = 2m√6`. Rounding is mandatory and harmless: `d` is one constant
applied identically at every level, so stacking ten blocks is off by the same 1.34% as stacking one.

**The square-sprite trap.** With `d = H`, moving up one level shifts the sprite by exactly as much as
stepping back one diagonal `(x−1, y−1)` — both land on the same pixel, and "above" becomes
indistinguishable from "behind". The canonical edge breaks the tie
(`tools/map-builder/src/placement.test.ts`).

## The two rules a naive implementation gets wrong

### The floor rule: a point on an edge belongs to the lower cell

`screenToWorld` returns fractional coordinates — the exact position on a continuous grid, not a
cell. To get the discrete cell you apply `Math.floor` to **both** components
(`packages/iso-core/src/geometry.ts:117@00a9af1b`), and `screenToCell` is the shortcut that does it.

`Math.floor` is not one rounding rule among several. It is **the only one that preserves the
diagonal identity below** while still assigning every screen point to exactly one cell. Rounding to
nearest looks more natural and breaks both properties. The consequence to state out loud: a point
exactly on the boundary between two cells belongs to the one with smaller coordinates — the one
nearer the grid origin.

### The diagonal identity is `zStep/tileHeight`, not one cell

```text
screenToWorld(sx, sy, z+1, geom) ≡ screenToWorld(sx, sy, z, geom) + (zStep/tileHeight, zStep/tileHeight)
```

With this project's geometry — `tileHeight` 32, `zStep` 16 — that is **+(0.5, 0.5) per level**, so
**two Z levels are needed to cross one full cell** (`packages/iso-core/src/geometry.ts:126@00a9af1b`).

**Do not write `+(1,1)`.** `docs/adr/0013-geometria-isometrica-64x32-z16.md:1@e194895c` states the
identity as `(+1,+1,+1)` in its Consequences section, and that is wrong for the very geometry that
same ADR fixes — it would only hold if `zStep == tileHeight`. The decision in 0013 stands; the
number does not, and `docs/adr/0020-identidade-da-diagonal-de-picking.md:1@c30746a9` records the
correction. Code written from the ADR's number picks a cell one level off every other level.

Write the general form. Writing the 2:1 special case invites the next reader to repeat this exact
mistake when the geometry moves.

**Why this identity matters:** it makes picking arithmetic. The camera ray in grid space is a
straight diagonal, so finding what is under the cursor is walking Z from the top down and testing
occupancy — no raycast, no hit-testing, no heuristic. `editing-isometric-maps` owns the walk itself.

## Depth: one key, two adjustments, two failures it cannot fix

Draw order is `depthKey(cell) = x + y + z` (`packages/iso-core/src/depth.ts:66@6c115b1b`). Larger key
draws later, on top — it is closer to the camera.

**Walls sit on a half cell.** A wall on a cell edge is visually between its owner and the neighbour,
so its key is offset by ±0.5: north and east are `+0.5` (drawn after the owning cell), south and west
are `−0.5` (drawn before) — `packages/iso-core/src/depth.ts:89@6c115b1b`.

**Ties are broken by a declared rule, not by sort stability:** y, then x, then z
(`packages/iso-core/src/depth.ts:122@6c115b1b`). Relying on the sort being stable is how order
changes when the input order changes.

Two occlusion failures have **no comparator fix**, and knowing which one you are looking at is the
whole diagnosis:

1. **The tall sprite.** A sprite three Z levels tall anchored at one cell gets one key from its base,
   but its top should draw over cells with higher `z`. The key only sees the base
   (`packages/iso-core/src/depth.ts:24@6c115b1b`). Mitigating this needs sprite height metadata,
   which this module deliberately does not have — it looks only at grid coordinates.
2. **The multi-cell object.** An object spanning several cells produces **cyclic occlusion**, for
   which no linear order is correct. There is no comparator to write.

The project's answer to (2) is a model constraint, not a renderer trick: **the map format forbids
multi-cell sprites** (`packages/iso-core/src/map.ts:34@0a012d80`). Anything larger than one cell is
sliced at authoring time. An editor can impose that; an inherited game could not.

## The anchor: declared for blocks, measured for characters

**The projection formula never tells you where to anchor the sprite.** It returns the **top corner of
the cell's top diamond** — not the sprite's bounding-box corner, and not the diamond's centre.
Assuming "top-left" displaces the whole map by half a tile width, and the error only shows up when
two pieces have to touch.

**Blocks: declared.** A block sprite is exactly the cube's bounding box, so the anchor is a field of
the geometry — `anchorX = W/2`, `anchorY = 0` (`packages/iso-core/src/iso-cube.ts`). No margin, no
guessing. The single-cell sprite constraint (ADR 0013) is what makes this possible: art that spills
outside the cell is a multi-cell sprite under another name.

**Characters: measured.** `create-character-v3` pads the final canvas ~2× for animation room, capped
at 256, so the sprite comes back larger than requested and does not sit where a fixed fraction says.
A hardcoded `y: 0.875` anchor lands roughly 11 px off on an inflated canvas — nearly a full level of
displacement. Measure it from the opaque bounding box of the family.

### The scale must be uniform, or the diamond stops being 2:1

Setting `sprite.width` and `sprite.height` separately is two different scale factors. On a 48×48
texture drawn into a `tileWidth × (tileHeight + zStep)` box that was 1.333× horizontally and 1.0×
vertically — the art's top diamond stopped being 2:1 and stopped seaming with its neighbour. Use one
factor on both axes; when the texture is not the tile width, `tileWidth / texture.width` corrects the
horizontal seam without deforming anything (`tools/map-builder/src/placement.ts`).

## Rules

- **Never hardcode the three numbers.** Read `tileWidth`, `tileHeight` and `zStep` from the geometry,
  which derives from `iso-cube.ts`. The identities above are written in terms of them for a reason.
- **Never invent a `zStep`.** It is `sqrt((W² − H²)/2)`, rounded. A "nice" value draws a slab.
- **Never scale a sprite non-uniformly.** One factor, both axes.
- **Never infer the anchor from the bounding box of generated art.** Decoration spilling above the
  top face moves the box and not the cube.
- **The stage scale must be a whole number.** A 1.5× upscale destroys the 2:1 seam, and no amount of
  edge extrusion recovers it. `choosing-pixi-renderer` owns why.
- **Cell height is derived, never stored.** It is the highest occupied `z` plus one. Storing a height
  map *and* a block map creates two truths about the same terrain.
- **Screen space is not grid space.** The jump parabola, the camera offset and the anchor all live in
  screen space and must never reach the model. `simulating-isometric-physics` owns that boundary.

## References

- `docs/adr/0024-cubo-isometrico-canonico.md` — the canonical cube, and the `zStep` correction
- `docs/adr/0013-geometria-isometrica-64x32-z16.md` — the original decision, vigente except the numbers
- `docs/adr/0020-identidade-da-diagonal-de-picking.md` — the corrected diagonal identity
- `docs/03-mapa/cubo-e-molde.md` — the arithmetic and the three classic perspective bugs
- `packages/iso-core/src/iso-cube.ts` — the cube geometry, the anchor and the impossibility proof
- `packages/iso-core/src/geometry.ts` — projection, floor rule, the identity in general form
- `tools/map-builder/src/placement.ts` — uniform scale and declared anchor, with tests
- `packages/iso-core/src/depth.ts` — the key, the half-cell offset, the tie-break
- `.agents/skills/editing-isometric-maps/SKILL.md` — picking, placement and the diagonal walk
- `.agents/skills/composing-pixi-scene/SKILL.md` — how this ordering reaches the renderer
