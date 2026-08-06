---
name: animating-threejs-sprites
description: Documenta o contrato de atlas de dois arquivos exportado pelo pixellab-pipeline e consumido pelo runtime — o formato TexturePacker JSON Hash, a ordem canonica das 8 direcoes, a ancora medida (nao assumida), quadros como texture.repeat/texture.offset sobre uma unica imagem compartilhada, como o runtime clona a textura da folha com repeat/offset por quadro, a inversao de V, NearestFilter obrigatorio, e como blobs/personagens carregam e aparecem no jogo exportado. Use whenever loading sprites in the Three.js runtime, debugging upside-down or blurred art, understanding the contract between the pipeline and the runtime, or touching the atlas exporter — including Portuguese phrasings like "o sprite esta borrado", "a ancora esta errada", "a direcao do personagem nao bate", "atlas json". Triggers on TexturePacker, atlas, sprite sheet, loadAtlas, repeat, offset, NearestFilter, V inversion, anchor, direction order, spritesheet.
metadata:
  type: knowledge
  verification_signal: cd tools/pixellab-pipeline && npm run typecheck && npm test
---

# Animating Three.js sprites from the PixelLab atlas

## When to use

Before writing sprite-loading code in the runtime, when a sprite appears upside-down or blurred,
when the anchor point looks wrong, and whenever the contract between `pixellab-pipeline` (the
exporter) and `tools/runtime` (the consumer) changes.

## The two-file atlas contract

The pipeline exports two files per creature or object family
(`tools/pixellab-pipeline/src/atlas.ts`@615de6e5):

| File | Format | Contents |
|---|---|---|
| `<name>.json` | TexturePacker JSON Hash | Frame rectangles, sprite source sizes, anchor per frame |
| `<name>.pixellab.json` | Sidecar (project-specific) | FPS per animation, anchor source (measured vs default), provenance, spec hashes |

The `.json` is strictly TexturePacker JSON Hash format. O formato TexturePacker JSON Hash was NEVER PixiJS-specific — é um formato aberto
usado por dezenas de engines; tratá-lo como "formato do PixiJS" leva a usar o
parser errado e perder metadados que o TexturePacker escreve mas o PixiJS ignora.
It was NEVER specific to any renderer,
despite the historical type names `AtlasFrame` and `AtlasSheet` (formerly `PixiFrame` and
`PixiSpritesheet` before the [ADR 0047](../../docs/adr/0047-renderizador-unico-threejs.md)
rename) in the exporter (`tools/pixellab-pipeline/src/atlas.ts:49,58@615de6e5`). The runtime
loads this JSON directly and parses it into `THREE.Texture` objects without any 2D renderer
dependency.

The sidecar `.pixellab.json` carries game semantics (FPS, anchor metadata) that do not belong in the
TexturePacker JSON. The exporter's own comment warns: "O .json ao lado e estritamente formato
TexturePacker. Semantica de jogo (fps, hitbox, ancora logica) vive aqui, para nao brigar com o parser"
(`tools/pixellab-pipeline/src/atlas.ts:397-398@615de6e5`).

## How the runtime loads the atlas: one texture, many frames

Each frame in the atlas is NOT a separate image. The sheet is one PNG, loaded once. Each frame is a
clone of the sheet's `THREE.Texture` with different `repeat` and `offset` values -- the clone shares
the GPU texture; only the viewport into it changes.

The runtime's `createCharacterRender` (`tools/runtime/src/render.ts:366@2fe553f3`) calls
`loadAtlas(sheetUrl)`, which returns a `LoadedAtlas` with:

- `animations`: `Map<string, THREE.Texture[]>` -- animation name to array of frame textures.
- `aspect`: `number` -- the sprite's width/height ratio for scaling.
- `frames`: `Map<string, THREE.Texture>` -- flat lookup of all frames by name.

Each `THREE.Texture` in the arrays is a clone of the sheet texture. The clone's `repeat` is set to
`1 / frameCount` horizontally and `1` vertically, and its `offset` is set to `frameIndex /
frameCount` horizontally and `0` vertically. This makes each clone sample exactly one frame's
rectangle from the sheet.

## V is inverted: TexturePacker uses top-left origin

TexturePacker measures coordinates from the top-left corner of the sheet. Three.js UV space has its
origin at the bottom-left. The runtime accounts for this when setting `sprite.center`
(`tools/runtime/src/render.ts:389@2fe553f3`):

```typescript
sprite.center.set(sidecar.anchor.x, 1 - sidecar.anchor.y);
```

The `1 -` flips the Y component. Without it, the sprite's anchor is upside-down relative to the
texture and the character's feet hover above the ground plane.

The anchor in the sidecar is a fraction of the frame canvas (0 to 1). The exporter measures it from
the rest frame (direction S, frame 00) by scanning the opaque bounding box
(`tools/pixellab-pipeline/src/atlas.ts:206-247@615de6e5`). The measurement returns the horizontal
centre of the bounding box and its bottom edge as fractions of the canvas. This is marked
`anchorSource: 'medida'` (measured) rather than `'padrao'` (the hardcoded `{x: 0.5, y: 0.875}`
fallback).

## `NearestFilter` is mandatory for pixel art

The exporter's `PIXI_CLIENT_SNIPPET` (`tools/pixellab-pipeline/src/atlas.ts:411-423@615de6e5`) shows
the required texture settings for pixel art. The same constraint applies to Three.js:

- `magFilter = THREE.NearestFilter` -- no interpolation when magnifying.
- `minFilter = THREE.NearestFilter` -- no interpolation when minifying.
- `generateMipmaps = false` -- mipmaps blend between levels, which blurs pixel art.

With `LinearFilter` (the Three.js default), the sprite appears blurred at any scale. The runtime
sets these on each frame texture during `loadAtlas`.

## The canonical direction order

The eight directions follow the `/generate-8-rotations-v2` return order, declared in
`tools/pixellab-pipeline/src/endpoints.ts:49-58@7e700048`:

```
S, SW, W, NW, N, NE, E, SE
```

This is clockwise from south. The runtime uses the same order in its direction labels
(`tools/runtime/src/render.ts:483@2fe553f3`):

```typescript
const DIRECTION_LABELS = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
```

The `facingToDirection` function (`tools/runtime/src/render.ts:485@2fe553f3`) maps a world-space
angle (in radians) to one of these eight labels by dividing the circle into eight 45-degree sectors.

This is the order `/rotate` returns its frames in, NOT the order `view-0` through `view-7` labels
might suggest. The `shortDir` function in the exporter
(`tools/pixellab-pipeline/src/atlas.ts:94-100@615de6e5`) maps the long direction names to these
same single-letter codes.

## Frame switching at runtime

The runtime switches frames by reassigning `SpriteMaterial.map`
(`tools/runtime/src/render.ts:459@2fe553f3`):

```typescript
const tex = char.currentFrames[char.frameIndex % Math.max(1, total)];
const material = char.sprite.material as THREE.SpriteMaterial;
if (tex && material.map !== tex) {
  material.map = tex;
  material.needsUpdate = true;
}
```

The comparison `material.map !== tex` is an early exit: if the frame has not changed (a 1-frame
animation or the same frame repeating), the material is not touched. `needsUpdate = true` tells
Three.js to re-upload the texture reference to the GPU.

The animation clock is independent of the render loop: `updateCharacterAnim`
(`tools/runtime/src/render.ts:418@2fe553f3`) advances frames based on wall-clock time and the FPS
declared in the sidecar (default 8). It is NOT tied to requestAnimationFrame -- if the monitor
refreshes at 144 Hz, the animation does not run at 144 fps.

## The animation naming convention

Frame names follow the pattern `<family>_<action>_<DIR>_<NN>`, produced by `frameName`
(`tools/pixellab-pipeline/src/atlas.ts:88-92@615de6e5`). Animation names group frames by
`<family>_<action>_<DIR>` (e.g. `lobo_walk_S`).

The runtime does not know the family name -- it only knows `<action>_<DIR>`. The `findAnimation`
function (`tools/runtime/src/render.ts:471-481@2fe553f3`) searches for an animation whose name ends
with the requested suffix, bridging the gap without the runtime needing to know the creature's name.

## The exporter's deterministic grid

`packGrid` (`tools/pixellab-pipeline/src/atlas.ts:261@615de6e5`) packs frames in a uniform grid,
not maxrects. This is deliberate: character frames are all the same size, a grid is deterministic,
the PNG is byte-stable across runs, and `postHash` can cache the atlas. `sortFrames`
(`tools/pixellab-pipeline/src/atlas.ts:103-117@615de6e5`) orders frames by direction then by frame
index, ensuring the PNG does not change when the input list is shuffled.

The sheet size is rounded up to a multiple of 4 (`align4` at
`tools/pixellab-pipeline/src/atlas.ts:311@615de6e5`) for row-stride alignment, not to a power of
two. Both WebGL2 and WebGPU handle non-power-of-two textures, and pixel art never uses mipmaps, so
POT would waste up to 72% of the texture.

## What is not verified

- `runtime/src/atlas.ts` (the `loadAtlas` implementation) does not yet exist as a separate file in
  this branch. Its contract is described here from how `createCharacterRender` consumes it and from
  the exporter's output format. The file is expected to parse the TexturePacker JSON, create one
  shared `THREE.Texture` from the sheet PNG, and produce per-frame clones with `repeat`/`offset`.
- The `NearestFilter` constraint is documented in the exporter's snippet but there is no automated
  test that verifies the runtime sets it.
- The V-inversion for the anchor is visible in the code but has not been visually verified across
  all creatures.

## References

- `tools/pixellab-pipeline/src/atlas.ts` -- the exporter: packGrid, AtlasSheet, measureAnchor, sortFrames
- `tools/pixellab-pipeline/src/endpoints.ts` -- DIRECTIONS_8, Direction8, the canonical direction order
- `tools/runtime/src/render.ts` -- createCharacterRender, updateCharacterAnim, frame switching, direction labels
- `tools/runtime/src/load.ts` -- loadRuntimeProject, the sidecar resolution
- `animating-pixellab-sprites` -- the PixelLab API for generating the frames that end up in this atlas
- `generating-pixellab-characters` -- producing the character whose sprites are packed here
- [TexturePacker JSON Hash format](https://www.codeandweb.com/texturepacker/documentation) -- the format the `.json` conforms to

<evolution></evolution>
