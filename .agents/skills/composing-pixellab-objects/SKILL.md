---
name: composing-pixellab-objects
description: Covers every PixelLab object endpoint - the three creation families (1-direction, 8-direction, map objects) that differ by more than ten times in price, the review status that parks paid candidates until frames are selected or dismissed, object states, animations (v3 is the default) and the full lifecycle. Use whenever a task creates a prop, barrel, chest, torch, corpse, furniture or scenery item, picks candidate frames, animates an object, or lists, tags, edits or deletes objects - including Portuguese phrasings like "gerar o bau", "criar os objetos do mapa", "props do cenario", "objeto de 8 direcoes", "escolher os frames", "estado do objeto", "animar o objeto", "apagar o objeto". Triggers on create-1-direction-object, create-8-direction-object, map-objects, select-frames, dismiss-review, object_id, review status, n_frames, frame_urls, animation_group_id, rotation_urls.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Composing PixelLab objects

## When to use

Before generating any object. Objects are first-class assets: props, furniture, scenery, anything that stands on a tile. Pick the creation family before any other decision — the three endpoints make props look interchangeable and are not: a barrel that ends up looking the same can cost a few cents or ten to twenty times more.

## Injected knowledge

### Pick the family before the parameters

| Need | Endpoint | Cost order |
|---|---|---|
| A prop placed on a specific map, one angle | `/map-objects` | cheapest by far — estimated US$ 0,0099, ~15–30 s |
| A standalone prop, one direction | `/create-1-direction-object` | **20–40 generations** (Pro Tools) |
| A prop seen from 8 angles | `/create-8-direction-object` | **20–40 generations** (Pro Tools) |

The spec states the 20–40 figure inline on both object endpoints ("Object generation uses the Pro Tools and costs **20–40 generations** per call"). `/map-objects` is the cheap family — about **10–20× cheaper** than the Pro Tools endpoints, verified at an estimated US$ 0,0099 against the pricing page (`docs/01-pixellab/custos-e-limites.md:31@fe52f3d5`, `docs/01-pixellab/custos-e-limites.md:117@fe52f3d5`). For map props — barrel, torch, chest, corpse — it is the right call; reserve the Pro Tools endpoints for standalone assets that genuinely need more.

Size ceilings are per-pipeline, not arbitrary: `/create-1-direction-object` takes 32–256 (default 64), `/create-8-direction-object` only 32–168 because the 8-rotation pipeline rejects anything larger, and `/map-objects` takes 32–400 per axis with a max 400×400 area (160,000 px), dropping to 192×192 (36,864 px) when inpainting is used (`docs/01-pixellab/custos-e-limites.md:157@fe52f3d5`).

### The three creation endpoints

All three are asynchronous and answer **200** (never 202) with a `background_job_id`; poll `GET /objects/{object_id}` for the outcome (map objects have their own poll endpoint, below).

**POST /create-1-direction-object** — a static prop seen from one angle.
- Required: `description`. Optional: `size` (32–256, default 64), `view` (`top-down` default | `sidescroller`), `style_images` (StyleReferenceImage, ≤256×256 each), `item_descriptions`.
- `size` and `style_images` are mutually exclusive — the output size derives from the largest style image.
- The effective size also fixes how many candidates are generated in one shot (≤42→64, ≤85→16, ≤170→4, else 1; with style images ≤85→8, ≤170→4, else 1); the response reports it in `n_frames`. More than one candidate means **review** status.
- `item_descriptions` gives per-object prompts when multiple candidates; its length must not exceed the derived count.

**POST /create-8-direction-object** — a prop rendered from 8 angles in one shot.
- Required: `description`. Optional: `size` (32–168, default 64), `view` (`low top-down` default | `high top-down` | `side`), `reference_image`, `style_image`.
- `reference_image` rotates *that exact object* into 8 views; `style_image` generates a *new* object matching the description in that style. They are mutually exclusive with each other and with `size` — when provided, image dimensions set the output size.

**POST /map-objects** — a pixel-art object with transparent background, generated to match a map.
- Required: `description`. Optional: `image_size` (32–400 per axis, default 128×128), `view` (`low top-down` | `high top-down` default | `side`), `outline` (`single color outline` default | `selective outline` | `lineless`), `shading` (`flat shading` | `basic shading` | `medium shading` default | `detailed shading`), `detail` (`low detail` | `medium detail` default | `high detail`), `text_guidance_scale` (1–20, default 8), `init_image` + `init_image_strength` (1–999, default 300), `color_image` (forced palette), `background_image` (required whenever inpainting is used), `inpainting` (mask, oval or rectangle), `seed` (≥ 0).
- Inpainting generates the prop *into* an existing scene: a custom `mask_image` (black = frozen context, white = generate area) or an auto-generated oval/rectangle (`fraction` 0.05–0.95, default 0.3).
- Poll `GET /map-objects/{object_id}`: **423** + `Retry-After` while generating, **410** when it failed permanently, **404** for unknown ids, **200** with metadata + `download_url` when done.

### The review trap — money parked until you pick

`/create-1-direction-object` can produce several candidate frames (count in `n_frames`, derived from `size`). When there is more than one, the object lands in **`review`** status and nothing is finished. You must then either:

- `POST /objects/{object_id}/select-frames` with 0-based `indices` — each selected frame is promoted to its own completed object, returned in `created_object_ids`; `common_tag` applies to every one of them; or
- `POST /objects/{object_id}/dismiss-review` to discard all of them.

A single candidate is kept automatically. Until one of the two calls happens, `rotation_urls` is empty and the candidates live only in `frame_urls` / `storage_urls` under `frame_N` keys. The generations were already paid for. Code that polls for `completed` and never handles `review` waits forever on work it already bought. Review outputs are always 1-direction objects awaiting selection and cannot be the source of a state edit.

Object status values are `pending`, `processing`, `completed`, `review`, `failed` — five, not three.

### The 8-hour expiry — download the PNG, not the link

`GET /map-objects/{object_id}` answers 200 with a no-auth `download_url` when completed — and the artifact **auto-deletes 8 hours after creation** (spec verbatim: "Warning: map objects auto-delete after 8 hours."; pipeline: `tools/pixellab-pipeline/src/cost.ts:267@84fca7a8`, `tools/pixellab-pipeline/src/api.ts:225@55dd790d`). Download the PNG promptly; storing the link is storing a timer.

### Object states — variants of an existing object

`POST /objects/{object_id}/states` applies a text edit to an existing object's images and saves the result as a new object grouped with the source via `group_id`. Required: `edit_description`. Optional: `state_name`, `seed` (≥ 0). The source **must be completed** — 400 "Source object is not completed" otherwise. Async like the creation endpoints, answering 200 with a `background_job_id`.

### Object animation — v3 is the default, and it is the good one

`POST /objects/{object_id}/animations` takes `mode` ∈ `pro`, `v3` and defaults to **`v3`** — the spec prefers it: "it usually produces higher quality results than `'pro'`, and is cheaper". Do not "improve" the default to `pro`: it costs 20–40 generations per direction, 160–320 for a full eight, and is capped by canvas size (16 frames only ≤64px, 4/9/16 ≤128px, 9 only ≤170px, unsupported above 170px).

v3 features (v3-only unless noted):
- `frame_count`: any even number 4–16, default 8. Gotcha: v3 stores the input reference frame as frame 0 by default, so `frame_count=8` stores **9** frames (reported by `get_object`). Set `keep_first_frame=false` to store exactly `frame_count` frames. When extending an animation whose stored count is 9, omit the field — the default matches.
- `custom_start_frame`: custom starting pose; the image dimensions become the canvas (≤256×256). Requires exactly one direction.
- `end_frame`: target pose to interpolate toward; dimensions must match the start frame. Requires exactly one direction.
- `enhance_prompt`: automatically expand `animation_description` (+0.05 generations); requires a description (cannot enhance an inherited one); the expanded text returns in `enhanced_prompt`.

Rules that produce confusing errors:
- **Do not pass `directions` for 1-direction objects** — they always animate the single view; passing it returns 400.
- `custom_start_frame` / `end_frame` need exactly one direction: for 8-direction objects the caller must state which one — ask the user, never pick or default to south.
- Re-animating a direction that already has an animation returns **409** unless `replace_existing=true`.
- New animation on an 8-direction object: omit `directions` to animate all 8 cardinals. Extending via `animation_group_id`: omit `directions` and the server fills in the missing cardinals.
- `frame_count` is per direction and need not match across directions. Pass the returned `animation_group_id` to add directions later.

`DELETE /objects/{object_id}/animations` removes animations by `animation_type` (display name) or `animation_group_id` — 400 when neither is supplied, 409 when a name matches multiple groups (pass the group id).

### Lifecycle

| Call | Note |
|---|---|
| `GET /objects` | paginated, `limit` 1–100 + `offset`, `total` is the unpaginated count |
| `GET /objects/{object_id}` | `rotation_urls` populated only for 4- and 8-direction objects; `frame_urls` holds review candidates; `progress_percent` / `eta_seconds` appear while incomplete; animations grouped under `animation_group_id` |
| `POST /objects/{object_id}/states` | text edit of an existing object; source must be completed; grouped via `group_id` |
| `DELETE /objects/{object_id}` | permanent — deletes the object and all associated data, rotations and tags included |
| `PATCH /objects/{object_id}/tags` | replaces all tags (set operation): max 20 tags, 50 chars each, trimmed and case-insensitively deduplicated |

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S tag Objects
node $S tag "Map Objects"
node $S flow /create-1-direction-object
node $S response /objects/{object_id}
```

## References

- `orchestrating-pixellab-jobs` — the 423/410 retrieval contract and the 200-vs-202 split
- `generating-pixellab-tilesets` — terrain, as opposed to things standing on terrain
- `animating-pixellab-sprites` — the shared animation vocabulary and mode costs
- `guarding-generation-cost` — why the family choice is a budget decision, not a style one
- `querying-pixellab-api` — how to interrogate the vendored spec before claiming anything
