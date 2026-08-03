---
name: creating-threejs-cubes
description: Carries how block cubes are built in this editor - the six BoxGeometry material groups in cubemap order, the material-array contract for per-face texture or solid color, nearest-filtered textures with sRGB color space, the procedural canvas fallback from the cube rasterizer, the shared unit geometry, and why the cube meshes never rotate even when the camera does. Use whenever creating or texturing 3D blocks, mapping sprite art onto a cube face, or fixing a cube that looks wrong - including Portuguese phrasings like "criar cubo 3d", "textura em cada face do cubo", "o cubo fica preto", "textura esticada na face", "rotacionar a textura junto com a camera", "por que o topo do cubo esta escuro". Triggers on BoxGeometry, material array, MeshLambertMaterial, CanvasTexture, NearestFilter, cubo 3d, textura face.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck --target es2023 --lib es2023,dom,dom.iterable --module esnext --moduleResolution bundler --allowImportingTsExtensions --jsx react-jsx src/map/3d/scene3d.ts src/map/3d/controls3d.ts src/map/3d/cube3d.ts src/map/3d/pick3d-raycaster.ts src/map/3d/grid3d.ts
---

# Creating Three.js cubes with per-face materials

## When to use

Before creating a block mesh, before mapping art onto a cube, and before changing the material
setup — face-order mistakes here put art on the wrong side of the block.

## The face order contract

`BoxGeometry` creates six material groups, one per face, in cubemap order — the array index IS the
face:

| Index | Face | Axis |
|---|---|---|
| 0 | right | +X |
| 1 | left | −X |
| 2 | top | +Y |
| 3 | bottom | −Y |
| 4 | front | +Z |
| 5 | back | −Z |

This order is fixed in the geometry and encoded once in `BOX_GROUP`
(`tools/character-builder/src/map/3d/cube3d.ts:89-96@49482c8a`).

## Material array — the contract

A mesh gets six `MeshLambertMaterial`s in that order; the index decides which face the material
covers (`tools/character-builder/src/map/3d/cube3d.ts:444-458@49482c8a`). Lambert, not Standard:
the microfacet BRDF of `MeshStandardMaterial` buys nothing on flat 1×1×1 blocks under one ambient
and one directional light, and it costs more per fragment (`tools/character-builder/src/map/3d/cube3d.ts:341-368@49482c8a` uses Lambert
throughout).

Every material is a draw call. Under ~100 cubes that is fine; beyond that, merge into
`InstancedMesh` with an atlas — not done here, and not needed for the current maps.

## Textures: nearest filter, sRGB, no mipmaps

Pixel art must not be smoothed. Every texture — loaded or procedural — is configured with
`NearestFilter` for min and mag, `generateMipmaps = false`, and `colorSpace = SRGBColorSpace`
(`tools/character-builder/src/map/3d/cube3d.ts:139-158@49482c8a` for loaded textures,
`tools/character-builder/src/map/3d/cube3d.ts:54-61@49482c8a` for canvas textures).

## Procedural fallback: canvas → texture

Blocks without art get solid HSL colors, and their cube faces come from the cube rasterizer in
`src/map/3d/cube-canvas.ts` — `makeCubeCanvasFromHue` and `makeCubeViewsFromHue`
(`tools/character-builder/src/map/3d/cube-canvas.ts:67@171c2e2e`, `tools/character-builder/src/map/3d/cube-canvas.ts:83@171c2e2e`)
— rasterized with the canonical 48px geometry from iso-core
(`packages/iso-core/src/iso-cube.ts:222@2ad14e9b`). The rasterizer lives in the character-builder,
not in iso-core; iso-core owns only the geometry math.

## Shared geometry

One `BoxGeometry(1, 1, 1)` is shared by every cube mesh — each mesh allocates only its six materials
(`tools/character-builder/src/map/3d/cube3d.ts:44@49482c8a`,
`tools/character-builder/src/map/3d/cube3d.ts:468-473@49482c8a`).

## The texture-rotation trap

The cube mesh does NOT rotate when the camera rotates — only the camera orbits (`setCameraRotation`,
see `controlling-threejs-camera`). The "north" sprite's three faces (top, left, right after dewarp)
are pinned to +X, +Z and +Y, and the −X, −Z, −Y faces get solid color
(`tools/character-builder/src/map/3d/cube3d.ts:341-368@49482c8a`). Rotating the textures to follow
the camera was tried and removed: it swaps art as if the MESH turned, and because the mesh is static
it ends up showing the wrong face. The `rotation` parameter remains on the signature but is ignored
(`tools/character-builder/src/map/3d/cube3d.ts:346@49482c8a`). A leftover `blockFaceToBoxGroup` still rotates the mapping, but nothing
calls it — it is dead code (`tools/character-builder/src/map/3d/cube3d.ts:112-122@49482c8a`).

## Preview and highlight

The placement preview is a semi-transparent box with `depthTest: true` and `depthWrite: false` — it
must not write depth, or it would shadow the raycast in the next frame
(`tools/character-builder/src/map/3d/cube3d.ts:485-498@49482c8a`). The selection outline is
`EdgesGeometry` plus `LineSegments` (`tools/character-builder/src/map/3d/cube3d.ts:507-519@49482c8a`).

## What is not verified

The "under 100 cubes" draw-call threshold is a rule of thumb, not a measurement. Whether
`InstancedMesh` is ever needed has not been decided.

## References

- `tools/character-builder/src/map/3d/cube3d.ts` — the cube factory
- `tools/character-builder/src/map/3d/cube-canvas.ts` — the isometric cube rasterizer
- `packages/iso-core/src/iso-cube.ts` — the canonical cube geometry
- [Three.js BoxGeometry docs](https://threejs.org/docs/#api/en/geometries/BoxGeometry)
