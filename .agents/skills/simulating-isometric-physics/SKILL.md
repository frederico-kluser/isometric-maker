---
name: simulating-isometric-physics
description: Owns how bodies move and collide in this editor - continuous xy over a discrete integer Z, the support rule that decides whether a cell can be occupied, edges that block crossing, the step that climbs exactly one level, and the jump whose parabola exists only on screen. Use whenever moving a character, testing whether a cell or an edge can be crossed, climbing or descending a level, jumping, falling, replaying a deterministic input trace, or deciding whether to bring in a physics engine - including Portuguese phrasings like "o personagem atravessa a parede", "nao consegue subir o degrau", "cai pelo chao", "o pulo esta errado", "colisao diagonal", "o movimento nao e deterministico", "usar motor de fisica", "gravidade", "empurrar objeto". Triggers on canEnter, canCross, canStepUp, canStepDown, runTrace, visualOffsetY, colisao, degrau, pulo, suporte, aresta, determinismo, passo fixo.
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
discrete steps (`packages/iso-core/src/movement.ts:13@fa05a9d9`). `step(state, input, dt)` is pure:
no DOM, no network, no PixiJS. Same input sequence, same result, on any machine — and that is
verifiable, not aspirational, because `runTrace` exists to verify it
(`packages/iso-core/src/trace.ts:213@741fa7ce`).

### The defaults, and the one that surprises

`DEFAULT_CONFIG` is `speed: 4` units/s, `fixedDt: 1/60`, `jumpDuration: 0.5` s, `jumpHeight: 1`,
`stepCooldown: 0.3` s (`packages/iso-core/src/movement.ts:80@fa05a9d9`).

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

A cell is enterable when **both** hold (`packages/iso-core/src/collision.ts:61@5720ac42`):

1. It has no block — it is empty.
2. It has support: at `z = 0` the ground is always support; at `z > 0` the cell at `z − 1` must have
   a block. You must be standing on something.

The support rule is what stops a body from floating. It also means an empty cell at height with
nothing under it is **not** enterable — falling is a consequence of the rule, not a separate feature.

### `canCross(map, from, to)` — can a body *pass between* two cells?

Crossing an edge needs the destination to be enterable **and** no wall on the edge between them
(`packages/iso-core/src/collision.ts:142@5720ac42`).

**Diagonal movement tests BOTH cardinal edges that compose it. If either is blocked, the diagonal is
refused** (`packages/iso-core/src/collision.ts:9@5720ac42`). This is the rule that prevents cutting
a corner through the join of two perpendicular walls — visually the body would slip through a seam
that has no opening. Testing one edge, or testing the destination only, reintroduces the bug.

Walls live on edges, not in cells, and the editor may record a wall from **either** of the two cells
that share it. Every edge query must therefore check both sides
(`packages/iso-core/src/step-up.ts:49@b7c70ec1`). Checking one side finds half the walls.

## The step: exactly one level, and why it bypasses `canCross`

- **Up** when the destination floor is exactly `z + 1`, the destination is enterable, and there is no
  wall on the shared edge **at either level**.
- **Down** when the destination floor is `z − 1` or lower, under the same conditions.
- **`z + 2` or higher does not climb.** It needs two steps or a jump
  (`packages/iso-core/src/step-up.ts:13@b7c70ec1`).

`canStepUp` and `canStepDown` reuse `canEnter` for walkability but check the edge **directly**,
without `canCross` (`packages/iso-core/src/step-up.ts:83@b7c70ec1`). That is deliberate and worth
understanding before anyone "simplifies" it: `canCross` requires the destination *at the same z* to
be enterable, which is never true when the destination has a support block at `from.z` — that block
is precisely the step being climbed. Routing the step through `canCross` makes every staircase
unwalkable.

A wall on the edge blocks the step in **both** directions, at both levels. A step is not a hole in a
wall.

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

## When horizontal movement hits something, the body stops before it

`runTrace` replays a sequence of `(duration, input)` frames against the movement engine with
collision checked each step. On collision with a wall or an occupied cell, the character **stops at
the position before the collision** — it does not slide, and it does not tunnel
(`packages/iso-core/src/trace.ts:15@741fa7ce`).

Sliding along a wall is a design decision that has **not** been made. If a task asks for it, that is
a new behaviour and a new test, not a bug fix.

## The engine is not wired to the map, and a comment says otherwise

`CollisionMap` is the minimal interface the engine needs: `hasBlock(x,y,z)` and
`hasEdge(x,y,z,lado)` (`packages/iso-core/src/collision.ts:48@5720ac42`). Its doc comment states
that `BlockStore` and `EdgeStore` satisfy it (`packages/iso-core/src/collision.ts:43@5720ac42`).

**They do not.** `BlockStore` exposes `getBlock`, `setBlock`, `removeBlock`, `heightAt`, `forEach`
and `toRle`. `EdgeStore` exposes `getEdge`, `setEdge` and `removeEdge`. Neither declares `hasBlock`
or `hasEdge`, and no adapter between them exists anywhere in the repository. Every implementation of
`CollisionMap` in the tree is a hand-written test double.

The consequences are specific, and they matter more than the missing method names:

- **Collision has never run against real map data.** The suite is green and proves the rules; it does
  not prove that the rules see the editor's blocks and walls. Wiring the two is unwritten work, not
  a rename.
- **The edge type is invisible to the engine.** `EdgeEntry` carries a `tipo`, and the editor writes
  four values into it — `parede`, `porta`, `pilar`, `escada`
  (`tools/character-builder/src/map/tools/wall.ts:23@027ac4e4`). `hasEdge` takes **no** `tipo` parameter, so
  the moment a naive adapter is written, **every edge blocks equally**. A door becomes a wall.
- **Two documented behaviours therefore do not exist.** The editor states that a `porta` "permite
  passagem (não bloqueia colisão)" and that an `escada` "permite step-up independentemente da
  altura" (`tools/character-builder/src/map/tools/wall.ts:10@027ac4e4`). The second one directly contradicts
  the one-level rule above. **Neither is implemented in the model** — they are intentions recorded
  at the tool layer, and the engine cannot honour them without a `tipo`-aware interface.

When a task asks to connect the editor to collision, that is the design decision to surface first:
does `hasEdge` gain a type, or does the adapter translate types into blocking and non-blocking? It
is not an implementation detail, and picking one silently locks in door behaviour for the project.

## What is deliberately absent

- **No physics engine, and no decision recorded either way.** There is no Rapier, no matter.js, no
  planck. The grid model above is the whole simulation.
- **No continuous height, no ramps, no slopes.** Discrete Z is the decision
  (`docs/adr/0013-geometria-isometrica-64x32-z16.md:1@e194895c`); ramps are a Z model this project
  does not have. A placed `escada` is the intended escape hatch and is not yet honoured — see above.
- **No voxel ray traversal.** `trace.ts` is an input replay, not a DDA raycast — the name invites the
  confusion. The camera "ray" of this project is the arithmetic diagonal walk owned by
  `editing-isometric-maps`, and it steps whole Z levels rather than marching a parametric line.
- **No multi-cell footprint.** The map format forbids it
  (`packages/iso-core/src/map.ts:34@0a012d80`). This is why the classic grid-traversal correctness
  trap — an occupant listed in a voxel whose geometry extends past it, so the first non-empty voxel
  is not the nearest hit — cannot occur here. If multi-cell footprints are ever allowed, that trap
  arrives with them and the traversal needs a containment test.
- **No push, no slide, no friction, no mass — in the SIMULATION.** The **data** now exists and the
  simulation ignores it: `packages/iso-core/src/block-catalog.ts` gives every material `solid`,
  `friction`, `density`, `movementCost` and `harmful`, and `map-instances.ts` resolves each placed
  block into a self-contained record carrying them. `collision.ts` still reads the block store
  directly and consults none of it. Wiring them is a task, not a defect — and the numbers themselves
  are **this project's choice, not measured or sourced**: only the densities have any relation to the
  real world. Say so when quoting them.
- **Grid-space AABB exists, and it is grid-space on purpose.** `aabbOf` returns cell coordinates,
  half-open at the top so neighbours touch without overlapping. Collision in screen pixels would
  solve in diamonds what was already a cube, and it is exactly where camera rotation would break
  everything — the screen changes view, the world does not.

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
- **A behaviour that is absent is absent, not broken.** Sliding, ramps and pushing are new features
  needing a decision, not defects to patch.
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
- `packages/iso-core/src/collision.ts` — `canEnter`, `canCross`, the diagonal rule
- `packages/iso-core/src/step-up.ts` — the one-level step and why it avoids `canCross`
- `packages/iso-core/src/jump.ts` — the three phases and the screen-only parabola
- `packages/iso-core/src/trace.ts` — deterministic replay, the acceptance instrument
- `.agents/skills/projecting-isometric-geometry/SKILL.md` — the coordinate space this model lives in
- `.agents/skills/interpolating-pixi-state/SKILL.md` — how integer model state is drawn smoothly
