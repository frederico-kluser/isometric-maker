---
name: creating-threejs-cubes
description: Carries how block meshes are built in this editor - the six BoxGeometry material groups in cubemap order and when that order stops mattering, the single unlit material every cube now uses, nearest-filtered sRGB textures without mipmaps, the shared geometry cached per sprite proportion, the cube yaw that follows the camera, and the preview and highlight helpers created once instead of per frame. Use whenever creating a block mesh, changing materials or geometry, adding a helper cube, or fixing a cube that renders black, blank or in the wrong place - including Portuguese phrasings like "criar cubo 3d", "o cubo fica preto", "material do cubo", "textura em cada face do cubo", "geometria compartilhada", "cubo de preview", "contorno de selecao". Triggers on BoxGeometry, material array, MeshBasicMaterial, CanvasTexture, NearestFilter, EdgesGeometry, cubo 3d, textura face, preview, highlight.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck --target es2023 --lib es2023,dom,dom.iterable --module esnext --moduleResolution bundler --allowImportingTsExtensions --jsx react-jsx src/map/3d/scene3d.ts src/map/3d/controls3d.ts src/map/3d/cube3d.ts src/map/3d/pick3d-raycaster.ts src/map/3d/grid3d.ts
---

# Creating Three.js block meshes

## When to use

Before creating a block mesh or changing its material or geometry. What the mesh *shows* — the sprite,
its UVs, the canonical view — belongs to `mapping-sprites-onto-cubes`; this skill is the mesh itself.

## One material, six faces

A cube mesh takes a **single** `MeshBasicMaterial`, not an array of six
(`tools/character-builder/src/map/3d/cube3d.ts:290@51821ec4`). The faces differ by UV, not by
material: one sprite is stretched across the three visible faces, so there is nothing left for a
per-face material to carry.

`MeshBasicMaterial` is deliberate — the art already has shading baked in, and lighting it again both
darkens it twice and makes the same block change colour when the camera turns. The reasoning and its
shadow consequence live in `mapping-sprites-onto-cubes` and `casting-threejs-shadows`.

## The face order still exists, and still bites

`BoxGeometry` creates six material groups in cubemap order. Nothing indexes them today, but the order
is what the UV writer walks and what any future per-face material would use:

| Index | Face | Axis |
|---|---|---|
| 0 | right | +X |
| 1 | left | −X |
| 2 | top | +Y |
| 3 | bottom | −Y |
| 4 | front | +Z |
| 5 | back | −Z |

The three faces that ever face the camera are **+X, +Y and +Z**, because the mesh yaw tracks the
camera (`tools/character-builder/src/map/3d/scene3d.ts:339@7c752159`). The other three are never
drawn.

## The cube DOES rotate with the camera

This reverses the earlier rule. The mesh used to be static, with the sprite's faces pinned to +X/+Y/+Z
— which meant three of the four views showed untextured faces. Now `applyCubeYaw` turns every block
mesh with the camera; a cube is symmetric under 90° about Y, so the volume lands back in the same
cell. `blockFaceToBoxGroup`, the dead helper that rotated the *mapping* instead, is gone.

## Textures: nearest, sRGB, no mipmaps, clamped

Every texture — loaded PNG or procedural canvas — goes through one configurator
(`tools/character-builder/src/map/3d/cube3d.ts:123@51821ec4`): `NearestFilter` on min and mag,
`generateMipmaps = false`, `colorSpace = SRGBColorSpace`, `ClampToEdgeWrapping`. Pixel art must not be
smoothed, and 48×53 is not a power of two — under WebGL2 that is fine, but only with clamped wrapping
and no mipmaps.

`alphaTest = 0.5` with `transparent: false` keeps the cube in the opaque pass. Generated art does not
always fill the silhouette, and without the cutout those pixels render as a black fringe.

## Geometry is cached by sprite proportion, not per block

One `BoxGeometry` per distinct sprite size, keyed `width×height`
(`tools/character-builder/src/map/3d/cube3d.ts:97@51821ec4`). The UVs depend only on the proportion,
so every block whose art is 48×53 shares one geometry object. A mesh owns neither its geometry nor its
material; both come from module caches, and `disposeCubeCache` is what frees them.

The procedural cube (a block with no generated art) is cached by hue and shares one material across
blocks and scenes (`tools/character-builder/src/map/3d/cube3d.ts:325@51821ec4`). That is why the
scene disposes only the materials of blocks with `hasSprite`: disposing a shared procedural material
would blank every other block using that hue.

## Preview and highlight: built once, moved after

Both helpers are created a single time by the scene and then repositioned and toggled
(`tools/character-builder/src/map/3d/scene3d.ts:591@7c752159`). Recreating them per frame allocated a
material and recomputed an `EdgesGeometry` on every mouse move, on the main thread. The edges are now
computed once and shared (`tools/character-builder/src/map/3d/cube3d.ts:402@51821ec4`).

`depthWrite: false` on the preview is load-bearing: writing depth would make the preview occlude the
next frame's raycast against the very cube it is previewing.

## Draw calls and InstancedMesh

Under ~100 cubes with distinct materials, individual meshes are fine. Beyond that, the answer is
`BlockInstancing` (`tools/character-builder/src/map/3d/block-instancing.ts`) — one `InstancedMesh`
per block type, drawing every cell of that type in a single draw call.

`BlockInstancing` is the active renderer for map blocks. `createCubeMesh` still exists and is used
for non-map cases: the placement preview, the selection highlight, and particle effects. The two
paths coexist:
- **Map blocks** → `BlockInstancing.setCell()` — instanced, shared geometry/material, hidden-cell culling
- **Helpers** → `createCubeMesh()` — individual mesh, repositioned each frame

The instancing layer also handles:
- **Per-instance color** via `instanceColor` (lazy-allocated, multiplicative with base material)
- **Hidden cell culling** — cells fully surrounded on 6 sides are never instanced (`computeHiddenCells`)
- **Free list** — slots are reused when blocks are removed, avoiding memory growth
- **Shadow quads** — placed in a separate `THREE.Group` in world space, non-instanced (one per visible cell)

The shadow quad is now part of cube mesh creation: `createCubeMesh()` adds one as a child
(`tools/character-builder/src/map/3d/cube3d.ts:563-565`), and `BlockInstancing.setCell()` creates
one in the shadow group (`tools/character-builder/src/map/3d/block-instancing.ts:211-213`).

## What is not verified

- No automated test renders a cube. The claims rest on typechecking and on reading the wiring.
- The draw-call threshold and `alphaTest = 0.5` are judgment, not measurement.
- The InstancedMesh capacity doubling (INITIAL_CAPACITY = 1024) was chosen to cover a 32×32 map
  of a single block type — not profiled at scale.

## References

- `tools/character-builder/src/map/3d/cube3d.ts` — the cube factory
- `tools/character-builder/src/map/3d/block-instancing.ts` — the InstancedMesh renderer
- `tools/character-builder/src/map/3d/cube-canvas.ts` — the isometric cube rasterizer
- `packages/iso-core/src/iso-cube.ts` — the canonical cube geometry
- `mapping-sprites-onto-cubes` — what the mesh shows, and why
- `casting-threejs-shadows` — why the material is unlit, and how cube-to-cube shadows work
- [Three.js BoxGeometry docs](https://threejs.org/docs/#api/en/geometries/BoxGeometry)
- [Three.js InstancedMesh docs](https://threejs.org/docs/#api/en/objects/InstancedMesh)
