---
name: choosing-pixi-renderer
description: Carries this game's rendering policy - pixel art is sharp only if nearest sampling, disabled mipmaps and a single integer upscale all hold, and the backend choice is a reach decision for a browser MMO rather than a performance one. Use whenever picking WebGPU or WebGL, setting resolution or device pixel ratio, deciding scale factors, or diagnosing art that came out blurry, shimmering or seamed - including Portuguese phrasings like "a arte esta borrada", "esta borrado", "esta serrilhado", "aparece uma linha entre os tiles", "qual backend", "roda no celular", "tela cheia", "zoom da camera", "qual resolucao". Triggers on nearest, mipmap, resolucao, upscale, borrado, serrilhado, backend, devicePixelRatio, antialias, fallback.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Choosing and configuring the renderer

## When to use

Before the first `init`, and whenever pixel art looks wrong. Blurry, shimmering and seamed are three
different bugs with three different causes, all listed below.

For the backend machinery itself read
`tools/pixi-reference/vendor/skills/pixijs-core-concepts/SKILL.md`.

## Injected knowledge

### The backend choice is about reach, not speed

The client runs in the browser and the player enters by a link, installing nothing
(`docs/adr/0001-pixijs-em-vez-de-cocos.md:26@a1022690`). That makes backend selection a question of
who can play, not of frames per second.

Pixi 8 **requires WebGL2 or WebGPU** for its accelerated paths — there is no WebGL1 renderer, which
is why the atlas packer can use tight non-power-of-two sizing at all
(`tools/pixellab-pipeline/src/atlas.ts:202-204@e9504d6c`).

The selection option is `RendererPreference`, and its value set is wider than most recollections of
it: `"webgl" | "webgpu" | "canvas"`
(`tools/pixi-reference/vendor/pixi-api.d.ts:8388@e58b8ac3`). Three things about it are easy to get
wrong, and two of them are recent enough to sit outside most training data:

- **The default is WebGL first, not WebGPU.** With no preference set, the priority order is webgl,
  then webgpu, then canvas. Assuming WebGPU is the default and "optimising" by requesting WebGL is a
  no-op; assuming it and requesting nothing gets WebGL.
- **String and array mean different things.** A single string tries that backend first and keeps the
  rest as fallbacks. An array tries **only** what is listed, in order — which makes it a blocklist,
  and makes a one-element array a hard pin with no fallback at all.
- **Both are version-gated.** The canvas value arrived in 8.16.0 and the array form in 8.18.0. The
  vendor is pinned at 8.19.0, so both are available here, but neither is safe to emit for a target on
  an older minor.

Do not pin the client to a single backend without a recorded decision. That is a reach cut, and reach
is the reason this project is in a browser at all.

### Three sharpness bugs, three causes

**Blurry** — bilinear sampling. The texture source is being sampled with smoothing. The fix is
global, and it must run before anything loads:

```ts
TextureSource.defaultOptions.scaleMode = 'nearest';
TextureSource.defaultOptions.autoGenerateMipmaps = false;
```

Then, defensively, on the sheet itself, because anything loaded before that assignment kept the old
default (`tools/pixellab-pipeline/src/atlas.ts:329-341@e9504d6c`):

```ts
sheet.textureSource.style.scaleMode = 'nearest';
```

**Shimmering while moving** — the sprite is being drawn at fractional device pixels. Round positions,
and use the round-pixels option; find where it is declared with `inspect-pixi.mjs prop roundPixels`,
because it exists at more than one level and setting the wrong one silently does nothing.

**A one-pixel seam between tiles** — sampling exactly at a cell edge reads the neighbouring cell. The
pipeline already extrudes the border ring outward, 1px for sprites and 2px for tiles, precisely so
the out-of-bounds read returns the correct colour
(`tools/pixellab-pipeline/src/atlas.ts:117-122@e9504d6c`). If a seam still appears, the cause is
almost always a non-integer zoom, not the atlas.

### One integer upscale, and only one

The pipeline does three things for pixel-perfect output; the client must do two, and the second is
the one most easily lost (`tools/pixellab-pipeline/src/atlas.ts:11-16@e9504d6c`):

> render at logical resolution, then **ONE** integer nearest upscale

That forbids the common approach of resizing the renderer to the window and letting the browser
scale. Pick a logical resolution, choose the largest integer factor that fits the viewport, and
letterbox the remainder. A camera zoom that is not an integer multiple of that factor reintroduces
every artefact the pipeline spent effort removing.

Antialiasing is off for the same reason: there are no diagonal edges to smooth in pixel art, only
pixels to blur.

### Premultiplied alpha stays on

Pixi 8 premultiplies on upload and that is correct. The dark halo people blame on it comes from
*filtering* between an opaque pixel and a transparent black one; with nearest sampling, extrusion and
integer transforms there is no interpolation and it cannot occur
(`tools/pixellab-pipeline/src/atlas.ts:17-23@e9504d6c`). Disabling it to chase a halo treats the
symptom and breaks blending everywhere else.

### Device pixel ratio is a budget decision

Rendering at the device ratio on a phone can quadruple the fill cost for art that is deliberately
low-resolution. For this game the logical resolution is the art's resolution; the display ratio
belongs in the integer upscale factor, not in the renderer resolution. Deviating from that is a
performance decision and belongs in `profiling-pixi-performance` with a measurement attached.

### What is not verified

- Which backends the target audience's browsers actually report. No telemetry exists.
- Whether WebGPU on this art style measurably beats WebGL2 here. Untested, and the honest default is
  to prefer WebGPU with a WebGL2 fallback and revisit with numbers.

## References

- `tools/pixi-reference/vendor/skills/pixijs-core-concepts/SKILL.md` — backend selection and the render pipeline
- `tools/pixi-reference/vendor/skills/pixijs-environments/SKILL.md` — workers, SSR and restricted contexts
- `tools/pixellab-pipeline/src/atlas.ts` — the pipeline half of pixel-perfect, and why each step exists
