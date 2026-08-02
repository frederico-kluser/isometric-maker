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

**The decision was taken and rotation is implemented.** `packages/iso-core/src/rotation.ts` holds the
four discrete views, `rotation-tween.ts` the tween timing, `rotation-rigid.ts` the screen-space
affine of the turn, and `tools/map-builder` has the control. Three ADRs record it: `0021` (rotation
as a view parameter), `0026` (the animated turn, superseded) and `0030` (the rigid composed-frame
turn that replaced 0026's mid-turn mechanism).

What follows is still the material the decision was made from, plus what the implementation added.
Read it before touching rotation — the traps are all still live.

### The turn is animated, and the COMPOSED FRAME is what moves (ADR 0030)

Flipping `rotation` from 0 to 1 in one frame does not read as a turn; it reads as a cut, and whoever
was editing loses track of where they were. So the turn is a 280 ms tween with a symmetric cubic
ease — and what that tween drives changed once, for a reason worth keeping.

**Interpolating per-block positions was tried (ADR 0026) and reads wrong.** The projected lattice
squashes mid-turn while each unrotated sprite keeps its size: neighbours gap and overlap, depth
swaps pop block by block, and the map reads as pieces sliding individually. Geometrically correct,
visually broken — the user's words were "cada bloco roda individualmente".

The current mechanism (`tools/map-builder/src/scene.ts`, ADR 0030): snapshot the source view and the
target view into two viewport-sized `RenderTexture`s, then move BOTH under the same screen affine
`L(τ) = P ∘ R(τ) ∘ P⁻¹` — squash the ground plane, rotate, unsquash
(`packages/iso-core/src/rotation-rigid.ts`) — with a cross-fade, source opaque underneath. At integer
τ the trig is snapped to {−1, 0, 1} and endpoint agreement with `rotatePoint` is exact by strict
equality, so the last transition frame lands pixel-identical on the first resting frame. `L` is exact
only for z = 0: height shears slightly mid-sweep and destination occlusion is carried by the fade,
not recomputed — declared, and invisible in practice at 280 ms.

**No individual art is ever resampled at rest.** Rotating one piece of pixel art by any
non-multiple of 90° resamples it and smears the paid art — the constraint that ruled out spinning
the container in ADR 0026, and it still holds per piece; it is also what forces the cross-fade
between pre-drawn views. What ADR 0030 changed is where the one deliberate resample happens: the
composed frame, once, during the sweep, with `linear` filtering on the snapshots only
(`SNAPSHOT_SCALE_MODE`) — a named aesthetic choice, one line to flip.

**External precedent, verified this time:** Doom (r_things.c) never rotates a sprite on screen — it
selects one of up to 8 pre-drawn rotations and lets projection do all motion (its floor *flats* ARE
angle-resampled each frame, r_plane.c, so quote the claim narrowly). SNES Mode 7 / Contra III rotate
the composited playfield as a single layer while sprites swap pre-drawn views — the exact pattern
transplanted here. The squash–rotate–unsquash conjugation itself was found documented nowhere: it is
this project's derivation, fixed by tests, not an external convention. On duration and easing the
result is unchanged from the 0026-era pass — zero claims that survived verification: 280 ms and the
cubic ease remain this project's choice, in a named constant.

### During a turn there is no cell under the cursor

`screenToCell` uses the discrete `rotation`, never the continuous `turn`, and the placement preview
is hidden while the camera moves. Inventing a cell from a fractional rotation puts the piece
somewhere arbitrary.

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

## What the four views cost in art, and what they do not

Since ADR 0029, **every generated world block ships four distinct views** — the `uniform` mode (one
artwork reused across the four views, one generation) was removed precisely because turning the
camera on one showed the same drawing and the cross-fade had nothing to show
(`docs/adr/0029-quatro-vistas-molde-encadeado-e-rotate.md`). The art budget is 4 tile generations
(`chained`) or 1 tile + 1 `create-character-v3` (`rotated`) per block, by explicit user decision.

Procedural cubes vary per view for free: same face tone, different material grain
(`packages/iso-core/src/cube-raster.ts`, `materialShader`).

**The light is fixed to the CAMERA, not the world.** Top brightest, right middle, left darkest — in
all four views, always. Fixing it to the world would need four artworks for shading alone and would
make the same piece change colour as the camera turns, which reads as a bug rather than as lighting.
The corollary: **no drop shadow on anything rotatable.** A pre-rendered shadow cannot turn, so it
would point the wrong way in three of the four views.

## Rules

- **Never store rotated coordinates.** Rotation is a view parameter; the document does not change.
- **Never rotate `z`.** It is invariant, and in the depth key it is the term that already works.
- **Never resample a piece's art individually.** The transition moves the composed frame as one body
  — two snapshots, the same affine, cross-fade (ADR 0030); at rest every view is pre-drawn art.
- **Never pick a cell from the continuous `turn`.** Picking reads the discrete `rotation`.
- **Never take the long way round.** From view 3 to view 0 is `+1`, not `−3`; a half turn is
  genuinely ambiguous and must break the tie by a declared rule.
- **Never assume the direction shift's sign.** Verify it against the atlas.
- **Never generalise entity reindexing to tiles and walls.** They are different mechanisms.
- **Never promise clean occlusion.** The reference engine does not have it, and mid-turn is where it
  shows most.
- **Never present the turn's duration or easing as a community convention.** Nothing external
  verified them.

### Texture blocks don't rotate (ADR 0032)

Block art has two paths (ADR 0032):

- **v2 blocks** (`chained` | `rotated`, 4 faces): rotation selects the face via
  `(facing + rotation) mod 4`. Each view shows different art — the classic 3D illusion.
- **v3 blocks** (`texture`, ADR 0032): one animated texture, same in every view. The camera
  still turns (the grid rotates, the affine transforms, the cross-fade runs), but `textureFor`
  always returns the current animation frame regardless of `rotation`. The block is a decal,
  not a volume.

The animation plays continuously via `app.ticker` in `scene.ts` — unlike the rest of the scene
which only draws on state change, animated blocks need a per-frame tick to advance their frame
index. The tick only fires when at least one animated block is in the palette.

## References

- `docs/adr/0021-rotacao-de-camera-em-quatro-vistas.md` — rotation as a view parameter, discrete
- `docs/adr/0030-giro-rigido-do-quadro-composto.md` — the rigid composed-frame turn; supersedes 0026
- `docs/adr/0032-textura-animada-unica-abandono-3d.md` — animated textures, rotation-independent art
- `docs/adr/0026-giro-de-camera-animado.md` — the per-position turn this replaced, kept as record
- `packages/iso-core/src/rotation.ts` — the four discrete views and the reindexing
- `packages/iso-core/src/rotation-rigid.ts` — the screen affine `L(τ)` and its snapped endpoints
- `packages/iso-core/src/rotation-tween.ts` — tween timing, easing and the short path
- `packages/iso-core/src/depth.ts` — the key whose `x+y` term rotation invalidates
- `packages/iso-core/src/geometry.ts` — the projection this pre-transforms into
- `tools/map-builder/src/scene.ts` — the cross-fade and the ticker loop, plus animated texture support
- `.agents/skills/projecting-isometric-geometry/SKILL.md` — the unrotated coordinate rules
- `.agents/skills/composing-pixi-scene/SKILL.md` — where draw order is applied in this renderer
- OpenRCT2, `src/openrct2/world/Location.hpp` and `src/openrct2/interface/Viewport.cpp` — rotation
  state, the grid transform and the single projection
- OpenRCT2, `src/openrct2/paint/Paint.cpp` — the per-rotation comparator and the two sort variants
- Godot, `scene/resources/2d/tile_set.cpp` — `map_to_local` and `local_to_map`
- shaunlebron/IsometricBlocks, `src/sortBlocks.js` — topological sort and the silent cycle failure
