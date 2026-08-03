---
name: controlling-threejs-camera
description: Carries how this editor's orthographic camera moves - pan in the view plane from the camera matrix columns, integer zoom through camera.zoom, discrete 90-degree yaw rotation across four views with no OrbitControls, and the pixel-to-world conversion that keeps panning correct at any zoom. Use whenever wiring camera input, panning, zooming or rotating the 3D view - including Portuguese phrasings like "mover a camera", "arrastar o mapa 3d", "dar zoom no editor 3d", "girar a camera em 90 graus", "a camera nao acompanha o mouse", "zoom fracionario desalinha a grade", "trocar orbitcontrols por controle proprio". Triggers on pan, zoom, yaw, OrthographicCamera, setCameraRotation, ELEVATION, mover camera, girar camera.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck --target es2023 --lib es2023,dom,dom.iterable --module esnext --moduleResolution bundler --allowImportingTsExtensions --jsx react-jsx src/map/3d/scene3d.ts src/map/3d/controls3d.ts src/map/3d/cube3d.ts src/map/3d/pick3d-raycaster.ts src/map/3d/grid3d.ts
---

# Controlling the Three.js camera

## When to use

Before wiring mouse or touch input to the 3D view, before changing how the camera moves or turns,
and before reaching for OrbitControls.

## The camera

The editor uses a real `OrthographicCamera`, not a perspective one. The frustum size is the
`DEFAULT_DISTANCE` (15), with left/right derived from the viewport aspect
(`tools/character-builder/src/map/3d/controls3d.ts:43-65@af9fd54d`).

## Position: elevation 30°, yaw in 90° steps

```typescript
const yaw = BASE_YAW + rotation * (Math.PI / 2);
camera.position.x = dist * Math.cos(ELEVATION) * Math.sin(yaw);
camera.position.y = dist * Math.sin(ELEVATION);
camera.position.z = dist * Math.cos(ELEVATION) * Math.cos(yaw);
camera.lookAt(0, 0, 0);
```

(`tools/character-builder/src/map/3d/controls3d.ts:73-85@af9fd54d`), with `ELEVATION = Math.PI / 6`
(`tools/character-builder/src/map/3d/controls3d.ts:25@af9fd54d`) and `BASE_YAW = Math.PI / 4` (`tools/character-builder/src/map/3d/controls3d.ts:31@af9fd54d`).

**30° is dimetric, not true isometric.** True isometry uses atan(1/√2) ≈ 35.264°, where all three
axes foreshorten equally. 30° produces the 2:1 diamond look the 2D editor already has
(`tools/character-builder/src/map/3d/scene3d.ts:10-11@dddf5555`).

## Pan: the camera moves in the view plane

Pan shifts the camera perpendicular to the view direction, using the camera matrix columns — column
0 is `right`, column 4 is `up`:

```typescript
const right = new THREE.Vector3();
const up = new THREE.Vector3();
right.setX(camera.matrix.elements[0]!);
right.setY(camera.matrix.elements[1]!);
right.setZ(camera.matrix.elements[2]!);
up.setX(camera.matrix.elements[4]!);
up.setY(camera.matrix.elements[5]!);
up.setZ(camera.matrix.elements[6]!);
camera.position.addScaledVector(right, -dx);
camera.position.addScaledVector(up, dy);
```

(`tools/character-builder/src/map/3d/controls3d.ts:92-118@af9fd54d`)

Screen pixels become world units through `pixelDeltaToWorld`, which divides the frustum by the
viewport size and by `camera.zoom` (`tools/character-builder/src/map/3d/controls3d.ts:151-165@af9fd54d`).

## Zoom: integer steps for pixel art

`camera.zoom` scales the frustum without touching left/right/top/bottom. The implementation clamps
to [0.25, 8] and refreshes the projection matrix
(`tools/character-builder/src/map/3d/controls3d.ts:126-132@af9fd54d`). The caller keeps zoom integer —
fractional zoom misaligns the grid and shimmers pixel art; that contract lives in the caller, not in
this function (`tools/character-builder/src/map/3d/controls3d.ts:123-124@af9fd54d`).

## Rotation: discrete, four views — the camera orbits, cubes do not

The four views are 90° yaw steps: 0 = south looking north, 1 = east looking west, 2 = north looking
south, 3 = west looking east. `setCameraRotation` turns instantly
(`tools/character-builder/src/map/3d/controls3d.ts:73-85@af9fd54d`); `animateRotation` tweens the camera position along the same circle
over 280 ms with a cubic ease (`tools/character-builder/src/map/3d/scene3d.ts:306-351@dddf5555`).
The cube meshes do NOT rotate with the camera — only the camera orbits (see
`creating-threejs-cubes`).

## Why not OrbitControls

OrbitControls orbits a point with continuous rotation — built for 3D inspection. This editor needs
discrete 90° steps, integer zoom and a fixed behavior set; a hand-written control (~60 lines) is
simpler than configuring OrbitControls into those non-default behaviors
(`tools/character-builder/src/map/3d/controls3d.ts:1-6@af9fd54d`).

## What is not verified

The 280 ms duration and the cubic ease are visual choices, never measured. The claim that
OrbitControls would need more configuration is engineering judgment, not a benchmark.

## References

- `tools/character-builder/src/map/3d/controls3d.ts` — the camera implementation
- `tools/character-builder/src/map/3d/scene3d.ts` — where pan/zoom/rotation are exposed to React
- [Three.js OrthographicCamera docs](https://threejs.org/docs/#api/en/cameras/OrthographicCamera)
