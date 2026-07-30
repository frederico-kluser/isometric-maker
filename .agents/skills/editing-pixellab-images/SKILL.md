---
name: editing-pixellab-images
description: Covers the eight PixelLab endpoints that transform an image you already have - inpaint, edit, resize, remove background, and photo-to-pixel-art - including the mask polarity that silently ruins a result and the iterative resize rule. Use whenever a task edits, masks, upscales, downscales, converts or cleans up an existing image rather than generating a new one - including Portuguese phrasings like "editar a imagem", "pintar so essa parte", "mascara de inpaint", "aumentar o sprite", "redimensionar", "tirar o fundo", "transformar a foto em pixel art". Triggers on inpaint, inpaint-v3, edit-image, edit-images-v2, resize, remove-background, image-to-pixelart, mask_image, crop_to_mask, init_image_strength.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Editing PixelLab images

## When to use

Whenever the input is an image that already exists. Editing is cheaper than regenerating and keeps
identity — but three of these endpoints fail in ways that look like a model quality problem and are
actually a parameter mistake.

## Injected knowledge

### Mask polarity: white generates, black preserves

Every masked endpoint here uses the same convention, stated in the spec as "black and white image,
where the white is where the model should inpaint". Inverting the mask does not error — it
regenerates everything you wanted to keep and preserves what you wanted replaced. There is no
signal other than the result looking wrong.

`/inpaint` additionally requires `init_image` whenever `mask_image` is used on the rotate-style
routes; a mask without an init image is rejected.

`crop_to_mask` on `/inpaint-v3` defaults to **true** and is what keeps generated content from
bleeding past the mask boundary. Turning it off is how you get soft edges in pixel art.

### The eight endpoints, and which are synchronous

| Endpoint | Size | Sync? |
|---|---|---|
| `/inpaint` | max area 200×200 | **synchronous**, may answer `529` |
| `/inpaint-v3` | inpainting image 32–512, context image up to 1024 | async, `202` |
| `/edit-image` | reference and target both 16–400 | async, `202` |
| `/edit-images-v2` | 32–512 output, inputs ≤ 512 each, **1–16 images** | async, `202` |
| `/resize` | 16–200, both source and target | **synchronous** |
| `/remove-background` | max area 400×400 | **synchronous** |
| `/image-to-pixelart` | input 16–1280, **output 16–320** | **synchronous** |
| `/image-to-pixelart-pro` | any PNG/JPEG, >2048px scaled down first | async, `202` |

`/edit-image` has a documented **free-tier ceiling of 200×200** on the target canvas that the schema
range (16–400) does not express (`docs/01-pixellab/custos-e-limites.md:142@0c85bc2b`). The 422 only
shows up after submission.

The repo's endpoint table models `/image-to-pixelart` at 16–1280
(`tools/pixellab-pipeline/src/endpoints.ts:139@08e4ea43`) — that is the **input** range. The output
is capped at 320 and is a separate field.

### `/edit-image` takes the size twice, and they mean different things

`image_size` is the size of the **reference** image you are sending. `width` and `height` are
top-level fields describing the **target canvas**. They are not redundant and they are not
interchangeable — this is the only endpoint in the API shaped this way, and passing the target size
in `image_size` produces a valid request that edits the wrong thing.

### Resize is iterative or it degrades

The spec's own guidance: at most a 50% decrease or a 2× increase per call. 32→64 is fine;
32→128 should be two calls. `/resize` also requires a `description` of the subject — it is a
generative resize, not a scaler, and an empty or vague description is why upscales lose detail.

`init_image_strength` on this endpoint defaults to **150**, while the same-named field on almost
every other endpoint defaults to **300**. Copying a working call from elsewhere silently halves the
influence.

### `image-to-pixelart` versus its Pro sibling

`/image-to-pixelart` makes you choose the output size and the spec recommends **1/4 of the input**
with the aspect ratio preserved. `/image-to-pixelart-pro` decides the output size for itself by
detecting the native pixel scale — so it has **no `output_size` field at all**, and looking for one
is the usual first mistake.

### Style transfer lives in two places

There is no endpoint called "style transfer". `/edit-images-v2` with `method='edit_with_reference'`
matches a reference image's style across the images you pass; `/generate-with-style-v2` generates
new content in a style. Editing preserves structure and pose; generating does not.

`method` ∈ edit_with_text, edit_with_reference — and `description` is required for the first while
`reference_image` is required for the second. The schema marks neither as required because it cannot
express the conditional, so both omissions are 422s at submit time.

### Batch limits are size-dependent

`/edit-images-v2` accepts 1–16 images and `/edit-animation-v2` accepts 2–16 frames, both with "max
depends on frame size" in the prose and no encoded rule. Larger frames mean fewer per call. There is
no way to compute the ceiling from the spec — build up, and treat a 422 on a large batch as the
signal to split it rather than as a bug.

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S endpoint /inpaint-v3
node $S limits | grep -E 'inpaint|edit|resize|remove|pixelart'
```

### Deprecated parameters that still validate

`context_image` and `bounding_box` on `/inpaint-v3` are both marked deprecated;
`extra_guidance_scale` and `negative_description` on `/inpaint` likewise. They are accepted and
ignored, which is worse than being rejected — a request built around them looks configured and is
not.

## References

- `creating-pixellab-images` — generating from scratch, and the shared style-hint enums
- `animating-pixellab-sprites` — `/edit-animation-v2` and `/transfer-outfit-v2`, the frame-batch editors
- `orchestrating-pixellab-jobs` — which of these poll, and the `529` retry surface
- `guarding-generation-cost` — editing an asset changes its hash and therefore re-bills it
