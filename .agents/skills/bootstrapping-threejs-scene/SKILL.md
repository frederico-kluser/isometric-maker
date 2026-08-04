---
name: bootstrapping-threejs-scene
description: Carries how this editor boots its Three.js scene inside a React component - the WebGLRenderer created once against a React-owned canvas, the single frame loop that coalesces draws and stops when idle, the split between syncing the world and drawing the camera, the light rig that only casts, ResizeObserver for the panel, and the teardown order that keeps WebGL contexts from leaking. Use whenever creating or wiring the 3D viewport, adding to the frame loop, handling resize, or tearing the scene down - including Portuguese phrasings like "criar a cena 3d", "montar o viewport 3d", "a cena 3d nao aparece", "o desenho nao atualiza", "redimensionar o canvas 3d", "fechar a aba vaza memoria", "limpar a cena ao sair". Triggers on WebGLRenderer, OrthographicCamera, requestDraw, render loop, rAF, ResizeObserver, scene bootstrap, cena 3d, viewport 3d, createIsoScene3D.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck --target es2023 --lib es2023,dom,dom.iterable --module esnext --moduleResolution bundler --allowImportingTsExtensions --jsx react-jsx src/map/3d/scene3d.ts src/map/3d/controls3d.ts src/map/3d/cube3d.ts src/map/3d/pick3d-raycaster.ts src/map/3d/grid3d.ts
---

# Bootstrapping the Three.js scene

## When to use

Before writing the 3D viewport entry point, before adding anything that draws or animates, and before
wiring resize or teardown.

## The scene is a side effect, not a component

The canvas is a React element; the scene is not. No Three.js node passes through reconciliation: the
scene is created once in a `useEffect` against the React-owned canvas and then driven by imperative
calls. `map-editor-3d.tsx` creates it in one effect and destroys it in that same effect's cleanup
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:251@3073b710`).

## Renderer

```typescript
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;   // see casting-threejs-shadows
```

(`tools/character-builder/src/map/3d/scene3d.ts:193@7c752159`)

- `antialias: false` — pixel art is nearest-sampled; antialiasing only blurs it.
- `setPixelRatio(min(dpr, 2))` — a dpr above 2 doubles fill rate for nothing.
- Shadows are **on**, but the shadow map is updated by hand. That is the single flag that keeps camera
  motion from re-rendering a 2048² depth pass every frame.

## Two update paths, and they must not be confused

| What changed | Call | Cost |
|---|---|---|
| the world — blocks, preview, highlight | `render(state)` | walks the map, syncs meshes, flags the shadow map |
| the camera — pan, zoom, turn | `requestDraw()` | one `renderer.render` |

`render(state)` ends in `requestDraw()`, so callers never draw directly
(`tools/character-builder/src/map/3d/scene3d.ts:614@7c752159`).

Getting this wrong has produced both possible failures in this file's history: everything going
through the world path made every mouse move rebuild the scene, and the zoom going through *neither*
path meant `zoom()` changed the projection matrix and nothing ever drew it — the screen only caught up
on the next pointer event. That second one is what "the zoom lags" actually was.

`syncBlocks` returns early when the map is the same object it saw last
(`tools/character-builder/src/map/3d/scene3d.ts:508@7c752159`). Test mode calls `render` 60 times a
second with an unchanged map; without the early return every frame would walk every RLE column and
re-flag the shadow map.

## One frame loop, and it stops on its own

Everything that animates — the damped zoom, the 280 ms turn — runs in a single `tick`
(`tools/character-builder/src/map/3d/scene3d.ts:277@7c752159`). Draw requests inside one frame collapse
into one draw. When nothing is animating and nothing is pending, **no rAF is scheduled at all**: the
editor is render-on-demand, not a game loop drawing a still map 60 times a second.

`tick` clamps its delta to 50 ms. Returning from a backgrounded tab otherwise delivers one enormous
delta and the damping jumps straight to its target, losing the motion it exists to produce.

The particle burst keeps its own short-lived rAF and renders through a `renderNow` handle registered
per scene in a `WeakMap` (`tools/character-builder/src/map/3d/scene3d.ts:930@7c752159`). It re-checks
that handle every frame, so a scene destroyed mid-burst aborts instead of drawing into a disposed
renderer.

## Light rig

One `DirectionalLight`, no ambient (`tools/character-builder/src/map/3d/scene3d.ts:203@7c752159`).
Every material in the scene is `Basic`, `Sprite`, `Line` or `Shadow` — nothing consumes lighting, so
the light exists only to cast shadows. Adding an ambient light here would change nothing on screen;
adding a *lit* material would silently reintroduce the double-shading this rig was built to avoid.
See `casting-threejs-shadows`.

## Camera

The orthographic camera comes from `createEditorCamera` in `controls3d.ts`. Its target, pan, zoom and
turn are the subject of `controlling-threejs-camera`. It is **not** added to the scene — nothing is
parented to it.

## Resize via ResizeObserver on the container

The canvas follows the editor panel, not the window
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:299@3073b710`):

```typescript
renderer.setSize(width, height, false);
resizeCamera(camera, width, height);
requestDraw();
```

The third `false` stops the renderer from overwriting the canvas CSS size — React styles own the
layout. `resizeCamera` rebuilds the frustum from the aspect and leaves `camera.zoom` alone; folding
zoom into the frustum here would reset the user's zoom on every panel resize.

## Teardown order

`destroy()` cancels the frame loop, unregisters the render context **before** disposing the renderer
(so an in-flight particle loop aborts instead of drawing into a dead context), removes the actor,
meshes, helpers and ground rig, disposes the per-block materials it owns, then the module caches, then
`scene.clear()`, `renderer.dispose()` and finally the canvas
(`tools/character-builder/src/map/3d/scene3d.ts:694@7c752159`). Without `renderer.dispose()` every
navigation leaks a WebGL context until the browser reclaims it.

Only materials of blocks with `hasSprite` are disposed — the procedural ones are shared across scenes
(`creating-threejs-cubes`).

## The half-cube offset

`BoxGeometry(1, 1, 1)` is centered at the origin, so a block's base sits at y − 0.5. Meshes are
positioned at `blockY + HALF_CUBE` (`tools/character-builder/src/map/3d/scene3d.ts:557@7c752159`),
and the raycaster must subtract it back — see `raycasting-threejs-blocks`.

## Types: `@types/three` is required

`three@0.185.1` ships no `.d.ts` files — the package's `package.json` has **no `types` field** and the
build contains only `build/three.module.js`, so `import * as THREE` fails typecheck without
`@types/three`. Both are caret ranges, not exact pins:
`"three": "^0.185.1"` and `"@types/three": "^0.185.3"`
(`tools/character-builder/package.json:27@fd1f9643`).

## What is not verified

No automated test exercises the 3D scene; the claims above rest on typechecking and on reading the
wiring. Context-leak counts were never measured, and the frame loop was never profiled.

## References

- `tools/character-builder/src/map/3d/scene3d.ts` — the scene implementation
- `tools/character-builder/src/map/3d/map-editor-3d.tsx` — the React wiring
- `controlling-threejs-camera` — camera and input
- `casting-threejs-shadows` — the light and the shadow-map discipline
- [Three.js WebGLRenderer docs](https://threejs.org/docs/#api/en/renderers/WebGLRenderer)
