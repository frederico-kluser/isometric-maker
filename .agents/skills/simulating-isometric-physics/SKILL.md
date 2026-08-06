---
name: simulating-isometric-physics
description: Owns how bodies move and collide in this editor - continuous xy over a discrete integer Z, the support rule that decides whether a cell can be occupied, edges that block crossing, the step that climbs exactly one level, the jump whose parabola exists only on screen, and the swept AABB box (0.65) that gives the character a body against solid blocks. Use whenever moving a character, testing whether a cell or an edge can be crossed, climbing or descending a level, jumping, falling, replaying a deterministic input trace - including Portuguese phrasings like "o personagem atravessa a parede", "nao consegue subir o degrau", "cai pelo chao", "o pulo esta errado", "colisao diagonal", "o movimento nao e deterministico", "usar motor de fisica", "gravidade", "empurrar objeto", "personagem dentro da pedra", "agua nao bloqueia". Triggers on canEnter, canCross, canStepUp, canStepDown, runTrace, colisao, degrau, pulo, suporte, aresta, determinismo, passo fixo, collision-box, solidAt, pushOut.
metadata:
  type: knowledge
  verification_signal: cd packages/iso-core && npm test
---

# Simulating isometric physics

## When to use

Before moving anything that is not the camera, before answering "can it go there", and before
proposing a physics library. The model here is small on purpose, and most requests that sound like
they need more actually need one of the four rules below applied correctly.

## The one boundary that everything else depends on

**The model is integers. The screen is pixels. They never mix.**

`xy` is continuous. `z` is **discrete and integer at every instant** — there is no half height, no
fractional level, no interpolated altitude in the model. Climbing is a step or a jump, never a ramp.
The invariant `Number.isInteger(z)` is tested across the entire jump transition, from progress 0.0 to
1.0 (`packages/iso-core/src/jump.ts:27@217d56ef`).

Anything smooth that the eye sees — the parabola of a jump, the glide between two cells, the camera
offset — lives in **screen space only** and must never be written back into the model. Cross that
boundary once and collision starts testing a position that does not exist.

The logic clock is fixed at 1/60 s with a time accumulator; real `dt` is accumulated and consumed in
discrete steps (`packages/iso-core/src/movement.ts:13@cee4bc63`). `step(state, input, dt)` is pure:
no DOM, no network, no renderer dependency. Same input sequence, same result, on any machine — and that is
verifiable, not aspirational, because `runTrace` exists to verify it
(`packages/iso-core/src/trace.ts:213@5274631d`).

### The defaults, and the one that surprises

`DEFAULT_CONFIG` is `speed: 4` units/s, `fixedDt: 1/60`, `jumpDuration: 0.5` s, `jumpHeight: 1`,
`stepCooldown: 0.3` s (`packages/iso-core/src/movement.ts:80@cee4bc63`).

**`jumpHeight` is 1 — the same level a plain step already climbs.** By default the jump buys nothing
in reach; it buys crossing a gap and clearing an edge. Anyone who reads "a jump is for what a step
cannot do" and expects `z + 2` will find it does not, and the parameter to change is
`jumpHeight`, not the step rule.

The 300 ms `stepCooldown` is why holding a direction against a staircase climbs at a fixed cadence
rather than as fast as the frame rate allows. It is a config value, not a physics constant.

## Occupancy: two questions, never one

The engine answers two separate questions, and collapsing them into one is the most common way to
get a body through a wall.

### `canEnter(map, x, y, z)` — can a body *be* here?

A cell is enterable when **both** hold (`packages/iso-core/src/collision.ts:61@2866b21a`):

1. It has no block — it is empty.
2. It has support: at `z = 0` the ground is always support; at `z > 0` the cell at `z − 1` must have
   a block. You must be standing on something.

The support rule is what stops a body from floating. It also means an empty cell at height with
nothing under it is **not** enterable — falling is a consequence of the rule, not a separate feature.

### `canCross(map, from, to)` — can a body *pass between* two cells?

Crossing an edge needs the destination to be enterable **and** no wall on the edge between them
(`packages/iso-core/src/collision.ts:142@2866b21a`).

**Diagonal movement tests BOTH cardinal edges that compose it. If either is blocked, the diagonal is
refused** (`packages/iso-core/src/collision.ts:9@2866b21a`). This is the rule that prevents cutting
a corner through the join of two perpendicular walls — visually the body would slip through a seam
that has no opening. Testing one edge, or testing the destination only, reintroduces the bug.
(The AABB box enforces the same no-corner-cutting rule in volume: the second axis' sweep sees the
corner cell.)

Walls live on edges, not in cells, and the editor may record a wall from **either** of the two cells
that share it. Every edge query must therefore check both sides
(`packages/iso-core/src/step-up.ts:49@df864f4c`). Checking one side finds half the walls.

**The box sees blocks, not walls.** `resolveMovement` clamps only on `solidAt` cells; edge walls
have no volume and are invisible to the sweep. They keep their historical judge: the center
crossing, refused by reverting to the previous position (`edgesAllowCross` in
`packages/iso-core/src/simulate.ts@f91ae6a3`). A wall in a doorway therefore still refuses the
crossing exactly as before the box.

## The step: exactly one level, and why it bypasses `canCross`

- **Up** when the destination floor is exactly `z + 1`, the destination is enterable, and there is no
  wall on the shared edge **at either level**.
- **Down** when the destination floor is `z − 1` or lower, under the same conditions.
- **`z + 2` or higher does not climb.** It needs two steps or a jump
  (`packages/iso-core/src/step-up.ts:13@df864f4c`).

`canStepUp` and `canStepDown` reuse `canEnter` for walkability but check the edge **directly**,
without `canCross` (`packages/iso-core/src/step-up.ts:83@df864f4c`). That is deliberate and worth
understanding before anyone "simplifies" it: `canCross` requires the destination *at the same z* to
be enterable, which is never true when the destination has a support block at `from.z` — that block
is precisely the step being climbed. Routing the step through `canCross` makes every staircase
unwalkable.

A wall on the edge blocks the step in **both** directions, at both levels. A step is not a hole in a
wall.

**The step has two triggers in the simulation** (`packages/iso-core/src/simulate.ts@f91ae6a3`): the
historical center crossing of the cell edge, and — since the character has a 0.65 box — the cell
pressed by the blocked face (`pressedCells` in `collision-box.ts`). The box touches a one-level
step 0.325 cell before the center crosses, so the crossing trigger alone would leave the character
stuck at the wall. The pressed-face trigger only fires when the box was actually clamped and
`stepUp` is held; it tries `stepZOnCross` on the pressed cell.

## The jump: three phases, and a parabola that is decoration

`z` never takes an intermediate value (`packages/iso-core/src/jump.ts:7@217d56ef`):

1. **Rise**, progress 0.0 → 0.5: `z` stays at `zOrigin`; the sprite rises via `visualOffsetY`.
2. **Transition**, progress = 0.5: `z` switches from `zOrigin` to `zDest`. One discrete change.
3. **Fall**, progress 0.5 → 1.0: `z` stays at `zDest` while `visualOffsetY` returns to zero.

`visualOffsetY(progress)` is a pure parabola in screen pixels, independent of model state
(`packages/iso-core/src/jump.ts:99@217d56ef`).

**Collision is tested at the model's effective `z`, which is always an integer.** During the rise it
tests `zOrigin`; during the fall it tests `zDest`. `visualOffsetY` **never** affects collision. A
character mid-jump is not "between levels" as far as the map is concerned — it is on one of them.

This is the single place where the screen/model boundary is most tempting to violate, because the
sprite visibly occupies space the model says is empty.

## Horizontal collision is a swept AABB box, not a point

The collision used to be `map.hasBlock(Math.floor(pos))` — the character's **center** against the
destination cell. Since onda3 the character has a body: an axis-aligned box of half width
`PLAYER_HALF = 0.325` (~0.65 cell, narrower than a cell on purpose) that the engine sweeps per axis
against solid cells (`packages/iso-core/src/collision-box.ts@fbb6bafd`).

`resolveMovement` moves X first, updates the box, then moves Y. **Blocking one axis does not block
the other**: hitting a wall at an angle slides along its face. This is the project's sliding
decision — per axis, never diagonal. A corner cannot be cut: the second axis' sweep runs with the
box already advanced on the first, so it sees the corner cell and clamps there
(`packages/iso-core/src/collision-box.ts`).

Because the box is narrower than a cell, it stops with its face **0.325 cell before the center**
reaches the wall — the visible difference from the old point test. Consequences:

- **Blocking happens at face contact.** A straight walk into a wall clamps `cx` to
  `boundary − half` and zeroes the velocity. The exact frame of the first block changed when the
  box landed (the old center-crossing frame vs. the face-contact frame are both pinned in
  `simulate.test.ts`).
- **The step-up must fire at face contact too** — see the step section above.

`solidAt(x, y, z)` is the question "does this cell block movement?" — `map.solidAt` when the map
provides it, falling back to `hasBlock` (every block blocks, the historical behaviour). The
catalog-aware implementation is `solidAtFromBlocks`, built on `blocksMovement`: **water, lava and
foliage do not block** (`solid: false`, `kind: decoration`). The boolean `hasBlock` cannot tell
water from stone; the box engine only honours the `solid` flag when the map (or the caller) gives
it a catalog-aware `solidAt` (`packages/iso-core/src/collision-box.ts`).

Push-out (`pushOut`, MTV in `collision-box.ts`) resolves the one invalid state the sweep refuses: a
box already embedded in a solid (the sweep returns zero movement rather than pushing or letting it
deepen). It pushes along the axis of least penetration, capped at 0.9 cell. The editor uses it
after placing a block on the test character: placing a block on a character pushes the character
out instead of burying it (`pushPlayerOutOfCell`).

## The engine is not wired to the map, and a comment says otherwise

`CollisionMap` is the minimal interface the engine needs: `hasBlock(x,y,z)` and
`hasEdge(x,y,z,lado)`, plus an optional `solidAt` for the box engine
(`packages/iso-core/src/collision.ts:48@2866b21a`). Its doc comment states that `BlockStore` and
`EdgeStore` satisfy it (`packages/iso-core/src/collision.ts:43@2866b21a`).

**They do not.** `BlockStore` exposes `getBlock`, `setBlock`, `removeBlock`, `heightAt`, `forEach`
and `toRle`. `EdgeStore` exposes `getEdge`, `setEdge` and `removeEdge`. Neither declares `hasBlock`
or `hasEdge`, and no adapter between them exists anywhere in the repository. Every implementation of
`CollisionMap` in the tree is a hand-written test double.

The consequences are specific, and they matter more than the missing method names:

- **The simulation has never run against real map data.** The suite is green and proves the rules;
  it does not prove that the rules see the editor's blocks and walls. Wiring the two is unwritten
  work, not a rename. One corner IS wired: the editor's push-out (`pushPlayerOutOfCell`) consumes
  the real `MapData` through `enumerateBlocks` + `blocksMovement` — but that is the editor asking
  the box, not the simulation running.
- **The edge type is invisible to the engine.** `EdgeEntry` carries a `tipo`, and the map format
  allows values like `parede`, `porta`, `pilar`, `escada`. `hasEdge` takes **no** `tipo` parameter,
  so the moment a naive adapter is written, **every edge blocks equally**. A door becomes a wall.
  (The tools that once wrote those values were removed with the 2D editor; the format still allows
  them.)
- **A `porta`/`escada` behaviour therefore does not exist.** Neither is implemented in the model —
  they are strings recorded in the map file, and the engine cannot honour them without a
  `tipo`-aware interface.

When a task asks to connect the editor to collision, that is the design decision to surface first:
does `hasEdge` gain a type, or does the adapter translate types into blocking and non-blocking? It
is not an implementation detail, and picking one silently locks in door behaviour for the project.

## Block physics: support, falling, domino effect

In addition to character movement, the physics system now includes block physics
(`packages/iso-core/src/block-physics.ts`) — what happens when a block is unsupported.

**The support rule** (`hasSupport` at `packages/iso-core/src/block-physics.ts:80-89`):
a block at `(x, y, z)` has support if `z === 0` (the floor is always solid) or if
`map.hasBlock(x, y, z - 1)`. Every other condition — floating blocks, overhangs — means
the block is unsupported and should fall.

**Deterministic falling** (`stepBlockPhysics` at `packages/iso-core/src/block-physics.ts:164-282`):
each unsupported block accumulates a step counter. Every `fallInterval` steps (default 6, at
1/60s each = 100ms), the block descends 1 level. If the new position has support, it lands.
If not, it keeps falling. The fall is purely vertical (no horizontal drift).

**Domino effect:** when a block lands at a new Z in a column, the block that was resting on
it from above loses its support. `stepBlockPhysics` detects this by re-running
`findUnsupported` against the original occupied set (filtered by columns already in the
simulation). Newly unsupported blocks join the `falling` list.

**Entity collision:** if a falling block's new position equals the test character's cell,
the character is pushed out via MTV (`pushOutOf` in `collision-box.ts`). The block is not
pushed — it's considered more massive.

**Simulation lifecycle:**
- `initBlockPhysics(world)` — finds all unsupported blocks, returns initial falling set
- `stepBlockPhysics(world, falling, acc, player, config)` — advances one fixed step
- `resolveMapAfterSimulation(world, falling, landed)` — computes final positions as if
  the simulation were applied

The block physics operates on a `BlockWorld` (occupied cells + `CollisionMap`), not directly
on `MapData`. The editor owns the translation between RLE columns and `BlockWorld`.

## Query API: DDA raycast, AABB overlap, AABB sweep

Three query functions in `packages/iso-core/src/physics-query.ts` answer spatial questions
against the `CollisionMap` without needing meshes, Three.js, or any renderer:

- **`raycast(origin, direction, maxDistance, map)`** (`physics-query.ts:98-180`) —
  Amanatides-Woo DDA voxel traversal. Walks the grid cell by cell along the ray. Returns
  the first occupied cell, its face normal, and the distance. Used by `dda-raycast.ts`
  for editor picking.

- **`overlap(aabb, entities)`** (`physics-query.ts:210-237`) — tests `GridAabb` against a
  list of `OverlapEntity`. Iterates the sub-volume of grid cells that overlap the AABB
  and returns all matching entities. Used for entity-block collision detection.

- **`overlapMap(aabb, map)`** (`physics-query.ts:244-266`) — same as overlap but queries
  `CollisionMap.hasBlock` directly instead of an entity list. Iterates the sub-volume of
  cells.

- **`sweep(box, velocity, map)`** (`physics-query.ts:294-460`) — sweeps an `EntityBox`
  through the grid along a velocity vector. Uses per-axis sweep (X first, then Y, then Z)
  with sliding — the same order as `resolveMovement` in `collision-box.ts`. Returns the
  first collision's normal, time (0-1), and the hit cell. Useful for movement prediction
  and projectile trajectory checking.

All four functions are pure and tested in iso-core — no DOM, no Three.js, no renderer.

## What is deliberately absent

- **No physics engine, and no decision recorded either way.** There is no Rapier, no matter.js, no
  planck. The grid model above is the whole simulation.
- **No continuous height, no ramps, no slopes.** Discrete Z is the decision
  (`docs/adr/0013-geometria-isometrica-64x32-z16.md:1@e194895c`); ramps are a Z model this project
  does not have. A placed `escada` is the intended escape hatch and is not yet honoured — see above.
- **No voxel ray traversal — IMPLEMENTED in Onda 2.** DDA voxel raycasting now exists
  in `packages/iso-core/src/dda-raycast.ts` (Amanatides-Woo algorithm) and
  `packages/iso-core/src/physics-query.ts` (`raycast`, `overlap`, `overlapMap`, `sweep`).
  The editor picking uses DDA instead of Three.js Raycaster. `trace.ts` remains an input
  replay (for deterministic verification), not a DDA raycast.
- **No multi-cell footprint.** The map format forbids it
  (`packages/iso-core/src/map.ts:34@0a012d80`). This is why the classic grid-traversal correctness
  trap — an occupant listed in a voxel whose geometry extends past it, so the first non-empty voxel
  is not the nearest hit — cannot occur here. If multi-cell footprints are ever allowed, that trap
  arrives with them and the traversal needs a containment test.
- **No friction, no mass, no movement cost — in the SIMULATION.** The **data** exists:
  `packages/iso-core/src/block-catalog.ts` gives every material `solid`, `friction`, `density`,
  `movementCost` and `harmful`, and `map-instances.ts` resolves each placed block into a
  self-contained record carrying them. **`solid` is now honoured** — the box engine asks
  `blocksMovement` (via `solidAtFromBlocks`), so water, lava and foliage no longer block. The other
  four properties are still ignored by the simulation. Wiring them is a task, not a defect — and the
  numbers themselves are **this project's choice, not measured or sourced**: only the densities have
  any relation to the real world. Say so when quoting them.
- **Grid-space AABB exists, is consumed, and is grid-space on purpose.** `aabbOf` returns cell
  coordinates, half-open at the top so neighbours touch without overlapping; the character box
  (`entityAabb`) uses the same convention. Collision in screen pixels would solve in diamonds what
  was already a cube, and it is exactly where camera rotation would break everything — the screen
  changes view, the world does not.

**On bringing in a 2D physics engine:** the honest position is that this has not been evaluated
against sources. The structural obstacle is stated plainly — every 2D engine simulates a plane, and
this world's third axis is a discrete integer stack that no 2D engine models. Marrying them means
running the engine in the projected plane and keeping Z entirely outside it, which reintroduces by
hand exactly the support and edge rules above. That is an argument, not a verified finding, and it
should be labelled as such wherever it is repeated.

## Rules

- **Never write a fractional `z`.** If a calculation produces one, the calculation belongs in screen
  space.
- **Never test collision against a screen position.** `visualOffsetY` and camera offsets are not
  model inputs.
- **Test both edges on a diagonal, and both sides of an edge.** Each shortcut passes obvious tests
  and fails at wall joins.
- **Do not route the step through `canCross`.** It looks like deduplication and it breaks stairs.
- **Never re-add the boolean `hasBlock` test in front of the box.** The box sweep IS the block
  collision; testing the destination cell with `hasBlock` on top of it is the old point test
  resurrected, and it makes water block again. Ask `solidAt`, never `hasBlock`.
- **The box is a volume; walls are surfaces.** Blocks clamp the face (swept, with sliding); edge
  walls refuse the center crossing (revert). Give a wall volume and it becomes a block; give a block
  a surface and the sweep stops working.
- **A behaviour that is absent is absent, not broken.** Ramps and slopes are still absent (discrete
  Z is the decision); sliding and push-out are decided. A task that changes one of the decided ones
  is a behaviour change with new tests, not a bug fix.
- **Never present the material numbers as measured.** Friction and movement cost are this project's
  starting point, in a table so that changing them is changing a table.
- **`kind` and `material` are orthogonal.** What a block is made of (friction, density) is not what
  it is in the world (`solid`, `platform`, `liquid`, `decoration`). Stone can be a solid cube or a
  platform you walk on and pass under; conflating them means inventing a material per case.

## References

- `docs/adr/0027-exportacao-v2-instancias-e-materiais.md` — instances, materials and grid-space AABB
- `packages/iso-core/src/block-catalog.ts` — the material table and the block kinds
- `packages/iso-core/src/map-instances.ts` — the physics-ready view of the map
- `packages/iso-core/src/movement.ts` — the fixed logic step and the determinism contract
- `packages/iso-core/src/collision.ts` — `canEnter`, `canCross`, the diagonal rule, `solidAt`
- `packages/iso-core/src/collision-box.ts` — the swept AABB box, `resolveMovement`, `pushOut`
- `packages/iso-core/src/simulate.ts` — `fixedStepWithMap`, the face-pressed step, `resolveCollision`
- `packages/iso-core/src/step-up.ts` — the one-level step and why it avoids `canCross`
- `packages/iso-core/src/jump.ts` — the three phases and the screen-only parabola
- `packages/iso-core/src/trace.ts` — deterministic replay, the acceptance instrument
- `packages/iso-core/src/block-physics.ts` — block falling, support, domino effect
- `packages/iso-core/src/physics-query.ts` — DDA raycast, AABB overlap, AABB sweep
- `packages/iso-core/src/entity-collision.ts` — entity-vs-entity collision (block hits actor)
- `.agents/skills/projecting-isometric-geometry/SKILL.md` — the coordinate space this model lives in
- `.agents/skills/simulating-editor-physics/SKILL.md` — how the editor runs the physics live
