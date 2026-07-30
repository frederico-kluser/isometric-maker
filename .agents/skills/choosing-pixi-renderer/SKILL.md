---
name: choosing-pixi-renderer
description: Carries this editor's rendering policy - pixel art is sharp only if nearest sampling, disabled mipmaps and a single integer upscale all hold, and the backend choice decides whether the editor opens at all on the one machine that runs it, not how fast it draws. Use whenever picking WebGPU or WebGL, setting resolution or device pixel ratio, deciding scale factors, or diagnosing art that came out blurry, shimmering or seamed - including Portuguese phrasings like "a arte esta borrada", "esta borrado", "esta serrilhado", "aparece uma linha entre os tiles", "qual backend", "tela cheia", "zoom da camera", "qual resolucao", "qual fator de escala". Triggers on nearest, mipmap, resolucao, upscale, borrado, serrilhado, backend, devicePixelRatio, antialias, fallback, escala inteira.
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

### The backend choice is about booting at all, not about speed

This is a local, single-user tool: the user starts it themselves and everything runs on their own
machine (`docs/00-produto/visao.md:15@613eaec7`). The editor is a local process and what it produces
is a file on disk (`docs/00-produto/visao.md:21@613eaec7`).

So there is no audience to reach — there is one browser, on one machine, and no telemetry and no
second user to route around it. That does not make the backend choice free; it inverts it. A backend
that fails to acquire a context does not cost frames per second here, it means **the editor does not
open**, and the person it fails for is the only person there is.

Pixi 8 **requires WebGL2 or WebGPU** for its accelerated paths — there is no WebGL1 renderer, which
is why the atlas packer can use tight non-power-of-two sizing at all
(`tools/pixellab-pipeline/src/atlas.ts:202-204@a8bede59`).

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

Do not pin the editor to a single backend without a recorded decision. A one-element array is exactly
that pin, and it converts a recoverable "this GPU prefers the other backend" into a blank window with
nothing to fall back to.

### Three sharpness bugs, three causes

**Blurry** — bilinear sampling. The texture source is being sampled with smoothing. The fix is
global, and it must run before anything loads:

```ts
TextureSource.defaultOptions.scaleMode = 'nearest';
TextureSource.defaultOptions.autoGenerateMipmaps = false;
```

Then, defensively, on the sheet itself, because anything loaded before that assignment kept the old
default (`tools/pixellab-pipeline/src/atlas.ts:329-341@a8bede59`):

```ts
sheet.textureSource.style.scaleMode = 'nearest';
```

**Shimmering while moving** — the sprite is being drawn at fractional device pixels. Round positions,
and use the round-pixels option; find where it is declared with `inspect-pixi.mjs prop roundPixels`,
because it exists at more than one level and setting the wrong one silently does nothing.

**A one-pixel seam between tiles** — sampling exactly at a cell edge reads the neighbouring cell. The
pipeline already extrudes the border ring outward, 1px for sprites and 2px for tiles, precisely so
the out-of-bounds read returns the correct colour
(`tools/pixellab-pipeline/src/atlas.ts:117-122@a8bede59`). If a seam still appears, the cause is
almost always a non-integer zoom, not the atlas.

### One integer upscale, and only one

The pipeline does three things for pixel-perfect output; whatever draws the result must do two, and
the second is the one most easily lost (`tools/pixellab-pipeline/src/atlas.ts:11-16@a8bede59`):

> render at logical resolution, then **ONE** integer nearest upscale

That forbids the common approach of resizing the renderer to the window and letting the browser
scale. Pick a logical resolution, choose the largest integer factor that fits the viewport, and
letterbox the remainder. A camera zoom that is not an integer multiple of that factor reintroduces
every artefact the pipeline spent effort removing.

The geometry raised the stakes on this. The tile is a 64×32 diamond and one level of Z is 16 px, and
a non-integer upscale destroys the seam of that 2:1 diamond — **no amount of edge extrusion repairs
it** (`docs/adr/0013-geometria-isometrica-64x32-z16.md:38@e194895c`). The recorded consequence is
`resolution: 1`, `autoDensity: false`, and one whole-number factor on the stage. So the editor's
zoom control is not a continuous slider: it steps through integers. Offering 1.5× is offering a
broken picture, and it will be reported as a tileset bug.

Antialiasing is off for the same reason: there are no diagonal edges to smooth in pixel art, only
pixels to blur.

### Premultiplied alpha stays on

Pixi 8 premultiplies on upload and that is correct. The dark halo people blame on it comes from
*filtering* between an opaque pixel and a transparent black one; with nearest sampling, extrusion and
integer transforms there is no interpolation and it cannot occur
(`tools/pixellab-pipeline/src/atlas.ts:17-23@a8bede59`). Disabling it to chase a halo treats the
symptom and breaks blending everywhere else.

### Device pixel ratio is a budget decision

Rendering at the device ratio on a high-density display can quadruple the fill cost for art that is
deliberately low-resolution. For this editor the logical resolution is the art's resolution; the
display ratio belongs in the integer upscale factor, not in the renderer resolution. Deviating from
that is a performance decision and belongs in `profiling-pixi-performance` with a measurement
attached.

### What is not verified

- Which backend the machine this runs on actually reports. Nothing here has ever rendered a frame
  (`docs/00-produto/visao.md:58@613eaec7`), and there is no telemetry and nobody to collect it from.
- Whether WebGPU on this art style measurably beats WebGL2 here. Untested, and the honest default is
  to prefer WebGPU with a WebGL2 fallback and revisit with numbers.
- Which integer factors a real editing session actually wants. That the factor must be an integer is
  decided; that 1×, 2×, 3× is the right set is a guess until someone edits a map.

## References

- `tools/pixi-reference/vendor/skills/pixijs-core-concepts/SKILL.md` — backend selection and the render pipeline
- `tools/pixi-reference/vendor/skills/pixijs-environments/SKILL.md` — workers, SSR and restricted contexts
- `docs/adr/0013-geometria-isometrica-64x32-z16.md` — the 64×32 diamond and why the stage scale must be whole
- `tools/pixellab-pipeline/src/atlas.ts` — the pipeline half of pixel-perfect, and why each step exists
