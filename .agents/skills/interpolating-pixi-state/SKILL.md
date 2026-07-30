---
name: interpolating-pixi-state
description: Carries how this editor turns a discrete grid model into smooth motion on screen - the render clock stays separate from the logic step, the character is interpolated between integer cells while the model keeps only the cell, and a jump goes from integer z to integer z with the parabola living only in screen space. Use whenever moving a character across the map, wiring a walk, a step or a jump, deciding what the frame loop is allowed to write, or diagnosing motion that stutters, drifts off its block or draws behind the wrong thing - including Portuguese phrasings like "o personagem anda tremendo", "suavizar o movimento entre celulas", "interpolar entre celulas do grid", "andar de uma celula para outra", "o boneco pisca atras da parede quando pula", "o pulo esta errado", "o movimento acelera em outro monitor". Triggers on interpolacao, suavizacao, celula, passo fixo, relogio de render, deltaMS, pulo, parabola, ordenacao de profundidade, z inteiro.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Turning a discrete grid into motion

## When to use

Before writing anything that moves a character across the map, and whenever motion looks wrong —
advancing a whole cell at a time, ending up off its own block, or drawing behind something it should
be in front of.

**There is no network here.** This project is a local, single-user editor: no authoritative server,
no multiplayer, no netcode (`AGENTS.md:51@7a66ff95`). What survives is the part that was never about
netcode — a model made of integers, drawn continuously.

**Upstream is thin on this.** The vendored ticker skill names a fixed-timestep loop as one reason to
take over the frame driver and stops there
(`tools/pixi-reference/vendor/skills/pixijs-ticker/SKILL.md:194@e9ca8e1f`); none of the 26 bundled
PixiJS skills covers moving a sprite between two grid cells. Everything below the ticker facts is
this project's own reasoning, and it is labelled accordingly.

## Injected knowledge

### The one thing that is not negotiable

Interpolation is a **display** technique. It changes what is drawn, never what is stored.

The model is integers all the way down: a cell is `(x, y)`, and height is an integer `z` worth 16 px
on screen (`docs/00-produto/glossario.md:23@4a1f6480`). There is no half level
(`docs/adr/0013-geometria-isometrica-64x32-z16.md:26@4229af26`).

So an interpolated position is per-frame scratch. It may place the sprite, its shadow, a name plate
and the hover highlight. It may **not** be rounded back into the model, written to the project file,
or asked which cell is occupied. Picking in this geometry walks the `(+1,+1,+1)` diagonal from the
top down and takes the first solid block
(`docs/adr/0013-geometria-isometrica-64x32-z16.md:39@4229af26`) — a fractional `z` has nothing to
walk, and the project format cannot express it in the first place.

### Two clocks, and they must not be merged

| Clock | Source | Advances | Owns |
|---|---|---|---|
| logic step | the editor's simulation | in fixed increments | cell occupancy, `z`, which action is playing |
| frame | the ticker | every rendered frame | where the sprite is drawn between two steps |

Drawing straight from the logic state moves the character one whole cell at a time — 32 px of screen
x and 16 px of screen y per cell of grid x, by the projection in
`docs/adr/0013-geometria-isometrica-64x32-z16.md:8@4229af26` — however smooth the frame rate is.
That is the stutter people try to fix with easing and cannot: the easing is being applied to a value
that only changes at step boundaries.

Three ticker facts decide whether the display clock is right:

- **`deltaTime` is a multiplier, not a duration.** It is `deltaMS` times `Ticker.targetFPMS`, so it
  is about 1.0 at 60 Hz and half that at 120 Hz
  (`tools/pixi-reference/vendor/skills/pixijs-ticker/SKILL.md:65@e9ca8e1f`). Because it scales with
  the frame time it already sums to the same value per second on any display — safe as a multiplier,
  wrong as a clock. Express the logic step in milliseconds and advance it with `deltaMS`;
  accumulating `deltaTime` against a duration in ms stretches the step by about 16.7x (arithmetic
  from `targetFPMS`, not a measurement), on every display alike.
- **The v8 callback receives a `Ticker`, not a number**
  (`tools/pixi-reference/vendor/skills/pixijs-ticker/SKILL.md:7@e9ca8e1f`). Treating the argument as
  milliseconds gives `NaN` positions and vanished sprites, with no error.
- **`minFPS` clamps how large a delta may get** (default 10,
  `tools/pixi-reference/vendor/skills/pixijs-ticker/SKILL.md:121@e9ca8e1f`). That matters more in an
  editor than in a game: a long stall — an atlas decoding, a generation coming back — would
  otherwise advance the display clock past the whole step and teleport the character.

### Interpolating between cells

Interpolate in **screen space**: project the cell being left and the cell being entered with the
projection fixed by the geometry ADR, then blend the two by the normalised progress of the logic
step.

The projection is affine, so blending grid coordinates and then projecting lands on exactly the same
pixel as projecting both ends and blending — that is arithmetic, not a measurement. Screen space
wins anyway, because it is two blends instead of three plus a projection, and because the jump's arc
already lives there.

Two consequences worth stating:

- **A step needs no special case.** Climbing exactly one level on entering a cell is automatic
  (`docs/00-produto/glossario.md:33@4a1f6480`), so its extra 16 px of screen y is already inside the
  same cell-to-cell blend. Only a deliberate jump needs an arc.
- **The stage scale is a single integer factor**
  (`docs/adr/0013-geometria-isometrica-64x32-z16.md:38@4229af26`), so a fractional world position
  reaches the screen as a fractional device position. Whether to snap the interpolated position to
  whole pixels before drawing is a real trade — snapping keeps every frame on the pixel grid at the
  price of visibly stepped motion at low speeds — and **this project has not chosen**.

### The jump goes from integer z to integer z

A jump is a deliberate change of `z`, with reach measured in whole levels
(`docs/00-produto/glossario.md:34@4a1f6480`). Both ends are integers; nothing in between is state.

- **The logical transition is atomic.** The character occupies the origin block, then the
  destination block. No frame has `z` at 1.5, because the format has no such value
  (`docs/adr/0013-geometria-isometrica-64x32-z16.md:26@4229af26`).
- **The parabola is a screen-space y offset**, added on top of the interpolated position, and it has
  to return to exactly zero at the end of the arc. An arc that ends at 0.4 px leaves the sprite off
  its own block, and the error compounds across jumps.
- **The depth key uses the logical z, never the visual one.** Draw order is `x + y + z`
  (`docs/00-produto/glossario.md:32@4a1f6480`), with the wall offset and the multi-cell failure
  described in `docs/adr/0013-geometria-isometrica-64x32-z16.md:40@4229af26`. Feed the arc's screen
  offset into sorting instead and a jumping character flickers in front of and behind the same wall,
  once per jump, at a rate that depends on the frame rate.

**Which `z` sorts a character mid-jump — origin, destination, or the higher of the two — is not
decided.** It is the first thing to look at when a jump animates correctly and sorts wrong.

### Where this attaches in PixiJS

The renderer side is small, which is the point. Three hooks, all verifiable:

```bash
S=.agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs
node $S members Ticker            # the frame clock: deltaMS, minFPS, speed
node $S exists UPDATE_PRIORITY    # ordering: interpolate before anything reads positions
node $S exists Application.render # so frames can be driven manually
```

`Application.render` is registered as a ticker listener at `LOW`
(`tools/pixi-reference/vendor/skills/pixijs-ticker/SKILL.md:7@e9ca8e1f`), and the full order is
`INTERACTION > HIGH > NORMAL > LOW > UTILITY`
(`tools/pixi-reference/vendor/skills/pixijs-ticker/SKILL.md:75@e9ca8e1f`) — so `LOW` is not the
floor. An interpolation step registered at `NORMAL` or above runs before the frame is drawn, and
`UTILITY` is where anything that must read the drawn result belongs. Disabling the automatic start
lets a hand-written loop own the ordering explicitly — the shape is in `bootstrapping-pixi-app`.

### What is not verified

Almost all of the tuning, and this is not a formality:

- **There is no movement code in this repository.** Even the map vocabulary is agreed and
  unimplemented (`docs/00-produto/glossario.md:88@4a1f6480`), so nothing here has been measured — it
  is derived from the geometry ADR and from the vendored ticker documentation.
- **The duration of a logic step is not chosen**, and neither is whether the editor runs a fixed
  step at all or animates directly on the frame clock. No ADR decides it.
- **Snapping to whole pixels** and **which `z` sorts a jump** are the two open trades named above.
- Treat this file as the weakest-evidence member of the PixiJS set, and revise it against the first
  movement code that actually exists.

## References

- `docs/adr/0013-geometria-isometrica-64x32-z16.md` — the projection, integer `z`, the depth key and where it fails
- `docs/00-produto/glossario.md` — `cell`, `zStep`, `step`, `jump`, `jumpLevels`, `depthSort`
- `tools/pixi-reference/vendor/skills/pixijs-ticker/SKILL.md` — deltaTime versus deltaMS, priorities, manual frames
- `.agents/skills/bootstrapping-pixi-app/SKILL.md` — where the frame loop is wired
- `.agents/skills/composing-pixi-scene/SKILL.md` — the depth sort a jump must not fight
