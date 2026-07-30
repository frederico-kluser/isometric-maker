---
name: animating-pixi-sprites
description: Carries how this editor turns PixelLab output into drawn characters - the two-file atlas contract, the canonical eight-direction frame order, the anchor that has to be measured rather than assumed, the frame rate that lives outside the Pixi JSON, and why equipment layering is a silhouette problem before it is a rendering one. Use whenever loading an atlas, playing a character or creature animation, picking an anchor, setting frame rate, or drawing equipment on a body - including Portuguese phrasings like "carregar o atlas", "animar o personagem", "trocar de direcao", "o sprite anda de lado", "quantos quadros por segundo", "vestir o equipamento", "camada de roupa", "a ancora esta errada", "o sprite treme". Triggers on atlas, spritesheet, frame, direcao, paper-doll, silhueta, ancora, extrusao, sidecar, template.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Animating sprites in this editor

## When to use

Before loading an atlas, before naming a frame, before deciding where a sprite's origin sits, and
before designing anything that draws equipment on a body.

For the API itself — `Assets`, `Spritesheet`, `AnimatedSprite`, `Texture` — read
`tools/pixi-reference/vendor/skills/pixijs-scene-sprite/SKILL.md` and `pixijs-assets` (which has
twelve reference documents, including one on spritesheets). This skill does not restate them.

## Injected knowledge

### The atlas is two files, and the split is load-bearing

The pipeline emits, per family (`tools/pixellab-pipeline/src/atlas.ts:4-9@a8bede59`):

| File | What it is |
|---|---|
| `<name>.json` | strictly TexturePacker JSON Hash — **the only thing Pixi parses** |
| `<name>.pixellab.json` | our sidecar: frame rate, logical anchor, provenance |

> "Never extend the Pixi JSON with game semantics. The parser owns that shape and a future major
> version will fight you for it." — `tools/pixellab-pipeline/src/atlas.ts:8-9@a8bede59`

So **frame rate is not in the atlas Pixi reads**. It is in the sidecar, and the client must load both.
Getting the animation speed from anywhere else means guessing.

### Frame names encode direction, and the order is not the spec's order

Canonical name: `<family>_<action>_<DIR>_<NN>`, direction as the short uppercase code
(`tools/pixellab-pipeline/src/atlas.ts:81-90@a8bede59`).

The project's canonical direction order is the one `DIRECTIONS_8` fixes
(`tools/pixellab-pipeline/src/endpoints.ts:45-48@b6e61f99`):

```
S, SW, W, NW, N, NE, E, SE
```

Three orderings coexist inside the PixelLab spec: the shared direction enum starts at north, and the
8-direction character endpoint documents itself as clockwise from south, which is the **mirror** of
the order above. So frames must be read **by direction name, never by index** — get it wrong and
there is no error at all, east and west simply swap and the character walks sideways
(`docs/adr/0015-low-top-down-8-direcoes-isometrico.md:46-52@0a0dfd33`). The spec-side detail belongs
to `querying-pixellab-api`; here it matters because the packer's frame names are what carry it. If a
sprite faces the wrong way, suspect the frame naming before suspecting the input code.

Frames are packed direction-major, frame-minor, so the PNG stays byte-stable and regeneration
produces an empty git diff (`tools/pixellab-pipeline/src/atlas.ts:100-101@a8bede59`).

### The anchor is at the feet — and the constant that puts it there is now wrong

The origin has to be the feet. A character's position means "which cell it stands on", and that is
what the isometric grid and the depth sort mean too — `sx = (x-y)*32`, `sy = (x+y)*16 - z*16`
(`docs/adr/0013-geometria-isometrica-64x32-z16.md:8@e194895c`). Centring a sprite instead makes
everything drift by half a body as sprite heights vary.

**What the packer does today:** a fixed `{ x: 0.5, y: 0.875 }`, written into every frame of the atlas
JSON (`tools/pixellab-pipeline/src/atlas.ts:216@a8bede59`).

**Pending change, not yet implemented.** A fixed fraction lands on the feet only if the sprite fills
the canvas the same way in every frame, and it does not: the 8-direction endpoint warns that the
canvas comes back roughly 40% larger to make room for animations, so asking for 64 px yields about
90 (`docs/adr/0015-low-top-down-8-direcoes-isometrico.md:58@0a0dfd33`). On an inflated canvas
`y: 0.875` misses by around 11 px, and one level of Z is 16 px — nearly a whole level of vertical
displacement. The anchor therefore becomes **measured on the opaque bounding box of the union of all
frames in the family** rather than assumed
(`docs/adr/0013-geometria-isometrica-64x32-z16.md:42@e194895c`). The union, not per frame: measuring
each frame separately would make the sprite bob as the silhouette changes.

Until the packer implements that, treat the anchor in the atlas as an approximation. A character that
sits one step too high or too low on a stacked block is this constant, not the map data.

### Pixel-perfect is five things, and two of them are the client's

Three are done in the pipeline — no resampling ever, 1px extrusion for sprites and 2px for tiles plus
a transparent gutter, deterministic frame order. Two are the client's, and skipping either wastes the
other three (`tools/pixellab-pipeline/src/atlas.ts:11-16@a8bede59`):

1. `scaleMode` `'nearest'`, mipmaps off.
2. Render at logical resolution, then **one** integer nearest upscale.

The pipeline ships the client half as copyable code
(`tools/pixellab-pipeline/src/atlas.ts:329-341@a8bede59`). Its shape, verified against the vendored
8.19.0 surface:

```ts
// Before ANY Assets.load — the global default covers the common case.
TextureSource.defaultOptions.scaleMode = 'nearest';
TextureSource.defaultOptions.autoGenerateMipmaps = false;

const sheet = await Assets.load('atlas/creatures/lobo-esfomeado.json');
// And explicitly on the sheet, in case something preloaded with the old default.
sheet.textureSource.style.scaleMode = 'nearest';

const sprite = new AnimatedSprite(sheet.animations['lobo_walk_S']);
sprite.animationSpeed = 8 / 60; // sidecar fps over 60
```

`animationSpeed` is a multiplier on the ticker, not a frame rate — hence the division. The `8` comes
from the sidecar, never from memory.

### Do not disable premultiplied alpha

Pixi 8 premultiplies on upload and that is correct. The classic dark halo comes from *filtering*
between an opaque pixel and a transparent one whose RGB is black; with nearest sampling, extrusion
and integer transforms there is no interpolation, so it cannot appear
(`tools/pixellab-pipeline/src/atlas.ts:17-23@a8bede59`). The pipeline's alpha-bleed pass is
belt-and-braces for the case where a filter or a tint sneaks in anyway.

### The atlas has a hard ceiling and no multipack

Pages are capped at 2048×2048, which is the safe limit on integrated and mobile GPUs
(`tools/pixellab-pipeline/src/atlas.ts:43@a8bede59`). Sizing is tight NPOT rather than power-of-two,
because Pixi 8 requires WebGL2 or WebGPU and pixel art never uses mipmaps; POT would waste up to 72%
of the texture (`tools/pixellab-pipeline/src/atlas.ts:202-204@a8bede59`).

**Multipack is not implemented.** Over the ceiling, packing throws and tells you to split the family
(`tools/pixellab-pipeline/src/atlas.ts:235-240@a8bede59`). Plan family boundaries with that in mind
rather than discovering it during a build.

### Animation frames come from templates, and that constrains the vocabulary

The catalog default is `mode='template'` — one generation per direction, against 20–40 per direction
for `pro`, which is 160–320 for the full eight (`docs/adr/0006-animacao-em-template-mode.md:5@554b0d42`).
The consequence for the renderer is not cost, it is **vocabulary**: the available actions are the
template library's, so a client that assumes an arbitrary animation name exists will fail on assets
that were never generated (`docs/adr/0006-animacao-em-template-mode.md:32@554b0d42`).

Check `sheet.animations` for the key before playing it. Missing animation is a content state, not an
exceptional one.

### Equipment: a silhouette problem before a rendering problem

`low top-down` outlived its original justification. It used to be that another player had to read
what you were wearing; there are no other players now
(`docs/adr/0015-low-top-down-8-direcoes-isometrico.md:17@0a0dfd33`). Both halves survive on new
grounds: eight directions are the cardinality of movement on a grid with four diagonal axes and four
orthogonals, and `low top-down` is the perspective that matches the 2:1 dimetric projection — high
enough for the ground to have depth, low enough for a wall to have a face
(`docs/adr/0015-low-top-down-8-direcoes-isometrico.md:29@0a0dfd33`). Silhouette survived the pivot as
an **authoring** constraint instead: the tool must refuse the impossible combination rather than
render it legibly. Three facts constrain any renderer-side design:

**There is no equipment primitive in the generator.** "A API do PixelLab não resolve isso"
(`docs/02-personagem/guarda-roupa-e-silhueta.md:5@be1e5781`). Layering is ours to build or avoid.

**A piece is reusable only across the same base silhouette**, and the editor refuses a
cross-silhouette application **before spending** — once generated, the money is gone on a piece that
will never fit anyone (`docs/02-personagem/guarda-roupa-e-silhueta.md:57-61@be1e5781`).
This is not our tooling being strict; the largest open paper-doll project shows 87% of its item
definitions pointing at shared per-body folders, and an item omitting a body type is unrenderable on
it (`docs/02-personagem/guarda-roupa-e-silhueta.md:47@be1e5781`).

**Per-direction draw order is a much smaller problem than it looks.** ClassicUO reorders exactly one
slot by direction — the cloak: above everything when facing away, behind the body when facing the
viewer, just under the helm otherwise. Everything else has fixed z
(`docs/02-personagem/guarda-roupa-e-silhueta.md:31-39@be1e5781`).

The recommended order, and the renderer consequence of each step
(`docs/02-personagem/guarda-roupa-e-silhueta.md:63-67@be1e5781`):

1. **Few silhouettes.** Two or three human is the reasonable ceiling.
2. **Full baked variants first.** One `Sprite` per character, no layer renderer at all.
3. **Layers only when combinations justify it** — and then bake front/back occlusion into the assets
   the way LPC does, reserving runtime reordering for the handful of slots that truly need it.

Do not build a general layered paper-doll renderer before step 3 is reached. It is the expensive
answer to a problem the project may never have.

### What is not verified

- Whether any layered-spritesheet convention exists outside LPC
  (`docs/02-personagem/guarda-roupa-e-silhueta.md:71@be1e5781`).
- How per-direction occlusion behaves under an isometric perspective with height, where a character
  can be partly behind a wall as well as partly behind its own cloak
  (`docs/02-personagem/guarda-roupa-e-silhueta.md:74@be1e5781`).
- **The measured anchor is a decision, not code.** The packer still writes the fixed constant;
  nothing here has measured a bounding box yet, and the ~11 px figure is the ADR's estimate rather
  than something observed on a generated sprite.
- Nothing in this repository has ever rendered a PixiJS sprite. Every claim above about the atlas
  format is verified against the packer's code and every API claim against the vendored types, but
  the **combination** has not been run.

## References

- `tools/pixi-reference/vendor/skills/pixijs-scene-sprite/SKILL.md` — the Sprite/AnimatedSprite API
- `tools/pixi-reference/vendor/skills/pixijs-assets/references/spritesheet.md` — how Pixi parses an atlas
- `tools/pixellab-pipeline/src/atlas.ts` — the packer, and the only authority on the emitted format
- `docs/02-personagem/guarda-roupa-e-silhueta.md` — the three approaches real games use
- `docs/adr/0013-geometria-isometrica-64x32-z16.md` — the grid the anchor has to land on
