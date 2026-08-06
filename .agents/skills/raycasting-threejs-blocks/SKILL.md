---
name: raycasting-threejs-blocks
description: Carries how mouse clicks become block placements in this editor - NDC conversion with the inverted Y, Raycaster intersection against the block meshes, the face normal turned into the adjacent cell, the invisible ground plane that catches clicks over empty space, and the map/Three.js coordinate mapping with the half-cube offset. Use whenever picking the 3D block under the cursor, placing or removing blocks with the mouse, or fixing a placement that lands in the wrong cell - including Portuguese phrasings like "clicar no bloco para colocar outro", "remover bloco com o mouse", "colocar bloco no chao vazio", "o bloco assenta no lugar errado", "pegar a face que o mouse tocou", "empilhar bloco no topo da coluna". Triggers on Raycaster, intersectObjects, face normal, NDC, ground plane, Minecraft, picking, colocar bloco, remover bloco.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck --target es2023 --lib es2023,dom,dom.iterable --module esnext --moduleResolution bundler --allowImportingTsExtensions --jsx react-jsx src/map/3d/scene3d.ts src/map/3d/controls3d.ts src/map/3d/cube3d.ts src/map/3d/pick3d-raycaster.ts src/map/3d/grid3d.ts
---

# Picking blocks with DDA voxel raycasting

## When to use

Before converting a mouse position into a map cell in the 3D view, before changing how placement
decides the destination cell, and before touching the ground plane that makes empty space clickable.

## The canonical flow (DDA, not Raycaster)

```
1. mouse (clientX, clientY) → NDC via getBoundingClientRect
2. raycaster.setFromCamera(ndc, camera) — only to get the ray origin/direction
3. Convert ray to map coordinates: world (X,Y,Z) → map (x, y, z)
4. ddaRaycast(origin, direction, isOccupied, maxDistance) — walks RLE directly
5. First hit: hit.cell = the occupied cell, hit.normal = face normal (map coords)
6. adjacent cell = hit cell + normal
```

Implemented as `pick3d` in `tools/character-builder/src/map/3d/pick3d-raycaster.ts:197-280`.
The DDA engine lives in `packages/iso-core/src/dda-raycast.ts:65-210@39ca9f0a` — no Three.js
dependency, no meshes needed.

## Why DDA replaced Three.js Raycaster

After `BlockInstancing`, the map blocks are drawn by `InstancedMesh` — one mesh per block
type, not one mesh per cell. DDA walks the actual `MapData` RLE columns, so it always sees
every block regardless of whether a mesh exists for it, and it's immune to matrix staleness
because it reads data, not transforms.

The contract (`{hit, placement, hitFace}`) and `pickColumnTop` are preserved unchanged —
the editor tools (`map-editor-3d.tsx`) receive the same result shape and don't know which
picking engine produced it.

## Mouse → NDC: the Y inversion is mandatory

NDC has Y up; the DOM has Y down — the Y term is negated:

```typescript
const rect = canvas.getBoundingClientRect();
return new THREE.Vector2(
  ((clientX - rect.left) / rect.width) * 2 - 1,
  -((clientY - rect.top) / rect.height) * 2 + 1,
);
```

(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:71-80`)

The `setFromCamera` call is still needed to obtain the ray, but the ray is then
converted to map coordinates and handed to DDA — no `intersectObjects` is called.

## Face normal comes from the DDA step direction

The DDA tracks which axis the ray last crossed to enter the current cell
(`packages/iso-core/src/dda-raycast.ts:134-135`). The face normal is the
**negation** of that step direction: entering a cell by stepping +X means the
ray hit the -X face. This is computed in
`packages/iso-core/src/dda-raycast.ts:153-156` and returned as `hit.normal`.

In map coordinates: `normal.z === 1` means the ray entered from above → hit the
top face. Any other Z value, or a lateral axis → side face
(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:233`).

## The adjacent cell

The placement cell is simply `hit cell + normal` in map coordinates, not world space
(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:236-240`). DDA operates in map
(integer) coordinates — no half-cube offset math, no Three.js world-space transforms.

## Coordinate mapping

The map is (x, y, z) with z = height; Three.js is (X, Y, Z) with Y = height:

```
map → three:  position(x, z, y)
three → map:  worldToMap: { x: point.x, y: point.z, z: point.y }
```

(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:89-91`)

The `isOccupied` callback queries the `MapData` RLE columns directly by walking
the runs for a given column key (`tools/character-builder/src/map/3d/pick3d-raycaster.ts:127-142`).
This means `getBlockAt` and `isOccupied` decode RLE on every DDA step — a few dozen
string splits per ray, not a bottleneck.

## Empty space: ray-plane intersection with z=0

When the DDA finds no block, the ray is tested against the z=0 plane (map coords)
(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:247-276`). Only rays pointing
downward (`direction.z < 0`) can hit the ground. The intersection point is rounded
to the nearest cell, and the result carries `hitFace: 'ground'`.

The old `findGroundPlane` + `PlaneGeometry` mechanism is still in the code but no
longer used for picking — the ground is a mathematical plane, not a mesh.

## hitFace: the stacking contract

Every result carries `hitFace` — `'top'`, `'side'`, `'ground'` or `null`
(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:55`). A top hit places on top of
the column (`pickColumnTop`, `tools/character-builder/src/map/3d/pick3d-raycaster.ts:291-308`);
a side hit places on the adjacent cell at the same level — the Minecraft behavior.

## Traps of the OLD approach (Raycaster)

These no longer apply because DDA replaced the raycaster, but they are preserved so
nobody re-architects back into them:

1. **`intersectObjects` needs a mutable array.** Its signature takes `Object3D[]`, not
   `readonly Object3D[]`.
2. **Edges and corners.** On an exact edge the raycaster may report either adjacent
   face's normal.
3. **Block meshes rotate with the camera.** `face.normal` is local and must be
   transformed by `matrixWorld` — skipping it silently places blocks on the wrong side.
4. **The mesh list is maintained, not discovered.** Traversing the scene graph on every
   pointer move is expensive.
5. **InstancedMesh instanceId.** The raycaster reports `instanceId` on `InstancedMesh`
   hits; you must map that back to a cell position via the `userData.cells` array on
   the InstancedMesh.
6. **Hidden cells are not in the InstancedMesh.** Cells fully surrounded on 6 sides are
   culled and never instantiated — the Raycaster can't pick them, and that's correct.

## Traps of the NEW approach (DDA)

1. **RLE decoding per step.** The DDA calls `isOccupied` for every cell visited. This
   decodes the RLE runs each time. For a typical ray (< 20 steps), this is fine. For
   a long ray at a flat angle, it can visit 100+ cells. The safety limit is set to
   10000 steps (`packages/iso-core/src/dda-raycast.ts:130`).
2. **Direction near zero on an axis.** The DDA uses `Math.abs(1/dir)` for delta-t;
   a direction component of exactly zero gives `Infinity`, which is correct but the
   `stepX`/`stepY`/`stepZ` must also be zero for that axis.
3. **Origin inside a block.** The DDA skips the starting cell if it's occupied — but
   only on the first iteration. This handles the edge case where the camera is
   somehow inside a block.
4. **Precision at long distances.** The `t` accumulation (floating-point addition) can
   drift at extreme distances. The `maxDistance` guard limits this, and the grid is
   finite (max 200 world units).
5. **Ground plane intersection only works with downward rays.** If the user looks
   straight down from above, the ray direction's Z is near zero or positive, and the
   ground plane test fails — the result is `{hit: null, placement: {0,0,0}, hitFace: null}`.
   In normal isometric viewing angles this never triggers.
6. **`Math.floor` for cell index.** The DDA uses `Math.floor` for cell coordinates.
   For negative coordinates, `Math.floor(-0.5) === -1` which is correct for the
   Amanatides-Woo algorithm (cells extend from `floor(x)` to `floor(x)+1`).

## What is not verified

- No automated test verifies picking against a rendered scene. The DDA algorithm is
  tested in `packages/iso-core/src/dda-raycast.test.ts`; the editor wiring is
  verified by typecheck, not by integration test.

## References

- `packages/iso-core/src/dda-raycast.ts` — the Amanatides-Woo DDA engine
- `tools/character-builder/src/map/3d/pick3d-raycaster.ts` — the editor-side DDA wiring
- `tools/character-builder/src/map/3d/scene3d.ts` — `blockMeshes()` for the InstancedMesh list
- `tools/character-builder/src/map/3d/block-instancing.ts` — `userData.cells` for instanceId mapping
- Amanatides, J., Woo, A. "A Fast Voxel Traversal Algorithm for Ray Tracing." Eurographics '87.
