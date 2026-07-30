---
name: animating-pixi-sprites
description: Carries how this game turns PixelLab output into drawn characters - the two-file atlas contract, the canonical eight-direction frame order, the feet-centred anchor, the frame rate that lives outside the Pixi JSON, and why equipment layering is a silhouette problem before it is a rendering one. Use whenever loading an atlas, playing a character or creature animation, picking an anchor, setting frame rate, or drawing equipment on a body - including Portuguese phrasings like "carregar o atlas", "animar o personagem", "trocar de direcao", "o sprite anda de lado", "quantos quadros por segundo", "vestir o equipamento", "camada de roupa", "a ancora esta errada", "o sprite treme". Triggers on atlas, spritesheet, frame, direcao, paper-doll, silhueta, ancora, extrusao, sidecar, template.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Animating sprites in this game

## When to use

Before loading an atlas, before naming a frame, before deciding where a sprite's origin sits, and
before designing anything that draws equipment on a body.

For the API itself — `Assets`, `Spritesheet`, `AnimatedSprite`, `Texture` — read
`tools/pixi-reference/vendor/skills/pixijs-scene-sprite/SKILL.md` and `pixijs-assets` (which has
twelve reference documents, including one on spritesheets). This skill does not restate them.

## Injected knowledge

### The atlas is two files, and the split is load-bearing

The pipeline emits, per family (`tools/pixellab-pipeline/src/atlas.ts:4-9@e9504d6c`):

| File | What it is |
|---|---|
| `<name>.json` | strictly TexturePacker JSON Hash — **the only thing Pixi parses** |
| `<name>.pixellab.json` | our sidecar: frame rate, logical anchor, provenance |

> "Never extend the Pixi JSON with game semantics. The parser owns that shape and a future major
> version will fight you for it." — `tools/pixellab-pipeline/src/atlas.ts:8@e9504d6c`

So **frame rate is not in the atlas Pixi reads**. It is in the sidecar, and the client must load both.
Getting the animation speed from anywhere else means guessing.

### Frame names encode direction, and the order is not the spec's order

Canonical name: `<family>_<action>_<DIR>_<NN>`, direction as the short uppercase code
(`tools/pixellab-pipeline/src/atlas.ts:81-90@e9504d6c`).

The project's canonical direction order is the order the 8-rotation endpoint **returns**:

```
S, SW, W, NW, N, NE, E, SE
```

This differs from the PixelLab spec's own direction enum, which starts at north — a distinction that
belongs to `querying-pixellab-api`, not here (`docs/adr/0005-low-top-down-8-direcoes.md:25@0f447499`).
Getting it wrong produces **no error at all** — the character simply walks sideways. If a sprite faces
the wrong way, suspect the frame naming before suspecting the input code.

Frames are packed direction-major, frame-minor, so the PNG stays byte-stable and regeneration
produces an empty git diff (`tools/pixellab-pipeline/src/atlas.ts:100-101@e9504d6c`).

### The anchor is at the feet, not the centre

Default anchor is `{ x: 0.5, y: 0.875 }` (`tools/pixellab-pipeline/src/atlas.ts:216@e9504d6c`), and
it is written into every frame of the atlas JSON. Feet-centred is what makes a character's position
mean "where it stands on the ground" — which is what the tile grid, the depth sort and the server's
coordinate all mean too. Centring a sprite instead makes everything drift by half a body as sprite
heights vary.

### Pixel-perfect is five things, and two of them are the client's

Three are done in the pipeline — no resampling ever, 1px extrusion for sprites and 2px for tiles plus
a transparent gutter, deterministic frame order. Two are the client's, and skipping either wastes the
other three (`tools/pixellab-pipeline/src/atlas.ts:11-16@e9504d6c`):

1. `scaleMode` `'nearest'`, mipmaps off.
2. Render at logical resolution, then **one** integer nearest upscale.

The pipeline ships the client half as copyable code
(`tools/pixellab-pipeline/src/atlas.ts:329-341@e9504d6c`). Its shape, verified against the vendored
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
(`tools/pixellab-pipeline/src/atlas.ts:17-23@e9504d6c`). The pipeline's alpha-bleed pass is
belt-and-braces for the case where a filter or a tint sneaks in anyway.

### The atlas has a hard ceiling and no multipack

Pages are capped at 2048×2048, which is the safe limit on integrated and mobile GPUs
(`tools/pixellab-pipeline/src/atlas.ts:43@e9504d6c`). Sizing is tight NPOT rather than power-of-two,
because Pixi 8 requires WebGL2 or WebGPU and pixel art never uses mipmaps; POT would waste up to 72%
of the texture (`tools/pixellab-pipeline/src/atlas.ts:202-204@e9504d6c`).

**Multipack is not implemented.** Over the ceiling, packing throws and tells you to split the family
(`tools/pixellab-pipeline/src/atlas.ts:235-240@e9504d6c`). Plan family boundaries with that in mind
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

Build is equipment, so other players must be able to read what you wear — that is what forced the
`low top-down` perspective (`docs/adr/0005-low-top-down-8-direcoes.md:13@0f447499`). Three facts
constrain any renderer-side design:

**There is no equipment primitive in the generator.** "A API do PixelLab não resolve isso"
(`docs/03-arquitetura/paper-doll-e-equipamento.md:5@1316896a`). Layering is ours to build or avoid.

**A piece is reusable only across the same base silhouette**, and the authoring tool refuses a
cross-silhouette application before spending (`docs/03-arquitetura/paper-doll-e-equipamento.md:53-55@1316896a`).
This is not our tooling being strict; the largest open paper-doll project shows 87% of its item
definitions pointing at shared per-body folders, and an item omitting a body type is unrenderable on
it (`docs/03-arquitetura/paper-doll-e-equipamento.md:43@1316896a`).

**Per-direction draw order is a much smaller problem than it looks.** ClassicUO reorders exactly one
slot by direction — the cloak: above everything when facing away, behind the body when facing the
viewer, just under the helm otherwise. Everything else has fixed z
(`docs/03-arquitetura/paper-doll-e-equipamento.md:27-35@1316896a`).

The recommended order, and the renderer consequence of each step
(`docs/03-arquitetura/paper-doll-e-equipamento.md:57-61@1316896a`):

1. **Few silhouettes.** Two or three human is the reasonable ceiling.
2. **Full baked variants first.** One `Sprite` per character, no layer renderer at all.
3. **Layers only when combinations justify it** — and then bake front/back occlusion into the assets
   the way LPC does, reserving runtime reordering for the handful of slots that truly need it.

Do not build a general layered paper-doll renderer before step 3 is reached. It is the expensive
answer to a problem the project may never have.

### What is not verified

- Whether any layered-spritesheet convention exists outside LPC
  (`docs/03-arquitetura/paper-doll-e-equipamento.md:65@1316896a`).
- Nothing in this repository has ever rendered a PixiJS sprite. Every claim above about the atlas
  format is verified against the packer's code and every API claim against the vendored types, but
  the **combination** has not been run.

## References

- `tools/pixi-reference/vendor/skills/pixijs-scene-sprite/SKILL.md` — the Sprite/AnimatedSprite API
- `tools/pixi-reference/vendor/skills/pixijs-assets/references/spritesheet.md` — how Pixi parses an atlas
- `tools/pixellab-pipeline/src/atlas.ts` — the packer, and the only authority on the emitted format
- `docs/03-arquitetura/paper-doll-e-equipamento.md` — the three approaches real games use
