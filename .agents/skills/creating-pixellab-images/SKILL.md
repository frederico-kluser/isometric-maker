---
name: creating-pixellab-images
description: Distinguishes the seven PixelLab text-to-image models, which differ in size ceiling, synchronicity and how many images one call returns, plus the prompt-enhancement endpoints that bill separately. Use whenever a task generates a standalone pixel art image from a description, picks between pixflux and pixen and bitforge, matches a reference style, or enhances a prompt - including Portuguese phrasings like "gerar uma imagem", "criar a arte do item", "qual modelo usar", "imagem a partir do texto", "copiar o estilo dessa imagem", "melhorar o prompt". Triggers on create-image-pixflux, create-image-pixen, create-image-bitforge, generate-image-v2, generate-with-style-v2, enhance-pixen-prompt, style_image, init_image, no_background, text_guidance_scale.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Creating PixelLab images

## When to use

Before generating a loose image — an item icon, a concept frame, a style probe. Not for characters
with rotations, not for terrain: those are different families with their own persistence.

## Injected knowledge

### Seven models, and the differences that actually decide the choice

| Endpoint | Max size | Sync? | Returns |
|---|---|---|---|
| `/create-image-pixflux` | 16–400 | **synchronous** | one image |
| `/create-image-pixflux-background` | 16–400 | async, `202` | one image, same params |
| `/create-image-pixen` | 16–768 axis, **area ≤ 512×512**, **divisible by 4** | **synchronous** | one image |
| `/create-image-bitforge` | 16–200 | **synchronous** | one image |
| `/generate-image-v2` | 16–792 × 16–688, aspect-dependent | async, `202` | **many** — see below |
| `/generate-with-style-v2` | 16–512 square | async, `202` | **many** — see below |
| `/generate-ui-v2` | 16–792 × 16–688 | async, `202` | UI elements |

`/create-image-pixflux` and `/create-image-pixflux-background` take an identical request body and
differ only in whether the connection is held open. That is the cleanest illustration in the whole
API that synchronicity is a property of the route, not of the work.

`pixen` is the only one with a divisibility rule: width and height must be **multiples of 4**, and
the per-axis maximum of 768 is a lie unless the *area* also fits 512×512
(`tools/pixellab-pipeline/src/endpoints.ts:137@b6e61f99`). Validate locally — a 422 arrives after
submission.

### The v2 endpoints return a grid, and the count is decided by the size

This is the single most surprising behaviour in the family. You do not ask for a number of images;
the size decides it.

`/generate-image-v2`, by max dimension: up to 42px → **64 images** (8×8 grid); 43–85px → 16;
86–170px → 4; above 170px → 1.

`/generate-with-style-v2`, by size: 16 and 17–32 → **64 images**; 33–64 → 16; 65–128 → 4;
129–512 → 1. Non-square and non-standard sizes are internally padded to the nearest of
16/32/64/128/256/512, and the returned images match what you asked for.

So a 32px request costs one job and yields 64 candidates, while a 200px request yields one. Code
that reads `images[0]` and moves on is discarding 63 paid results at small sizes.

### Style hint fields are weakly guiding, and the enums are real here

Unlike the character endpoints, where `outline`/`shading`/`detail` are free strings, the image
endpoints constrain them:

- `Outline` = single color black outline, single color outline, selective outline, lineless
- `Shading` = flat shading, basic shading, medium shading, detailed shading, highly detailed shading
- `Detail` = low detail, medium detail, highly detailed

Note the last value: `highly detailed`, **not** "high detail". The character endpoints' prose uses
"high detail" and the map-object endpoint accepts it; copying that wording here is a 422. The spec
labels these "weakly guiding" — a valid value still may not be followed.

Camera and direction come from the two named enums:

- `CameraView` = side, low top-down, high top-down
- `Direction` = north, north-east, east, south-east, south, south-west, west, north-west

### Background removal is two different things

`no_background` asks for a transparent result. `background_removal_task` chooses how:
`remove_simple_background` (default, faster) or `remove_complex_background` (slower, better edges).
On `/create-image-pixflux` the description adds that transparency means a "blank background over
200x200 area" — the flag behaves differently past that size.

### Deprecated fields still present in the schema

`negative_description` is marked `(Deprecated)` on `/create-image-pixflux` and
`extra_guidance_scale` is deprecated on `/create-image-bitforge` and `/inpaint`. They validate,
they do nothing useful, and their presence in the schema makes them look supported. `bitforge` is
the only one whose `negative_description` is documented as functional.

`bitforge` also carries `skeleton_keypoints` with an explicit warning that sizes other than 16×16,
32×32 and 64×64 degrade quality.

### Prompt enhancement is a separate, separately billed call

`/enhance-pixen-prompt`, `/enhance-character-v3-prompt` and `/enhance-animation-v3-prompt` are
synchronous, return `enhanced_prompt`, and cost a small amount of their own. Several generation
endpoints take `enhance_prompt: true` to do it inline — and when they do, they return **both**
`enhanced_prompt` and a separate `enhance_usage`, so a single call produces **two** charges. Cost
accounting that reads only `usage` undercounts.

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S tag "Create Image"
node $S endpoint /create-image-pixen
node $S flow /generate-image-v2
```

### Retry surface

The synchronous three answer **`529` Rate limit exceeded** — a non-standard code most HTTP clients
do not treat as transient (`tools/pixellab-pipeline/src/api.ts:20@314e8627`). The async three answer
`429` for concurrency instead.

## References

- `editing-pixellab-images` — changing an image that already exists, rather than making one
- `designing-pixellab-interfaces` — `/generate-ui-v2` in the context of the UI panel pipeline
- `orchestrating-pixellab-jobs` — polling the v2 family and reading `last_response`
- `querying-pixellab-api` — the per-endpoint size namespacing that makes these ranges differ
