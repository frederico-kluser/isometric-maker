---
name: designing-pixellab-interfaces
description: Covers the PixelLab UI panel pipeline and pixel-font generation - two families with size floors, aspect-dependent ceilings and their own retrieval routes, where the panel endpoint is the only one in the API that takes a shape template. Use whenever a task builds game UI, HUD, panels, buttons, health bars, inventory frames, dialogue boxes or a pixel font - including Portuguese phrasings like "criar o painel da UI", "botao do menu", "barra de vida", "caixa de dialogo", "fonte pixelada", "interface do jogo", "moldura do inventario". Triggers on create-ui-asset, generate-ui-v2, generate-font-pro, ui_asset_id, pieces, elements, glyph_px, ttf, image_url.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Designing PixelLab interfaces

## When to use

Before generating any interface art or font. UI is the family where the size rules bite first: the
panel endpoint has a **minimum** of 192px, which is larger than the maximum of several sprite
endpoints.

## Injected knowledge

### Two endpoints make UI, and they are not alternatives

| Endpoint | Produces | Persisted? | Retrieval |
|---|---|---|---|
| `/create-ui-asset` | a **panel**, shape-composed, saved as an asset | yes, `ui_asset_id` | `GET /ui-assets/{ui_asset_id}` |
| `/generate-ui-v2` | loose UI **elements** — buttons, bars, slots | no | generic background job |

`/create-ui-asset` is the only endpoint in the entire API that accepts a **shape template**. `pieces`
describes the panel's geometry in editor coordinates where the longer side is 512 and the shorter is
aspect-scaled — each piece needs a unique `id`, a `kind`, and optionally a `label`. Omit `pieces`
entirely and you get a default full-canvas rounded rectangle.

`elements` is the easier road: named UI element types that are auto-positioned, no coordinates
required. Use it unless the layout is the point.

### The size floor is the first thing that will reject you

`/create-ui-asset` accepts **192–688** per axis, with the real ceiling depending on aspect: 512 for
square, 688 for 16:9 or 9:16 (`tools/pixellab-pipeline/src/endpoints.ts:169@08e4ea43`). A 128×128
panel is not a small panel, it is a `422`.

`/generate-ui-v2` is looser — 16–792 wide by 16–688 tall, default 256×256 — and the same
aspect-dependent ceiling applies. The per-axis maxima in the schema are not jointly achievable.

There is no global size rule in this API; `ImageSize` is namespaced per endpoint, so neither of these
ranges transfers to anything else.

### The panel route has its own progress reporting

`GET /ui-assets/{ui_asset_id}` does not go through `/background-jobs/{job_id}`. It returns
`status` ∈ processing, completed, failed, plus **`progress_percent`** and **`eta_seconds`** while
working — fields the generic job route does not provide. `image_url` is **null until completed**.

`GET /ui-assets` lists newest first and **includes ghost rows for jobs still generating**, so the
list is not a list of finished assets. Filter on `status` before showing anything.

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S tag "UI Creator"
node $S flow /create-ui-asset
node $S response /ui-assets/{ui_asset_id}
```

### Fonts produce two artefacts, and both are download URLs

`/generate-font-pro` is the only endpoint that returns a **usable font file**, not just images. It
restyles a bundled per-weight reference layout to match a description and produces a glyph atlas PNG
plus a real TrueType `.ttf`.

- `weight` ∈ Bold, Regular — **required**, no default.
- `image_size` ∈ `1K`, `2K` — this is a *generation resolution and pricing tier*, not pixel
  dimensions. 2K costs more.
- `glyph_px` ∈ 8, 16, 32, 64 — this is the actual bitmap size per glyph in the output.

Those last two are the confusing pair: `image_size` does not describe the font's size, `glyph_px`
does. Setting `image_size='2K'` expecting bigger glyphs buys a more expensive generation at the same
glyph resolution.

Results arrive at `GET /generate-font-pro/{job_id}` as `download_atlas_url` and `download_ttf_url`,
both **present only when `status` is `completed`**. The generic background-job route also carries
them, as `images[0]` and `ttf_base64` in `last_response` — two different shapes for the same result,
depending on which route you poll.

### Both families share the dedicated-route status vocabulary

`/generate-font-pro/{job_id}` reports `processing`, **`stalled`**, **`finalizing`**, `failed`,
`completed`, answers **`423`** with `Retry-After` while working and **`410`** on permanent failure —
the same contract as the portrait and vocal-animation routes, and different from
`/background-jobs/{job_id}`.

### Colour is specified as prose here, not as a palette image

`/create-ui-asset` and `/generate-ui-v2` take `color_palette` as a **free-text string** capped at 200
characters — "brown and gold", "blue and silver". Most of the API takes a `color_image` and forces
the palette from its pixels. UI does not. There is no way to force exact colours on these two
endpoints; match them afterwards, or pass a `style_image` on `/create-ui-asset`.

### Deleting

`DELETE /ui-assets/{ui_asset_id}` removes the panel and its backing image files permanently. There
is no delete for fonts — the artefacts live behind the job's download URLs.

## References

- `creating-pixellab-images` — `/generate-ui-v2` shares the size and background rules of that family
- `generating-pixellab-portraits` — the dialogue face the panel and font will frame
- `orchestrating-pixellab-jobs` — dedicated job routes, `423`/`410`, and download URLs
