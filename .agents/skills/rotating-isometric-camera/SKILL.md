---
name: rotating-isometric-camera
description: Carries what is verified about turning an isometric world through four 90-degree views - rotation as a discrete integer state that pre-transforms the grid coordinate before one fixed projection, Z that stays invariant, the depth key term that does not survive and must be recomputed, and the occlusion problem the canonical engine has never solved cleanly. Use whenever a task proposes rotating the camera, adding more than one view of the map, reindexing directional sprites for a turned view, deciding which pieces need art per view, or asking whether the depth key still holds after a turn - including Portuguese phrasings like "girar a camera", "rodar o mapa", "quatro vistas", "ver do outro lado", "efeito 3D", "a ordem de desenho muda quando gira", "preciso de arte por angulo". Triggers on rotacao, vista, camera, 90 graus, quatro rotacoes, reindexar direcao, oclusao ciclica, painter, ordenacao topologica.
metadata:
  type: knowledge
  verification_signal: cd packages/iso-core && npm test
---

# Rotating the isometric camera

## When to use

Before proposing camera rotation, and before estimating it. This is a **decision with no ADR**, and
nothing in this repository implements it. Everything below comes from reading two engines, not from
this codebase — the boundary is marked throughout.

## The status here, first

`packages/iso-core` has no rotation state, `tools/map-builder` has no rotation control, and no ADR
records a decision either way. Adopting rotation is an architecture decision, not a feature ticket.

**Do not implement it inline.** The material here exists so the decision can be made with numbers
instead of intuition.

## What is verified, from engines in production

### Rotation is a discrete integer, not an angle

OpenRCT2 — the canonical isometric engine with four camera views and discrete height — stores
rotation as a `uint8` and advances it with `(rotation + direction) & 3`. There is no continuous
angle, no matrix and no trigonometry anywhere on the path. Its grid transform is the pure 90°
rotation with **no translation term**:

```text
rot0 → ( x,  y)      rot1 → ( y, −x)      rot2 → (−x, −y)      rot3 → (−y,  x)
```

Anti-clockwise falls out of two's complement: `−1 & 3 == 3`.

### Rotation pre-transforms the coordinate; the projection never changes

There is **one** projection formula, and rotation is applied to the world coordinate before it. In
`Translate3DTo2DWithZ` the whole of it is `sx = rotated.y − rotated.x` and
`sy = ((rotated.x + rotated.y) >> 1) − pos.z`. There is no per-rotation projection variant.

**The stored map is never rewritten when the camera turns.** Rotation is a render-time parameter.
That is the single most important structural fact: it means rotation does not touch `BlockStore`,
`EdgeStore` or the project file at all.

Qualify it correctly, though: nothing rotated is *stored*, but the paint path remaps aggressively
**every frame** — coordinate, facing and bounding box each get rotated on the way to the screen.
"Cheap because nothing is stored" and "cheap per frame" are different claims, and only the first is
supported.

**The `>> 1` is deliberate**, with a comment in that engine citing the issue it fixes: integer
division truncates toward zero and breaks for negative coordinates, while an arithmetic shift
floors. This repository already depends on the same property for the opposite direction —
`Math.floor` is the rounding rule that keeps picking correct
(`packages/iso-core/src/geometry.ts:117@00a9af1b`). Two independent codebases arriving at floor for
the same reason is worth trusting.

### Z is invariant, and the depth key is half-affected

In that engine `CoordsXYZ` inherits from `CoordsXY` and **does not override** `Rotate()`. Rotation
slices to the 2D type, and every call site reattaches `z` by hand. The result is Z invariance, but by
explicit reattachment rather than by preservation — copy the pattern and you must copy that detail.

**For this project's key `x + y + z` (`packages/iso-core/src/depth.ts:66@6c115b1b`), the consequence
is exact:**

- the **`z` term enters identically in all four views** — nothing to do;
- the **`x + y` term does not survive** and becomes, in terms of the *stored* coordinates:

```text
rot0: x + y      rot1: y − x      rot2: −(x + y)      rot3: x − y
```

Those four expressions are materialised verbatim in OpenRCT2's `RemapPositionToQuadrant`. The
equivalent and simpler route is the one the projection itself takes: **rotate `(x, y)` first, then
use the same `x' + y'` in all four views.** Prefer that — one code path instead of four.

**Do not repeat the claim that those four expressions are that engine's depth key.** A verification
pass killed that framing: `RemapPositionToQuadrant` is a quadrant *bucket index*, not the final draw
order. The code is verified; the interpretation was rejected.

### The canonical engine does not sort by a scalar key at all

OpenRCT2 resolves draw order by **pairwise 3D bounding-box comparison**, with the comparator
specialised per rotation as a compile-time template parameter — four separately compiled sort
functions. It keeps **two** implementations chosen at runtime by a `gPaintStableSort` flag, one
prepending in place and one accumulating into a temporary list and splicing once.

That split is itself the published evidence of the problem. The PR that added the stable variant was
merged in 2024, and the maintainer's own words are that it "should drastically improve the
z-fighting but it will not make it perfect… it doesn't prevent it from over-drawing which still
happens."

**Read that as the honest ceiling: the reference implementation of isometric-with-rotation has no
clean occlusion answer, only a declaredly partial mitigation.** Any estimate that assumes rotation
is "just a coordinate transform" is wrong by exactly that gap.

### Directional sprites reindex by modular arithmetic — magnitude known, sign not

For **entities**, that engine computes `image_direction = ((rotation << 3) + orientation) & 0x1F`.
Generalised to N evenly spaced directions this is `(direction + rotation·N/4) mod N`, so for this
project's **8 directions the shift is 2 per 90° turn**.

**The sign is not verified.** Nothing in the source establishes whether rotation advances clockwise
or anti-clockwise, nor whether increasing orientation runs the same way as this project's canonical
`S, SW, W, NW, N, NE, E, SE`. Magnitude is forced by geometry; direction has to be settled against
this project's own atlas. Guessing it produces sprites that face backwards in two of the four views.

**Scope limit, and it matters for cost.** That formula covers entities only. Tiles, walls and scenery
go through a different mechanism that takes an explicit direction and selects **per-direction image
ids**. **Do not conclude "no art per rotation is needed" from the entity path.** How much wall, ramp
and roof art four views cost is **not answered** by anything verified here.

### Godot confirms this project's projection, and offers no rotation

Godot's isometric `map_to_local` with a 64×32 tile produces `sx = (x−y)·32 + 32` and
`sy = (x+y)·16 + 16` — algebraically identical to this repo's `worldToScreen`, differing only by the
half-cell offset because Godot returns the cell **centre**. Verified numerically across 169 cells
with zero mismatches. Independent confirmation that
`docs/adr/0013-geometria-isometrica-64x32-z16.md:1@e194895c` picked the standard formulation.

Its coordinate functions take **no rotation, orientation or camera argument** in 4.4, 4.5 or 4.6 —
they branch only on authoring-time resource fields. **Godot has no native isometric camera
rotation.** Its answer to depth is a per-tile z-index plus Y-sort, not a grid Z.

Two data points do **not** make a trend. One engine does rotation, one does not. The claim that
"almost nobody rotates an isometric camera" is **not supported** by anything gathered.

### Cyclic occlusion, with an executable failure

A published demo resolves draw order by **topological sort** over a directed graph of pairwise
"is in front of" relations, rather than any scalar key. Its comparator returns *nothing* when two
boxes are disjoint on screen — the relation is **partial**, which is precisely why a scalar key
cannot exist in general.

On a cycle it **fails silently**: the queue never seeds, and it returns zero blocks with no exception
and no warning. Reproduced by execution — three blocks in a cycle returned 0 of 3; the acyclic
control returned 3 of 3 in correct order. The author proposes Tarjan's SCC to detect cycles and then
split a block or clip, and never implemented it.

**This validates the constraint this project already has.** The map format forbids multi-cell sprites
(`packages/iso-core/src/map.ts:34@0a012d80`) exactly because cyclic occlusion has no correct linear
order. Rotation does not create that problem, but it changes which configurations fall into it — a
scene that is acyclic from one view can be cyclic from another. Treat the format restriction as
load-bearing for rotation too, not as something rotation could relax.

## If the decision is taken, the order of work

1. **Settle the sign** of the direction shift against this project's atlas. Cheap, and everything
   visual depends on it.
2. **Rotate before computing the key**, one path, not four expressions.
3. **Budget the art**, not the maths. The transform is arithmetic; the wall, ramp and roof variants
   are the real cost and are unmeasured.
4. **Expect occlusion to stay imperfect.** Plan the mitigation, not the solution.

## Rules

- **Never store rotated coordinates.** Rotation is a view parameter; the document does not change.
- **Never rotate `z`.** It is invariant, and in the depth key it is the term that already works.
- **Never assume the direction shift's sign.** Verify it against the atlas.
- **Never generalise entity reindexing to tiles and walls.** They are different mechanisms.
- **Never promise clean occlusion.** The reference engine does not have it.
- **Never implement rotation without an ADR.** It touches geometry, depth, input, art budget and the
  project format at once.

## References

- `packages/iso-core/src/depth.ts` — the key whose `x+y` term rotation invalidates
- `packages/iso-core/src/geometry.ts` — the projection this would pre-transform into
- `docs/adr/0013-geometria-isometrica-64x32-z16.md` — the geometry Godot independently corroborates
- `.agents/skills/projecting-isometric-geometry/SKILL.md` — the unrotated coordinate rules
- `.agents/skills/composing-pixi-scene/SKILL.md` — where draw order is applied in this renderer
- OpenRCT2, `src/openrct2/world/Location.hpp` and `src/openrct2/interface/Viewport.cpp` — rotation
  state, the grid transform and the single projection
- OpenRCT2, `src/openrct2/paint/Paint.cpp` — the per-rotation comparator and the two sort variants
- Godot, `scene/resources/2d/tile_set.cpp` — `map_to_local` and `local_to_map`
- shaunlebron/IsometricBlocks, `src/sortBlocks.js` — topological sort and the silent cycle failure
