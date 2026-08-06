---
name: simulating-editor-physics
description: Carries how the 3D map editor runs the physics model live - the test-mode requestAnimationFrame loop that owns the clock, why actor state lives in refs and not React state, the clamped delta that survives a backgrounded tab, the collision index rebuilt only when the document changes, the two conversions between world facing and screen direction, the screen-only jump offset, and the push-out when a block lands on the character. Use whenever touching test mode, the character loop, collision wiring, the actor sprite, jump or fall behaviour, or debugging a character that walks sideways after a camera turn, sinks into stone, or teleports after alt-tab - including Portuguese phrasings like "modo teste", "o personagem atravessa a parede", "anda de lado ao girar", "colocar bloco em cima do personagem", "o pulo ficou errado". Triggers on stepWithMap, CollisionMap, MovementState, rAF, dt, spawnZAt, pushPlayerOutOfCell, visualOffsetY, worldDirectionFromKeys, modo teste.
metadata:
  type: knowledge
  verification_signal: cd packages/iso-core && npm test && cd ../../tools/character-builder && npm test && npm run typecheck
---

# Running the physics model inside the editor

## When to use

Before touching test mode, the character loop, or anything that connects `iso-core`'s physics to the
3D scene. The physics *rules* are `simulating-isometric-physics`; this skill is the **wiring** — the
clock, the indices, and the four conversions between the model's coordinates and the screen's.

## One entry point into the model

The live loop calls exactly one function: `stepWithMap(state, input, dt, config, map)`
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:608@3073b710`). It is the only door that has
both collision *and* carried state — `step` has no horizontal collision (the character walks through
walls) and `runTrace` takes scalars and forgets velocity, facing and jump between calls
(`packages/iso-core/src/simulate.ts:4@f91ae6a3`).

If a new caller needs "move one frame against the map", it calls `stepWithMap`. Adding a second
implementation is how the live path and the deterministic replay start to disagree.

## The loop owns the clock; React does not

Test mode runs its own `requestAnimationFrame`
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:586@3073b710`). The character's position lives
in refs, not in React state, and the loop reads the refs. Reconciling the tree 60 times a second for
a value only the renderer consumes is the whole cost of a frame for none of the benefit. React hears
about the character **only when the cell changes**.

Two guards that are not optional:

- **The clamped delta.** `dt = min((now − last)/1000, 0.1)`. Returning from a backgrounded tab
  produces a delta of seconds; unclamped, the engine processes hundreds of steps at once and the
  character crosses the map or falls through it.
- **The re-entry guard.** `enteringTestRef` plus a `rafRef !== null` check
  (`tools/character-builder/src/map/3d/map-editor-3d.tsx:539@3073b710`). Double-clicking "Testar"
  before the character fetch resolves would start two loops; the second overwrites the first's frame
  id and the exit can never cancel it.

The loop must not outlive the component: it is cancelled both by `exitTestMode`
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:674@3073b710`) and by an unmount effect.

## The collision index is a derived document, rebuilt on change

`buildCollisionMap(map)` turns the RLE column store into the `hasBlock`/`hasEdge` pair the model asks
for, indexed for O(1) (`tools/character-builder/src/map/collision-map.ts:52@9b9aeb65`). It is
rebuilt when the map changes during a test, never per frame
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:341@3073b710`).

The trap it exists to absorb: **air inside a column is explicit**. Placing a block at z=5 in an empty
column fills z=0..4 with empty runs, so `getBlock` returning `''` means *empty*, not *solid*.
Treating `''` as a block makes the character walk on air.

`spawnZAt(map, x, y)` picks the drop-in height by the same support rule `canEnter` uses, so a
character placed there is never inside stone nor floating
(`tools/character-builder/src/map/collision-map.ts:92@9b9aeb65`).

## The two conversions, in opposite directions

The document stores the world in one orientation; the camera looks from four
(`tools/character-builder/src/map/actor.ts:5@8f86f7bc`). Confusing the two directions is *the*
classic defect here:

| Direction | Function | What breaks without it |
|---|---|---|
| key → world | `worldDirectionFromKeys(held, rotation)` | after a camera turn, W walks sideways |
| world → screen | `viewDirectionIndex(facing, turn)` | the sprite faces one way and walks another |

`viewDirectionIndex` takes the **continuous** turn, the same value the scene draws with, so the
sprite switches direction on the same frame the map does.

South is `(+1, +1)`, angle π/4: in this projection growing `x+y` moves *down* the screen, and down
the screen is toward the viewer (`tools/character-builder/src/map/actor.ts:23@8f86f7bc`).

## The jump is a screen offset, never a level

The actor's world Y is `next.z − visualOffsetY(jump.progress, 1)`
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:652@3073b710`). The sign flips because
`visualOffsetY` is in screen coordinates, where Y grows downward, and three.js Y grows up. The model's
`z` stays an integer level throughout the arc — the parabola is decoration and never decides what the
character can stand on.

The ground shadow uses `floorY = next.z`, the level **without** the jump offset. Reusing the sprite's
Y would lift the shadow with the character, which is the one thing a shadow may not do. Its opacity
tracks the parabola's height, not the jump clock: `1 − progress` would erase a standing character's
shadow, because standing is progress 1.0 (`tools/character-builder/src/map/actor.ts:118@8f86f7bc`).

## Editing while testing: push-out, not overlap

Placing or painting a solid block on the character's cell calls `pushPlayerOutOfCell`
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:435@3073b710`). Placing a block on the
character never leaves them inside the stone. Water, lava and foliage are not solid and do not push —
the check honours the material catalog, not the mere presence of a block.

## Simular mode: block physics in the editor

A third editor mode, "simular" (`tools/character-builder/src/map/3d/map-editor-3d.tsx:213`),
runs block physics simulation independent of the test character. The entry point is
`enterSimulateMode` (`tools/character-builder/src/map/3d/map-editor-3d.tsx:878-985`).

**How it works:**

1. Snapshots the current map (`simOriginalMapRef`)
2. Builds a `BlockWorld` — extracts all occupied cells from the RLE map and builds a `CollisionMap`
3. Runs `initBlockPhysics` to detect unsupported blocks
4. Starts a tick loop at ~10 fps (100ms intervals) calling `stepBlockPhysics`
5. On each descent, constructs a virtual `MapData` from the falling/landed blocks and renders it

**Controls** (`tools/character-builder/src/map/3d/map-editor-3d.tsx:1280-1334`):
- **Play/Pause** — starts/stops the simulation tick
- **Step** — advances one physics step (single call to `stepBlockPhysics`)
- **Aplicar** — resolves final positions via `resolveMapAfterSimulation`, constructs a new `MapData`,
  and pushes it to the undo history (`tools/character-builder/src/map/3d/map-editor-3d.tsx:987-1042`)
- **Descartar** — discards the simulation state, restores the original map

**Physics rules** (in `packages/iso-core/src/block-physics.ts`):
- **Support**: `hasSupport(x,y,z)` returns true if `z === 0` or `(x,y,z-1)` has a block
- **Falling**: blocks descend 1 level per `fallInterval` ticks (6 ticks at 1/60s = ~100ms)
- **Domino effect**: when a block lands at a new Z, `findUnsupported` re-scans to detect
  blocks above that lost their support — they join the `falling` list on the next step
- **Entity push-out**: if a falling block intersects the test character's cell, the character
  is pushed out via MTV (`pushPlayerOutOfCell`)

**State tracking:**
- `simFallingRef` — blocks currently falling (updated per tick)
- `simLandedRef` — blocks that have landed (cumulative, for the final resolution)
- `simAccumulatorRef` — step accumulator modulo `fallInterval`
- `simStateRef` — `'running'` or `'paused'` (mirrored as React state for UI)

The simulation tick runs at ~10 fps for visual feedback — it's deliberately slow so the user
can watch blocks cascade. The actual physics step (`stepBlockPhysics`) is deterministic: same
input always produces the same output, regardless of frame rate.

## What is not verified

- The rules the model enforces are covered by `iso-core`'s suite; **this wiring is not**. No test
  drives the rAF loop, the ref plumbing or the push-out through the editor.
- `hasEdge` receives no type, so every edge blocks equally — a door blocks like a wall. Recorded as a
  known limitation (`tools/character-builder/src/map/collision-map.ts:17@9b9aeb65`); the editor has
  no edge tool today, so `edges` is empty in practice.
- The actor's on-screen height (1.6 world units) is a visual choice, unrelated to the collision box.

## References

- `packages/iso-core/src/simulate.ts` — `stepWithMap`, the one live door
- `tools/character-builder/src/map/collision-map.ts` — the document→physics bridge
- `tools/character-builder/src/map/actor.ts` — directions, shadow and arrow data
- `simulating-isometric-physics` — the rules themselves
- `rotating-isometric-camera` — where the turn value comes from
