---
name: composing-pixellab-objects
description: Covers PixelLab objects and map objects - two families that both make props but differ by more than ten times in price, plus the review status that holds generated candidates hostage until frames are selected or dismissed. Use whenever a task creates a prop, barrel, chest, torch, corpse, furniture or scenery item, animates an object, or lists and deletes objects - including Portuguese phrasings like "gerar o bau", "criar os objetos do mapa", "props do cenario", "objeto de 8 direcoes", "objeto visto de varios angulos", "escolher os frames", "estado do objeto", "apagar o objeto". Triggers on create-1-direction-object, create-8-direction-object, map-objects, select-frames, dismiss-review, object_id, review status, group_id, rotation_urls.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Composing PixelLab objects

## When to use

Before generating any prop. The two families that make props look interchangeable and are not: one
costs roughly ten to twenty times the other for a barrel that ends up looking the same.

## Injected knowledge

### Pick the family before the parameters

| Need | Endpoint | Cost order |
|---|---|---|
| A prop for a map, seen from one angle | `/map-objects` | cheapest by a wide margin |
| A standalone prop, one direction | `/create-1-direction-object` | **20–40 generations** |
| A prop seen from 8 angles | `/create-8-direction-object` | **20–40 generations** |

Object generation uses the Pro Tools and the spec states the 20–40 figure inline on both object
endpoints. For map props — barrel, torch, chest, corpse — `/map-objects` is the right call and the
repo says so explicitly (`docs/01-pixellab/custos-e-limites.md:31@0c85bc2b`). Reserve
`/create-8-direction-object` for the handful of objects that genuinely need eight angles.

Sizes differ and the ceilings are not arbitrary: `/create-1-direction-object` takes 32–256,
`/create-8-direction-object` only **32–168** because the 8-rotation pipeline rejects anything larger,
and `/map-objects` takes 32–400 — dropping to a 192×192 area when inpainting is used
(`tools/pixellab-pipeline/src/endpoints.ts:160@08e4ea43`).

### The review status is a trap you can leave money sitting in

`/create-1-direction-object` may produce **several candidate frames** — how many is derived from
`size`, and the response tells you in `n_frames`. When there is more than one, the object lands in
**`review`** status and nothing is finished. You must then either:

- `POST /objects/{object_id}/select-frames` with 0-based `indices` — each selected frame is promoted
  to its own completed object, returned in `created_object_ids`; or
- `POST /objects/{object_id}/dismiss-review` to discard all of them.

A single candidate is kept automatically. Until one of those two calls happens, `rotation_urls` is
empty and the candidates live only in `frame_urls` / `storage_urls` under `frame_N` keys. The
generations were already paid for. Code that polls for `completed` and never handles `review` will
wait forever on work it already bought.

Object status values are `pending`, `processing`, `completed`, `review`, `failed` — five, not three.

### Map objects expire in 8 hours

`GET /map-objects/{object_id}` answers **423** with `Retry-After` while generating, **410** when it
failed permanently, and `200` with a `download_url` when done. That URL is no-auth and the artefact
**auto-deletes 8 hours after creation** (`tools/pixellab-pipeline/src/api.ts:196@314e8627`). Download
the PNG; do not store the link.

Map objects are also the only prop family that can be generated **into** an existing scene:
`background_image` plus an `inpainting` config (custom mask, or auto-generated oval or rectangle)
makes the prop match the map it will sit on. `background_image` is required whenever inpainting is used.

### Reference image and style image are mutually exclusive

On `/create-8-direction-object`, `reference_image` rotates *that exact object* into 8 views, while
`style_image` generates a *new* object matching the description in that style. Passing both is
rejected. On `/create-1-direction-object`, `style_images` and `size` are mutually exclusive — the
output size is derived from the largest style image instead.

### Object animation defaults to the cheaper mode, unlike characters

`POST /objects/{object_id}/animations` takes `mode` ∈ pro, v3 and defaults to **`v3`**, with the cost
warning stated inline: `pro` costs 20–40 generations per direction, 160–320 for a full eight. Unlike
the character route, the good default is already the default here — do not "improve" it to `pro`.

Two rules that produce confusing errors:

- **Do not pass `directions` for 1-direction objects.** They always animate the single view.
- Re-animating a direction that already has an animation returns **409** unless
  `replace_existing=true`.

`frame_count` is per direction and does **not** need to match across directions of the same
animation. Pass the returned `animation_group_id` to add more directions to an existing animation
later.

### Lifecycle

| Call | Note |
|---|---|
| `GET /objects` | paginated, `limit` 1–100, `total` is the unpaginated count |
| `GET /objects/{object_id}` | `rotation_urls` is populated only for 4- and 8-direction objects; `progress_percent` and `eta_seconds` appear while incomplete |
| `POST /objects/{object_id}/states` | text edit of an existing object, grouped with the source via `group_id`; source must be completed |
| `DELETE /objects/{object_id}` | permanent, takes rotations and tags with it |
| `PATCH /objects/{object_id}/tags` | replaces all tags, max 20, 50 chars each |

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S tag Objects
node $S flow /create-1-direction-object
node $S response /objects/{object_id}
```

Both object creation endpoints and `/objects/{object_id}/states` are asynchronous while answering
**`200`**, and `/map-objects` does the same — none of the four says `202`.

## References

- `orchestrating-pixellab-jobs` — the 423/410 retrieval contract and the 200-vs-202 split
- `generating-pixellab-tilesets` — terrain, as opposed to things standing on terrain
- `animating-pixellab-sprites` — the shared animation vocabulary and mode costs
- `guarding-generation-cost` — why the family choice is a budget decision, not a style one
