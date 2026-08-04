---
name: controlling-threejs-camera
description: Carries how this editor's orthographic camera moves - the target point that pan and zoom move instead of a fixed lookAt, continuous damped zoom anchored on the cursor, the geometric wheel step, the pixel-to-world conversion that keeps panning exact at any zoom, discrete 90-degree yaw with no OrbitControls, and why fractional zoom stopped being forbidden. Use whenever wiring camera input, panning, zooming or rotating the 3D view, or debugging a camera that jumps back to the origin, a zoom that lags or steps, or a drag that outruns the cursor - including Portuguese phrasings like "mover a camera", "arrastar o mapa 3d", "o zoom esta travando", "zoom com lag", "zoom no cursor", "girar a camera em 90 graus", "a camera volta para o centro". Triggers on pan, zoom, yaw, target, OrthographicCamera, anchorZoom, zoomStep, ELEVATION, roda do mouse, mover camera, girar camera.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck --target es2023 --lib es2023,dom,dom.iterable --module esnext --moduleResolution bundler --allowImportingTsExtensions --jsx react-jsx src/map/3d/scene3d.ts src/map/3d/controls3d.ts src/map/3d/cube3d.ts src/map/3d/pick3d-raycaster.ts src/map/3d/grid3d.ts
---

# Controlling the Three.js camera

## When to use

Before wiring mouse or touch input to the 3D view, before changing how the camera moves or turns, and
before reaching for OrbitControls.

## The camera orbits a TARGET, not the origin

`placeCamera(camera, target, yaw)` puts the camera at `target + orbitOffset(yaw)` and looks at the
target (`tools/character-builder/src/map/3d/controls3d.ts:145@cd06ae76`). Pan moves the target; a turn
keeps it; an anchored zoom nudges it.

This is not decoration. With a fixed `lookAt(0,0,0)`, turning the camera after dragging the map threw
the view back to the origin — the user lost the place they were working on, once per turn.

`placeCamera` ends with `updateMatrixWorld(true)`, and that call is load-bearing: pan and anchored
zoom read the camera matrix columns to know what "right" and "up" are on screen. Without forcing the
update, the first drag after a turn uses the *previous* view's axes.

## Position: elevation 30°, yaw in 90° steps

```typescript
const yaw = BASE_YAW + rotation * (Math.PI / 2);
camera.position.copy(target).add(orbitOffset(yaw));
camera.lookAt(target);
```

`ELEVATION = π/6` (`tools/character-builder/src/map/3d/controls3d.ts:38@cd06ae76`) and
`BASE_YAW = π/4`. **30° is dimetric, not true isometric** — true isometry uses atan(1/√2) ≈ 35.264°,
where all three axes foreshorten equally. 30° is what produces the exact 2:1 diamond, and that
exactness is what lets a sprite be mapped onto a cube corner-for-corner
(`mapping-sprites-onto-cubes`).

The camera distance does not affect scale — the projection is orthographic. It is generous, and `near`
is negative, so that panning far from the content never clips a block out of the frustum.

## Zoom: continuous, damped, and anchored on the cursor

Three pieces, each replacing a specific defect:

**Geometric step.** `zoomStep` multiplies by `e^(−deltaY·k)`
(`tools/character-builder/src/map/3d/controls3d.ts:227@cd06ae76`). Additive steps are huge near the
minimum and imperceptible near the maximum — that is why an additive wheel feels stuck at one end and
twitchy at the other.

**Exponential damping.** The current zoom chases the target with `1 − e^(−dt/τ)`
(`tools/character-builder/src/map/3d/controls3d.ts:272@cd06ae76`). A fixed per-frame lerp factor
makes the same gesture slow at 60 Hz and frantic at 144 Hz.

**Cursor anchor.** `anchorZoom` moves the target so the world point under the cursor stays put
(`tools/character-builder/src/map/3d/controls3d.ts:247@cd06ae76`):

```text
target₁ = target₀ + (right·nx·halfW + up·ny·halfH) · (1/zoom₀ − 1/zoom₁)
```

It uses the **current** zoom, not the target zoom: what is on screen right now is what must stay under
the cursor. Without the anchor, zoom always enters through the centre of the screen and the user
chases what they wanted to look at with the middle mouse button.

## Fractional zoom is allowed now — the reason it was banned is gone

The 2D PixiJS editor required an integer stage scale, because pixel art on a fractionally scaled 2D
stage shimmers and misaligns. That stage no longer exists (ADR 0037). Here the art is a texture on
geometry, sampled with `NearestFilter`: there is no pixel grid of a stage to misalign, only a
framebuffer and a projection. What survives of the old problem is sampling shimmer on heavily
minified textures, and that is the declared price of a fluid zoom.

## Pan: pixels to world, divided by zoom

`panTarget` converts a pixel delta with the frustum size, the viewport size **and** the current zoom
(`tools/character-builder/src/map/3d/controls3d.ts:197@cd06ae76`). Dropping the division by zoom
makes the map
run four times ahead of the cursor at zoom 4 — the classic symptom of a pan that "does not follow the
mouse".

## Rotation: discrete, four views, and the cubes come along

The four views are 90° yaw steps: 0 = south looking north, 1 = east, 2 = north, 3 = west. The animated
turn tweens the **yaw angle**, not the position: lerping between two positions 90° apart cuts through
the inside of the circle, so the camera would swing closer to the map mid-turn
(`tools/character-builder/src/map/3d/scene3d.ts:664@7c752159`). It also takes the short way around, or
going from view 3 to view 0 unwinds 270° backwards.

Unlike before, the block meshes rotate along with the camera — see `mapping-sprites-onto-cubes`.

## Why not OrbitControls

OrbitControls orbits a point with continuous rotation, built for 3D inspection. This editor needs
discrete 90° steps, a damped cursor-anchored zoom and a target that pan owns; a hand-written control
is smaller than the configuration that would be needed to suppress the defaults.

## What is not verified

The 280 ms turn, the cubic ease, `ZOOM_SMOOTHING_TAU` and the wheel sensitivity are visual choices,
never measured. The claim that OrbitControls would need more configuration is judgment, not a
benchmark.

## References

- `tools/character-builder/src/map/3d/controls3d.ts` — the camera implementation
- `tools/character-builder/src/map/3d/scene3d.ts` — where pan/zoom/turn meet the frame loop
- `bootstrapping-threejs-scene` — the draw scheduler these controls feed
- [Three.js OrthographicCamera docs](https://threejs.org/docs/#api/en/cameras/OrthographicCamera)
