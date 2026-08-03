---
name: raycasting-threejs-blocks
description: Carries how mouse clicks become block placements in this editor - NDC conversion with the inverted Y, Raycaster intersection against the block meshes, the face normal turned into the adjacent cell, the invisible ground plane that catches clicks over empty space, and the map/Three.js coordinate mapping with the half-cube offset. Use whenever picking the 3D block under the cursor, placing or removing blocks with the mouse, or fixing a placement that lands in the wrong cell - including Portuguese phrasings like "clicar no bloco para colocar outro", "remover bloco com o mouse", "colocar bloco no chao vazio", "o bloco assenta no lugar errado", "pegar a face que o mouse tocou", "empilhar bloco no topo da coluna". Triggers on Raycaster, intersectObjects, face normal, NDC, ground plane, Minecraft, picking, colocar bloco, remover bloco.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck --target es2023 --lib es2023,dom,dom.iterable --module esnext --moduleResolution bundler --allowImportingTsExtensions --jsx react-jsx src/map/3d/scene3d.ts src/map/3d/controls3d.ts src/map/3d/cube3d.ts src/map/3d/pick3d-raycaster.ts src/map/3d/grid3d.ts
---

# Raycasting Three.js blocks (Minecraft-style placement)

## When to use

Before converting a mouse position into a map cell in the 3D view, before changing how placement
decides the destination cell, and before touching the ground plane that makes empty space clickable.

## The canonical flow

```
1. mouse (clientX, clientY) → NDC via getBoundingClientRect
2. raycaster.setFromCamera(ndc, camera)
3. raycaster.intersectObjects(blockMeshes, false) — sorted by distance
4. first hit: hit.object = the mesh, hit.face.normal = the face normal (local space)
5. adjacent cell = block position + rounded world-space normal
```

Implemented as `pick3d` (`tools/character-builder/src/map/3d/pick3d-raycaster.ts:108-157@7382effa`).

## Mouse → NDC: the Y inversion is mandatory

NDC has Y up; the DOM has Y down — the Y term is negated:

```typescript
const rect = canvas.getBoundingClientRect();
return new THREE.Vector2(
  ((clientX - rect.left) / rect.width) * 2 - 1,
  -((clientY - rect.top) / rect.height) * 2 + 1,
);
```

(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:53-63@7382effa`)

## face.normal is local; transform it to world

`hit.face.normal` is in the geometry's local space. For unrotated cubes local equals world, but the
code still calls `transformDirection(mesh.matrixWorld)` — idempotent here, load-bearing the day a
mesh has a rotation (`tools/character-builder/src/map/3d/pick3d-raycaster.ts:128-130@7382effa`). The
normal is then rounded to a cardinal direction (0, ±1, 0) (`tools/character-builder/src/map/3d/pick3d-raycaster.ts:133-137@7382effa`).

## The adjacent cell and the half-cube offset

Meshes are positioned at `y + 0.5` (see `bootstrapping-threejs-scene`), so the cell of the hit block
subtracts the centering offset back:

```typescript
z: Math.round(blockPos.y - 0.5),
```

(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:139-144@7382effa`)

The placement cell is the block position plus the direction, with the same offset
(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:151-155@7382effa`).

## Coordinate mapping

The map is (x, y, z) with z = height; Three.js is (X, Y, Z) with Y = height:

```
map → three:  position(x, z, y)
three → map:  x = round(pos.x),  y = round(pos.z),  z = round(pos.y)
```

(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:75-81@7382effa` and
`tools/character-builder/src/map/3d/pick3d-raycaster.ts:86-89@7382effa`)

## Empty space: the invisible ground plane

When the ray misses every block, it is tested against an invisible plane on the floor — `visible:
false` but still raycastable, `DoubleSide`, rotated flat at y − 0.01, named `ground-plane`
(`tools/character-builder/src/map/3d/grid3d.ts:85-97@df615bbb`). The hit point rounds to a cell with
z = 0 (`tools/character-builder/src/map/3d/pick3d-raycaster.ts:160-173@7382effa`). The plane is found
by name via `findGroundPlane` (`tools/character-builder/src/map/3d/scene3d.ts:473-481@dddf5555`).

## hitFace: the stacking contract

Every result carries `hitFace` — `'top'`, `'side'`, `'ground'` or `null`
(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:42@7382effa`). A top hit places on top of
the column (`pickColumnTop`, `tools/character-builder/src/map/3d/pick3d-raycaster.ts:188-206@7382effa`); a side hit places on the
adjacent cell at the same level — the Minecraft behavior.

## Traps

1. **`intersectObjects` needs a mutable array.** Its signature takes `Object3D[]`, not
   `readonly Object3D[]`; passing the readonly mesh list requires `as unknown as THREE.Object3D[]`
   (`tools/character-builder/src/map/3d/pick3d-raycaster.ts:120@7382effa`).
2. **Edges and corners.** On an exact edge the raycaster may report either adjacent face's normal;
   the result is deterministic but not intuitive, and the rounding to cardinal directions absorbs
   it. This is behavior of three's raycaster, not verified against every edge case in this
   codebase.
3. **DoubleSide flips normals.** A `DoubleSide` block material can report an inward normal. Blocks
   keep the `FrontSide` default; only the invisible ground plane is `DoubleSide`, deliberately, so
   it stays raycastable from both sides (`tools/character-builder/src/map/3d/grid3d.ts:87-89@df615bbb`).
4. **Preview must not write depth.** The placement preview uses `depthWrite: false` so it cannot
   block the next frame's raycast (`tools/character-builder/src/map/3d/cube3d.ts:485-498@49482c8a`).

## What is not verified

The ground plane resizes to follow the map bounds
(`tools/character-builder/src/map/3d/grid3d.ts:102-121@df615bbb`); whether it ever fails to cover
clicks at extreme zoom was not measured.

## References

- `tools/character-builder/src/map/3d/pick3d-raycaster.ts` — the picking implementation
- `tools/character-builder/src/map/3d/grid3d.ts` — grid and ground plane
- `tools/character-builder/src/map/3d/scene3d.ts` — `findGroundPlane` and mesh placement
- [Three.js Raycaster docs](https://threejs.org/docs/#api/en/core/Raycaster)
