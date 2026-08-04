---
name: mapping-sprites-onto-cubes
description: Carries how ONE isometric sprite covers the three visible faces of a 3D block in this editor - the exact corner-to-corner UV derived from the 2:1 projection, why UVs are written from vertex POSITIONS instead of the BoxGeometry defaults, the cube yaw that tracks the camera so the art never turns away, unlit materials so the baked shading is not shaded twice, and the silhouette match that picks the canonical view out of numbered candidates. Use whenever texturing a block, changing block art, adding a sprite source, debugging art that looks sheared, stretched, mirrored or missing on a cube face, or wondering why a block looks identical from every view - including Portuguese phrasings like "a sprite do bloco", "esticar a sprite nas tres faces", "a textura ficou torta", "o topo do cubo esta errado", "uma sprite so", "o bloco nao muda ao girar". Triggers on UV, BoxGeometry, sprite unica, losango, paralelogramo, faceAtPixel, silhueta, MeshBasicMaterial, alphaTest, view canonica.
metadata:
  type: knowledge
  verification_signal: cd packages/iso-core && node --test src/iso-cube-uv.test.ts && cd ../../tools/character-builder && npm run typecheck
---

# Mapping one sprite onto a cube's three faces

## When to use

Before touching block art, block materials, or anything that decides what a cube shows. This is the
contract between the 2D art the user drew and the 3D volume it lands on.

## The rule

**One sprite per block. The same sprite, stretched across the three visible faces.** Not one texture
per face, not four views, not a crop. The block's art is a single isometric sprite — the same image
a 2D isometric editor would blit into the cell — and the cube's UVs point each face at the region of
that sprite the face occupies in the projection.

## Why the mapping is exact rather than approximate

The camera is orthographic at yaw 45° and elevation 30°. At exactly 30°, one step along a ground axis
moves `cos 45°` right and `sin 30° · sin 45°` down on screen — a ratio of exactly **2:1**, which is
the projection the sprite was drawn in (`packages/iso-core/src/iso-cube.ts:14@4f12735c`). The 3D
camera *is* the sprite's projection.

Each cube face therefore projects to a parallelogram in the sprite — the top to the rhombus, the two
sides to the sheared quads — and a parallelogram is the affine image of a square. Corner-to-corner
mapping is exact across both triangles of the quad: no shearing, no seam on the quad diagonal.

The whole mapping is one formula, for all eight corners
(`packages/iso-core/src/iso-cube-uv.ts:93@dbbd4830`):

```text
x = anchorX + (cx − cz) · tileWidth/2
y = (cx + cz) · tileHeight/2 + (1 − cy) · cubeHeight
u = x / spriteWidth        v = 1 − y / spriteHeight
```

`cx, cy, cz` are the 0/1 corner bits of the unit cube in three.js axes. That is the iso-core
projection with two origin shifts, nothing more.

## Write UVs from POSITION, never from the default UV

`spriteGeometry` walks the 24 vertices and derives each UV from the vertex's local position
(`tools/character-builder/src/map/3d/cube3d.ts:97@51821ec4`). The previous implementation transformed
the `BoxGeometry` default UVs instead, which requires knowing the order three.js emits vertices per
face — a library-internal detail. A position is geometry and does not change between versions.

There is a payoff beyond robustness: the three vertices that share a corner — one per adjacent face —
get the **same** UV, because the three faces meet at a single sprite pixel. That coincidence is what
makes the drawn cube edges line up with the geometric ones.

## The old mapping was wrong in a specific, diagnosable way

It mapped each face to an axis-aligned rectangle: the top to rows `0..tileHeight`, the sides to the
left and right halves. But the top of the sprite is a **rhombus**, not a rectangle, and the sides are
**parallelograms with a vertical edge**, not half-rectangles. The symptom is art that is *almost*
right — sheared, with the transparent rhombus corners sampled onto the top face — which reads as bad
generation rather than as bad UVs. The test that pins this is "as laterais são paralelogramos de
aresta vertical, não retângulos".

## The cube yaw tracks the camera

`applyCubeYaw` sets every block mesh's `rotation.y` to `yaw − BASE_YAW`
(`tools/character-builder/src/map/3d/scene3d.ts:339@7c752159`). A cube is symmetric under 90° about
Y, so rotating it with the camera puts the volume back in the same world cell while keeping +X, +Y
and +Z facing the viewer in all four views. The hidden faces are never seen, so they get UVs from the
same formula (mirrored) rather than a branch.

It is **continuous**, not snapped in 90° steps: during the 280 ms turn the camera passes through 45°,
and a cube left at 0° would show its raw back face mid-turn.

Consequence, and it is intended: a block looks identical from all four views. That is the same rule
the rasterizer already states for procedural cubes — "a luz é presa à CÂMERA, não ao mundo"
(`packages/iso-core/src/cube-raster.ts:20@ab9f990c`).

`applyCubeYaw` also calls `updateMatrixWorld()` per mesh. The raycaster reads `matrixWorld` and does
not update it, so without that call a click landing between the turn and the next frame would use
the previous orientation and place the block in the wrong cell.

## Materials: unlit, alpha-tested, one per block

`MeshBasicMaterial`, not `MeshLambertMaterial` (`tools/character-builder/src/map/3d/cube3d.ts:290@51821ec4`).
Pixel art already has its shading baked — top light, right medium, left dark. Lighting it again
darkens the art twice and, worse, makes the same block change color when the camera turns, which
reads as a bug. Shadows still exist; they land on the floor (`casting-threejs-shadows`).

`alphaTest = 0.5` with `transparent: false` (`tools/character-builder/src/map/3d/cube3d.ts:67@51821ec4`).
Generated art does not always fill the silhouette; without the cutout those empty pixels render as a
black fringe. Alpha test keeps the cube in the opaque pass — no depth sorting, no blend cost.

One material covers all six faces. The faces differ by UV, not by material.

## Any sprite size, and the stretch is declared

`spriteGeometryFromImage(width, height)` derives the geometry from the image itself: `tileWidth` is
the width, `tileHeight` is half of it, `cubeHeight` is what is left
(`packages/iso-core/src/iso-cube-uv.ts:166@dbbd4830`). Art that is not the canonical 48×53 works;
art whose proportion is far from `cubeHeight = tileWidth·√6/4` appears stretched vertically, because
the cube stays cubic and the art accommodates. `spriteStretchError` quantifies it
(`packages/iso-core/src/iso-cube-uv.ts:194@dbbd4830`). An image with no vertical edge at all
(`height ≤ width/2`) returns `null` and falls back to the procedural cube — stretching a flat texture
over a volume it does not describe would mirror art onto the faces.

**Art that overflows the canonical silhouette gets trimmed.** The cube only has the silhouette; a
generated block with bumps sticking out above the rhombus loses them. This was measured by
re-projecting the textured cube in software and comparing against the source sprite.

## Picking the canonical view is measured, not assumed

Blocks written by `/rotate` store eight numbered views and declare
`frameKeying: "assumed-canonical-order"` in the manifest — nobody verified which index is the
three-face isometric view. Four of the eight are the corner-on view (two faces), and using one of
those as the sprite paints the block with art that does not describe the geometry.

`pickCanonicalSprite` scores each candidate's alpha against the silhouette that `faceAtPixel` defines
and takes the best (`tools/character-builder/src/map/3d/cube3d.ts:187@51821ec4`, scoring in
`packages/iso-core/src/iso-cube.ts:359@4f12735c`). Measured on this repository's art, **`view-7`
wins in five of six blocks** — the assumed order (`view-0` first) was wrong. The palette thumbnail
asks the same function, so thumb and cube can never disagree
(`tools/character-builder/src/map/3d/cube3d.ts:234@51821ec4`).

## The procedural block is not a special case

A block with no generated art gets the iso-core rasterizer's canonical 48×53 cube canvas and goes
through the exact same UV path (`tools/character-builder/src/map/3d/cube3d.ts:325@51821ec4`). One
code path for every block; only the origin of the image differs.

## What is not verified

- No automated test renders the scene. The UV math is proven by unit tests and by a software
  re-projection done by hand; what the GPU draws was never captured and diffed.
- `alphaTest = 0.5` and the trimming of overflowing art are visual judgments, not measurements.

## References

- `packages/iso-core/src/iso-cube-uv.ts` — the UV math, pure and tested
- `packages/iso-core/src/iso-cube.ts` — the canonical shape and `silhouetteMatch`
- `tools/character-builder/src/map/3d/cube3d.ts` — art, materials, geometry cache
- `creating-threejs-cubes` — the mesh-level contract this skill sits on top of
- `casting-threejs-shadows` — why the cube faces are unlit
- `projecting-isometric-geometry` — where the 2:1 projection comes from
