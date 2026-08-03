---
name: bootstrapping-threejs-scene
description: Carries how this editor boots its Three.js scene inside a React component - the WebGLRenderer created once against a React-owned canvas, the light rig, the orthographic camera, render-on-demand instead of a continuous loop, ResizeObserver for the panel, and the teardown order that keeps WebGL contexts from leaking. Use whenever creating or wiring the 3D viewport, adding lights or camera, handling resize, or tearing the scene down - including Portuguese phrasings like "criar a cena 3d", "montar o viewport 3d", "a cena 3d nao aparece", "adicionar luz na cena", "redimensionar o canvas 3d", "fechar a aba vaza memoria", "limpar a cena ao sair". Triggers on WebGLRenderer, OrthographicCamera, render loop, ResizeObserver, scene bootstrap, cena 3d, viewport 3d, createIsoScene3D.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck --target es2023 --lib es2023,dom,dom.iterable --module esnext --moduleResolution bundler --allowImportingTsExtensions --jsx react-jsx src/map/3d/scene3d.ts src/map/3d/controls3d.ts src/map/3d/cube3d.ts src/map/3d/pick3d-raycaster.ts src/map/3d/grid3d.ts
---

# Bootstrapping the Three.js scene

## When to use

Before writing the 3D viewport entry point, before adding anything that draws, before wiring resize
or teardown, and before deciding where the scene object lives relative to React.

## The scene is a side effect, not a component

The canvas is a React element; the scene is not. No Three.js node passes through reconciliation: the
scene is created once in a `useEffect` against the React-owned canvas and then updated by imperative
calls. `map-editor-3d.tsx` creates it in one effect
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:153-176@e80414d9`) and destroys it in that same
effect's cleanup (`tools/character-builder/src/map/3d/map-editor-3d.tsx:171-175@e80414d9`).

## Renderer

```typescript
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(BG_COLOR);
```

(`tools/character-builder/src/map/3d/scene3d.ts:131-137@dddf5555`)

- `antialias: false` — pixel art is nearest-sampled; antialiasing only blurs it.
- `setPixelRatio(Math.min(dpr, 2))` — dpr above 2 doubles the fill rate for nothing.
- shadows stay off: `shadowMap.enabled = false` (`tools/character-builder/src/map/3d/scene3d.ts:138@dddf5555`).

## Light rig

One `AmbientLight` at 0.6 plus one `DirectionalLight` at 0.8 positioned at (10, 20, 5)
(`tools/character-builder/src/map/3d/scene3d.ts:144-149@dddf5555`). This is the whole shading model —
Lambert cube faces are lit by it (see `creating-threejs-cubes`).

## Camera

The orthographic camera comes from `createEditorCamera` in `controls3d.ts`, created with the canvas
size and added to the scene once (`tools/character-builder/src/map/3d/scene3d.ts:152-155@dddf5555`).
Its geometry, pan, zoom and rotation are the subject of `controlling-threejs-camera`.

## Render on demand — there is no loop

The editor draws only when state changed. `renderer.render(scene, camera)` runs at the end of
`render(state)` (`tools/character-builder/src/map/3d/scene3d.ts:284@dddf5555`), and the React side
calls `render` once per state change (`tools/character-builder/src/map/3d/map-editor-3d.tsx:203-221@e80414d9`).
A continuous `requestAnimationFrame` would spend GPU drawing identical frames; the only self-driven
animation is the camera rotation tween, which starts and stops its own frames
(`tools/character-builder/src/map/3d/scene3d.ts:306-351@dddf5555`).

## Resize via ResizeObserver on the container

The canvas follows the editor panel, not the window. A `ResizeObserver` on the host element calls
`resize(w, h)` (`tools/character-builder/src/map/3d/map-editor-3d.tsx:196-201@e80414d9`). Inside
`resize`:

```typescript
renderer.setSize(width, height, false);
const aspect = width / height;
camera.left = -frustumSize * aspect;
camera.right = frustumSize * aspect;
camera.updateProjectionMatrix();
```

(`tools/character-builder/src/map/3d/scene3d.ts:354-364@dddf5555`)

The third `false` argument stops the renderer from overwriting the canvas CSS size — React styles
own the layout.

## Teardown order

`destroy()` runs: cancel any running rotation animation, `renderer.dispose()`, remove the block
meshes and dispose the cube caches, `scene.clear()`, then remove the canvas from the DOM
(`tools/character-builder/src/map/3d/scene3d.ts:367-381@dddf5555`). The React cleanup calls
`destroy()` on unmount (`tools/character-builder/src/map/3d/map-editor-3d.tsx:171-175@e80414d9`). Without `renderer.dispose()` every navigation
leaks a WebGL context until the browser reclaims it.

## Types: `@types/three` is required

`three@0.185.1` ships no `.d.ts` files — the package's `package.json` has no `types` field and the
build contains only `build/three.module.js`, so `import * as THREE` fails typecheck without
`@types/three`. Both are caret ranges, not exact pins:
`"three": "^0.185.1"` (`tools/character-builder/package.json:27@3264b988`) and
`"@types/three": "^0.185.3"` (`tools/character-builder/package.json:34@3264b988`).

## The half-cube offset

`BoxGeometry(1, 1, 1)` is centered at the origin, so a block's base sits at y − 0.5. Meshes are
positioned at `y + HALF_CUBE` (`tools/character-builder/src/map/3d/scene3d.ts:95-96@dddf5555`), and
the raycaster must subtract it back — see `raycasting-threejs-blocks`.

## What is not verified

No automated test exercises the 3D scene; the claims above rest on typechecking the modules and
reading the wiring in `map-editor-3d.tsx`. Context-leak counts were never measured.

## References

- `tools/character-builder/src/map/3d/scene3d.ts` — the scene implementation
- `tools/character-builder/src/map/3d/map-editor-3d.tsx` — the React wiring
- `tools/character-builder/src/map/3d/controls3d.ts` — camera and controls (`controlling-threejs-camera`)
- [Three.js WebGLRenderer docs](https://threejs.org/docs/#api/en/renderers/WebGLRenderer)
