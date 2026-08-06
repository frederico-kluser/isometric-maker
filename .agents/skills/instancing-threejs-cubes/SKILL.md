---
name: instancing-threejs-cubes
description: Documenta como o editor desenha muitos cubos com poucos draw calls — um THREE.InstancedMesh por tipo de bloco, o mapa celula→indice de instancia, hidden-cell culling (celulas cercadas nos 6 lados nao sao instanciadas), a lista livre para reuso de slots, matrizes por instancia para o yaw do cubo, instanceColor para tingir celulas, e por que o picking abandonou o Raycaster (porque DDA precisa de MapData, nao de meshes). Use whenever adding, debugging or understanding the block rendering in the 3D editor, investigating a missing block, touching culling, the free list, capacity growth or per-instance color — including Portuguese phrasings like "o bloco sumiu", "por que tem tanto draw call", "como achar qual cubo cliquei", "a cor da celula nao muda". Triggers on InstancedMesh, setMatrixAt, instanceMatrix.needsUpdate, computeHiddenCells, block-instancing, hidden cell, free list.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npm run typecheck && npm test
---

# Instancing Three.js cubes in the 3D editor

## When to use

Before creating a mesh per cell, before touching the raycaster, when a block vanishes or a draw-call
count looks wrong, and whenever the map slows down after adding blocks.

## One `InstancedMesh` per block type, not per cell

`BlockInstancing` (`tools/character-builder/src/map/3d/block-instancing.ts:123@a7139cdb`) holds a
`Map<string, BlockState>`, one entry per `blockId`. Each `BlockState` wraps a single
`THREE.InstancedMesh` that draws every cell of that type in one GPU call.

The alternative -- one `THREE.Mesh` per cell -- creates hundreds of draw calls, one per cube. With
`InstancedMesh`, a map of 10,000 cells across 12 block types costs 12 draw calls for the cubes.

`createBlockState` (`tools/character-builder/src/map/3d/block-instancing.ts:439@a7139cdb`) constructs
the `InstancedMesh` with the geometry and material from the block's `CubeArt`, sets `castShadow =
true` and `receiveShadow = false`, and stores per-instance `CellData` in `mesh.userData.cells` so
the raycaster can map an instance index back to a map coordinate without depending on the instancing
manager.

## The cell-to-instance map and the free list

Two data structures track which instance slot belongs to which cell:

- **`cellMap`** (`Map<string, {blockId, index}>`): key `"x:z:y"` to instance index. O(1) lookup for
  whether a cell already has a mesh.
- **`freeList`** (`number[]`): released slot indices available for reuse. When a cell is removed,
  its slot goes onto the free list; the next `setCell` call pops from it before scanning for an
  empty slot.

`allocateSlot` (`tools/character-builder/src/map/3d/block-instancing.ts:461@a7139cdb`) checks the
free list first, then scans for an empty entry, and only grows the buffer when both are exhausted.

When a slot is released, the instance matrix is scaled to zero so the GPU skips it
(`tools/character-builder/src/map/3d/block-instancing.ts:244-248@a7139cdb`). `InstancedMesh.count`
tracks the highest occupied index plus one -- it is the allocated maximum, not the active count. A
free list entry below `count` does not reduce the draw call; it only means that slot is skipped by
the zero-scale matrix.

## Growable capacity

When the free list is empty and no empty slot exists within the current capacity, `growState`
(`tools/character-builder/src/map/3d/block-instancing.ts:475@a7139cdb`) doubles the buffer. It:

1. Creates a new `InstancedMesh` with doubled capacity, sharing the same geometry and material.
2. Copies all active matrices from the old mesh to the new one.
3. Copies `instanceColor` if it exists.
4. Copies the `userData.cells` array for the raycaster.
5. Removes the old mesh from the scene, adds the new one, and disposes only the old mesh wrapper
   (geometry and material are shared and not disposed).

The initial capacity is 1024 (`tools/character-builder/src/map/3d/block-instancing.ts:33@a7139cdb`).
Most maps never trigger a grow operation because they are well under that threshold per block type.

## Hidden-cell culling

`computeHiddenCells` (`tools/character-builder/src/map/3d/block-instancing.ts:78@a7139cdb`) is a
pre-pass that runs before creating any instance. It builds a `Set<string>` of all occupied cells,
then marks as hidden any cell whose six axis-aligned neighbours are also occupied. A cell surrounded
on all six sides can never be seen from any camera angle.

This pre-pass is called from `syncBlocks`
(`tools/character-builder/src/map/3d/scene3d.ts:586@7389adc7`) before the main loop that creates
instances. It MUST run before instancing and MUST be recomputed when adjacent cells change -- adding
a block next to a previously-visible cell can turn it into an interior cell, and removing a
neighbour can expose one that was hidden.

The trade: for small maps, the culling pass costs more CPU than it saves in GPU. For a massive cube
of solid blocks, it eliminates the vast majority of instances.

## Per-instance matrix for cube yaw

`setInstanceMatrix` (`tools/character-builder/src/map/3d/block-instancing.ts:534@a7139cdb`) composes
a world matrix per instance: translation to the cell's position in world space (with the half-cube
offset so the base sits on the integer grid), rotation around the Y axis for the cube's yaw, and
unit scale. After calling `mesh.setMatrixAt(index, matrix)`, **`mesh.instanceMatrix.needsUpdate =
true` is mandatory** -- without it the GPU never sees the change.

`applyYaw` (`tools/character-builder/src/map/3d/block-instancing.ts:329@a7139cdb`) rotates every
active instance to match the camera's yaw. The cubes are symmetric under 90-degree rotation in Y, so
this keeps the three visible faces always facing the camera without swapping textures. This is
called from `applyCubeYaw` in `scene3d.ts`
(`tools/character-builder/src/map/3d/scene3d.ts:412@7389adc7`), which accounts for the `BASE_YAW`
offset so cubes appear at the correct angle when the camera is at 0 degrees.

## `instanceColor` for cell tinting

`setCellColor` (`tools/character-builder/src/map/3d/block-instancing.ts:356@a7139cdb`) creates
`instanceColor` on demand (a `Float32Array` of `capacity * 3` filled with `1.0`, which is the
multiplicative identity for white). The color multiplies with the base material -- setting a red
instance color tints that cell red while the underlying sprite texture remains visible.

When a cell's color is cleared and no other cell of that block type has a custom color, the entire
`instanceColor` attribute is removed from the `InstancedMesh`, reverting to the base material with
zero overhead.

## The shadow quad per cube is NOT instanced

Each cell gets a separate `ShadowMaterial` quad (`createCubeShadowQuad` in
`tools/character-builder/src/map/3d/cube3d.ts:136@f6d616aa`) anchored just above the top face
(`SHADOW_QUAD_EPS = 0.001` at `tools/character-builder/src/map/3d/cube3d.ts:118@f6d616aa`). These
quads live in a separate `shadowGroup`
(`tools/character-builder/src/map/3d/block-instancing.ts:125@a7139cdb`) and are not instanced
because each needs its own world-space position to sample the shadow map correctly.

When a cell is removed (`removeCell` at
`tools/character-builder/src/map/3d/block-instancing.ts:226@a7139cdb`), its shadow quad must be
removed from the group explicitly. Geometry and material are shared across all shadow quads (one
`PlaneGeometry` and one `ShadowMaterial` cached in `cube3d.ts`) -- only the mesh wrapper is
per-cell.

## Why picking left the Raycaster

The raycaster approach (`raycasting-threejs-blocks`) fires a ray into the list of `InstancedMesh`
objects and returns the instance index. That gives a cell coordinate but does not answer the map
editor's real question: "which cell is the NEXT empty space in the direction the user is pointing?"
DDA (Digital Differential Analyzer) on `MapData` answers that directly by stepping through the grid,
which is why picking moved to a DDA-based approach on the map data store.

`blockMeshes()` (`tools/character-builder/src/map/3d/scene3d.ts:797@7389adc7`) and its
implementation (`getAllMeshes` at
`tools/character-builder/src/map/3d/block-instancing.ts:392@a7139cdb`) still expose the
`InstancedMesh` list for any code that needs to raycast against the visible geometry -- but the
editor's primary picking path no longer uses it.

## What is not verified

- No automated test renders an `InstancedMesh`. The instancing logic is tested indirectly through
  the `syncBlocks` path (integration tests that verify cell counts and visibility).
- The grow threshold (1024 initial, double-on-exhaust) was chosen by estimate, not measured against
  a real map profile.
- The hidden-cell culling assumes axis-aligned neighbours -- diagonal occlusion is not considered.

## References

- `tools/character-builder/src/map/3d/block-instancing.ts` -- the BlockInstancing class and all its methods
- `tools/character-builder/src/map/3d/scene3d.ts` -- syncBlocks, applyCubeYaw, setPalette, destroy
- `tools/character-builder/src/map/3d/cube3d.ts` -- createCubeShadowQuad, shared shadow geometry/material
- `creating-threejs-cubes` -- how each block's CubeArt (geometry + material) is produced
- `casting-threejs-shadows` -- the shadow rig that the quads sample from
- `raycasting-threejs-blocks` -- the Raycaster approach and why DDA replaced it for picking
- `mapping-sprites-onto-cubes` -- how the UV mapping places the sprite on the cube faces

<evolution></evolution>
