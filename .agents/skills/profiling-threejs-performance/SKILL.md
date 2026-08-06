---
name: profiling-threejs-performance
description: Ensina como medir desempenho do Three.js neste codebase — renderer.info como o unico numero honesto (nao FPS, que o render-on-demand torna inutil), draw calls vs contagem de objetos, como o laco unico coalesce e para quando nada anima (ADR 0040), o que InstancedMesh e hidden-cell culling fazem ao orcamento de draw calls, e os dois numeros que importam: render.calls e render.triangles. Use whenever investigating slowness in the 3D editor or runtime, suspecting a performance regression, adding new geometry, or seeing an FPS number — including Portuguese phrasings like "o editor esta lento", "o zoom esta travando", "a ultima mudanca deixou lento", "muitos blocos no mapa", "quantos draw calls", "por que o FPS caiu", "desempenho do render", "medir GPU". Triggers on renderer.info, render.calls, FPS, draw call, performance, profiling, shadowMap.autoUpdate, needsUpdate, zoom, travando, regressão, muitos blocos.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npm run typecheck && npm test
---

# Profiling Three.js performance

## When to use

Before trusting an FPS number, before adding geometry to the scene, when the editor feels slow and
you need to know why, and whenever a performance discussion mentions "frames per second".

## FPS is meaningless here: the editor is render-on-demand

The editor stops its animation loop when nothing is animating. ADR 0040
(`docs/adr/0040-zoom-continuo-e-desenho-sob-demanda.md` point 4@5706fe27) declares: "sem nada
animando e nada pendente, nenhum rAF e agendado". This is not a game running at 60 fps -- it is a
tool that draws only when the map, the camera, or an animation changes.

The tick loop (`tools/character-builder/src/map/3d/scene3d.ts:318@7389adc7`) checks four
conditions: zoom amortecimento still converging, a camera turn in progress, a block animation
advancing, and a pending draw request. If none are true, `schedule()` is not called and the loop
stops.

The `schedule` guard (`tools/character-builder/src/map/3d/scene3d.ts:307@7389adc7`) ensures only
one `requestAnimationFrame` is ever in flight: if `frameId` is already non-null, the call is a
no-op. Multiple calls to `requestDraw` in the same frame set `drawPending = true` once, and the next
tick draws exactly once.

Because of this, Chrome's "FPS Meter" extension shows 0 fps when the editor is idle -- which is
correct behaviour, not a bug. A tool that measures frames-per-second is measuring the wrong thing
for an application that deliberately skips frames.

## The two numbers that matter: `render.calls` and `render.triangles`

`renderer.info.render` is a `WebGLInfo` object that Three.js populates after every `render()` call.
It is the only honest number in the codebase because it is measured by the GPU driver, not estimated
from JavaScript object counts.

- **`render.calls`**: the number of draw calls in the most recent frame. One `InstancedMesh` = one
  draw call, regardless of instance count. One `Sprite` = one draw call. One shadow map pass = one
  additional draw call per caster.
- **`render.triangles`**: total triangle count across all draw calls.

The runtime's `updateFps` function (`tools/runtime/src/render.ts:523@2fe553f3`) reads
`renderer.info.render.calls` once per second and logs it alongside the FPS counter. The value is
reset per frame by the renderer; if you call `renderer.info.reset()` yourself, the accumulated
count since boot is lost.

With the instanced mesh, the runtime's `updateFps` documentation says the draw-call count hovers
around 3 (cubes, shadow catcher, character) for any map size. If it grows with the map, the
instancing has broken.

## What `InstancedMesh` does to the draw-call budget

Without instancing, a map of `N` cells costs `N` draw calls for the cubes alone. With
`InstancedMesh`, a map of `N` cells across `B` block types costs `B` draw calls. The key insight
from `block-instancing.ts`: one `InstancedMesh` per `blockId`, not one per cell
(`tools/character-builder/src/map/3d/block-instancing.ts:123@a7139cdb`).

The runtime goes further: it uses a single `InstancedMesh` for all blocks, with
`instanceColor` carrying the per-cell tint (`tools/runtime/src/render.ts:262-280@2fe553f3`). That
is one draw call for the entire map, regardless of block type count.

## What hidden-cell culling does

`computeHiddenCells` (`tools/character-builder/src/map/3d/block-instancing.ts:78@a7139cdb`)
eliminates cells that are completely surrounded on all six sides. For a solid 10x10x10 cube (1000
cells), only the surface cells survive -- roughly 488 cells instead of 1000. The trade: the culling
pass itself costs CPU (two passes over all map cells, set lookups for six neighbours each). For
small sparse maps, the culling overhead can dominate the savings it provides.

The runtime has its own version: `isHidden` (`tools/runtime/src/render.ts:214@2fe553f3`) performs
the same six-neighbour check, called from `drawMap` before building the instance array.

## The shadow map doubles the draw calls (when it runs)

Every draw of the shadow map is one depth pass for every `castShadow` mesh, followed by one color
pass for the scene. With `renderer.shadowMap.autoUpdate = false`
(`tools/character-builder/src/map/3d/scene3d.ts:209@7389adc7`), the depth pass only runs when the
map changes -- not when the camera pans, zooms, or rotates. This is what makes zoom continuous: the
2048x2048 depth render is skipped on every frame where only the camera moved.

`needsUpdate` is a one shot flag consumed by the renderer after one frame. Setting it is a request,
not a mode. `syncBlocks` sets it only when the map actually changed
(`tools/character-builder/src/map/3d/scene3d.ts:682@7389adc7`). Any code that changes what casts a
shadow (adding or removing blocks, swapping materials, resizing the frustum) must set it again.

## Draw calls vs object count: they diverge

It is easy to read `scene.children.length` and think that is the draw-call count. It is not:

- Each `InstancedMesh` is one `Object3D` in the scene but draws `count` instances in one GPU call.
- Materials are the real multiplier: each unique material forces a separate draw call.
  `InstancedMesh` shares one material across all instances of the same block type -- that is the
  entire point.
- Shadow quads are separate meshes in a separate group, and each is a draw call. The shadow group
  can hold thousands of quads.

## How to profile a suspicious frame

```typescript
// Before the draw you want to measure:
renderer.info.reset();

// Draw:
renderer.render(scene, camera);

// Read:
console.log('draw calls:', renderer.info.render.calls);
console.log('triangles:', renderer.info.render.triangles);
```

The call to `reset()` is essential: without it, `render.calls` accumulates since boot and you are
reading a lifetime total, not the frame you care about. The Three.js renderer calls `reset()` itself
at the start of each `render()`, so reading immediately after a draw gives you that frame's numbers.
But if you read after multiple draws without resetting, the value is the sum of all of them.

## What is not verified

- No automated performance baseline exists in this repository. Nao ha baseline de desempenho neste repositorio.
  ADR 0040
  (`docs/adr/0040-zoom-continuo-e-desenho-sob-demanda.md`@5706fe27) explicitly notes this: "Nao ha
  baseline de desempenho neste repositorio, e esta ADR nao cria um."
- The 2048x2048 shadow map size was never profiled against 1024x1024.
- The hidden-cell culling CPU cost vs GPU savings trade-off was never measured for different map
  sizes and densities.
- The `INSTANCE_SLACK` of 1.25 in the runtime (`tools/runtime/src/render.ts:112@2fe553f3`) is a
  heuristic -- no profile guided it.

## References

- `docs/adr/0040-zoom-continuo-e-desenho-sob-demanda.md` -- the render-on-demand architecture
- `tools/character-builder/src/map/3d/scene3d.ts` -- tick loop, drawNow, schedule, requestDraw, shadowMap discipline
- `tools/character-builder/src/map/3d/block-instancing.ts` -- InstancedMesh management, computeHiddenCells
- `tools/runtime/src/render.ts` -- updateFps, drawMap, isHidden, the single InstancedMesh approach
- `instancing-threejs-cubes` -- the InstancedMesh system this skill profiles
- `casting-threejs-shadows` -- the shadow rig and autoUpdate discipline
- [Three.js WebGLInfo docs](https://threejs.org/docs/#api/en/renderers/WebGLInfo)

<evolution></evolution>
