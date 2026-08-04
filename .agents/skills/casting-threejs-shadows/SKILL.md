---
name: casting-threejs-shadows
description: Carries how the 3D editor draws shadows - one directional light that exists only to cast, a ShadowMaterial catcher plane that draws the shadow without depending on light photometry, why cube faces deliberately do not receive shadow, the shadow-map frustum that follows the map bounds, and the autoUpdate=false rule that keeps camera motion from re-rendering a 2048 depth pass. Use whenever adding, tuning, debugging or removing shadows in the 3D map editor, changing the light rig, seeing shadow acne or a shadow cut off at the map edge, or wondering why moving the camera got slow - including Portuguese phrasings like "a sombra sumiu", "sombra cortada na borda", "a sombra esta muito forte", "listras na sombra", "adicionar luz", "por que o zoom trava". Triggers on shadowMap, autoUpdate, needsUpdate, ShadowMaterial, DirectionalLight, castShadow, receiveShadow, shadow bias, acne, sombra.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npm run typecheck && npm test
---

# Casting shadows in the 3D editor

## When to use

Before adding a light, before turning on `receiveShadow` anywhere, and whenever a shadow looks wrong
or the editor gets sluggish while the camera moves.

## The rig is one light, and it does not light anything

There is a single `DirectionalLight`, and its job is to **cast**, not to illuminate
(`tools/character-builder/src/map/3d/scene3d.ts:203@7c752159`). Every material in the scene is
`MeshBasic`, `Sprite`, `Line` or `Shadow` — all of which ignore lighting. There is no `AmbientLight`,
because there is nothing for it to brighten.

That is not an oversight, it is the consequence of the art rule: block faces carry baked pixel-art
shading and must not be shaded a second time (`mapping-sprites-onto-cubes`).

## The shadow is drawn by a material, not by a light level

The floor rig has a dedicated `ShadowMaterial` plane, the *catcher*
(`tools/character-builder/src/map/3d/grid3d.ts:123@477d8c0f`). `ShadowMaterial` renders **only** the
shadow: fully transparent where light reaches, `color` at `opacity` where it does not. So
`SHADOW_OPACITY` **is** the darkening (`tools/character-builder/src/map/3d/grid3d.ts:55@477d8c0f`).

The alternative — a `MeshStandardMaterial` floor with `receiveShadow` — ties shadow strength to light
photometry: change an intensity and the shadow changes with it, and the right constants can only be
found by trial on screen. Decoupling them is what lets the rest of the scene stay unlit.

## Cubes cast, cubes do not receive — and that is a trade, stated

`createCubeMesh` sets `castShadow = true` and `receiveShadow = false`
(`tools/character-builder/src/map/3d/cube3d.ts:354@51821ec4`). Receiving a shadow requires a lit
material, and a lit material changes the art. The trade was made in favour of the art.

The arithmetic behind it, because it is not a tuning problem: for the three visible faces to keep
identical brightness under a Lambert term, the light must satisfy `N·L` equal for +X, +Y and +Z —
which forces `L ∝ (1,1,1)`, i.e. a light directly behind the viewer. A light behind the viewer casts
every shadow **behind** its caster, where the caster hides it. Uniform illumination and visible
shadows are mutually exclusive; there is no intensity that buys both.

**What is lost:** a tall structure's shadow stops at the floor and does not darken blocks it falls
across. **The documented way back**, if it is ever wanted: give each cube a `ShadowMaterial` quad
sitting just above its top face — the same decoupling trick, at the price of one extra draw per cube.

## The light is fixed in the world, and that is what makes zoom free

The sun's direction never rotates with the camera (`SUN_OFFSET` is a constant). Since nothing is lit,
turning the camera changes no shading at all — only which side of the cast shadows the viewer sees,
which is what a real scene does.

That is what makes the following safe:

```typescript
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true; // only when the MAP changes
```

(`tools/character-builder/src/map/3d/scene3d.ts:193@7c752159`.) With `autoUpdate` on, every single
draw re-renders a 2048×2048 depth pass — including every frame of a zoom, a pan and a turn. The flag
is set back to `true` only inside `syncBlocks`, and only when something actually changed
(`tools/character-builder/src/map/3d/scene3d.ts:508@7c752159`).

**The trap:** `needsUpdate` is consumed by the renderer after one frame. Setting it is a one-shot
request, not a mode. Anything that changes what casts — blocks added or removed, a repaint, the
palette swapping materials, the frustum resizing — has to set it again.

## The shadow frustum follows the map, with padding

`sizeShadowFrustum` sizes the light's orthographic shadow camera to the ground rig and moves both the
light and its target to the map centre (`tools/character-builder/src/map/3d/scene3d.ts:837@7c752159`).
Two things there are easy to get wrong:

- **Padding of 60% + 2.** The map seen along the light direction is wider than its axis-aligned
  footprint — a square seen diagonally has a ~1.4× diagonal. Without padding the shadow is clipped at
  the map edge.
- **`sun.target.updateMatrixWorld()`.** The target is an `Object3D` whose world matrix is not
  refreshed by anything else here; without the explicit call the shadow camera keeps aiming at the
  origin and a map that grew away from it loses its shadow entirely. The target is also added to the
  scene for the same reason.

## Bias: two knobs, two different artefacts

`shadow.bias = -0.0006` pushes the depth comparison away from the receiving surface — it removes
**acne**, the self-shadowing stripes on a caster. `shadow.normalBias = 0.02` offsets along the normal
and removes **peter-panning at grazing angles**. Too much of either detaches the shadow from its
caster. Both values are visual choices and were never measured.

## What is not verified

- No automated test renders a shadow. Everything above rests on typechecking and on reading the
  wiring.
- `SHADOW_OPACITY`, the bias pair and the 2048² map size are judgment, not measurement. The map size
  was never profiled against 1024².

## References

- `tools/character-builder/src/map/3d/grid3d.ts` — the four ground planes and the catcher
- `tools/character-builder/src/map/3d/scene3d.ts` — light, frustum, `needsUpdate` discipline
- `mapping-sprites-onto-cubes` — why the cubes are unlit
- `bootstrapping-threejs-scene` — where the rig is created
- [Three.js WebGLShadowMap docs](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.shadowMap)
