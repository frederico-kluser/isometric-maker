---
name: generating-pixellab-characters
description: Picks between the four PixelLab character-creation endpoints, whose costs differ by up to 40x for the same request, and covers the character lifecycle - reference images per direction, canvas inflation, states, ZIP export, tags. Use whenever a task creates, rotates, inspects, exports or deletes a PixelLab character, or chooses between standard, pro and v3 generation - including Portuguese phrasings like "gerar o personagem", "criar o sprite do NPC", "as 8 direcoes", "qual modo usar", "baixar o personagem", "apagar o personagem", "imagem de referencia por direcao". Use it before writing any request body that creates a character. Triggers on create-character-with-4-directions, create-character-with-8-directions, create-character-pro, create-character-v3, create-character-state, character_id, template_id, mannequin, proportions.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Generating PixelLab characters

## When to use

Before creating a character, and before choosing which of the four creation endpoints to call. The
wrong choice is not a style difference — it is a bill between 1 and 40 generations for the same
sprite.

## Injected knowledge

### Five endpoints that all produce "a character with 8 directions"

Query them, do not recall them:

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S tag "Character from template"
node $S endpoint /create-character-v3
node $S flow /create-character-v3
```

| Endpoint | Size range | Cost order | What it ignores |
|---|---|---|---|
| `/create-character-v3` (reference_image) | 32–256 (schema floor); desc mentions 16–256 for from-scratch, may route via Pixen first | ceil(w×h×8 / 65536) gen | `outline`, `detail` |
| `/create-character-v3` (from-scratch) | 32–256 (schema); 16–256 in endpoint prose — contradiction not yet resolved | 1 + ceil(s²×8 / 65536) gen | — |
| `/create-character-with-8-directions` `mode='standard'` | 16–128 | 1 generation | — |
| `/create-character-with-8-directions` `mode='pro'` | 16–128 | 20–40 generations | `outline`, `shading`, `detail`, `proportions`, `text_guidance_scale` |
| `/create-character-pro` | 32–168 | 20–40 generations | style-hint fields; takes `style_description` |
| `/create-character-with-4-directions` | 16–128 | cheapest | — |

`create-character-v3` is the project's backbone since 2026-07-31 — it replaces the 8-directions
endpoint in the character-builder wizard. The reference_image mode takes a south-facing sprite and
rotates it into 8 directions directly, collapsing the old cardinals step.

`/create-character-v3` is the only one whose cost is a published formula rather than a table:
`ceil(w*h*8 / 65536)` generations with a reference image, and `1 + ceil(s*s*8 / 65536)` from scratch
where `s = max(width, height)`. Treat every resulting number as a **preço estimado**
(`docs/01-pixellab/custos-e-limites.md:59@fe52f3d5`).

### All four are asynchronous, and none of them says 202

This is the trap that loses paid generations. All four return **`200`** with a `background_job_id`
in the body — not `202`. Code that branches on the status code to decide "did I get an image or a
job?" will read `image` off a body that has no image, discard the job id, and pay again.

```bash
node $S list --async | grep '200\*'    # the 13 async endpoints that answer 200
```

`character_id` comes back immediately, before any rotation exists. Persist it **before** the first
poll: the money left at submit, and the id is the only way back to the artefact.

### The canvas is not the size you asked for — and the factor differs per endpoint

Three different inflation rules coexist, and using the wrong one crops heads off:

- `/create-character-v3` (both modes): final canvas padded **~2x** for animation room, capped at 256
  (per endpoint description: "Final canvas is padded ~2x for animation room (capped at 256).").
  In reference_image mode `image_size` is advisory — the model picks the output size.
- `/create-character-with-8-directions` inflates by **~40%** — ask 64×64, get roughly 90×90
  (`tools/pixellab-pipeline/src/endpoints.ts:80@7e700048`).
- `/create-character-pro` pads the persisted canvas to **~2x** the requested frame size.

Crop against the returned metadata, never against the requested value.

### v3 reference_image: one image, eight rotations

`create-character-v3` with `reference_image` takes a single south-facing sprite (max 256×256,
base64) and rotates it into 8 directions. `outline` and `detail` are **ignored** when
`reference_image` is present — the spec says so explicitly. `template_id` picks the 3D skeleton
template the estimator fits to the generated frames (six values in the spec:
`mannequin` (biped, default), `bear`, `cat`, `dog`, `horse`, `lion` for quadrupeds).
**Must match the body type in `reference_image`.** `view` sets
the camera angle: `low top-down`, `high top-down`, or `side`.

`name` is the display name and defaults to the first 50 characters of `description` when omitted
or `null`. There is no need to pass it separately unless you want a different label from the
prompt text.

The old `directions` map (frozen cardinals) from the 8-directions endpoint does not exist on
v3 — the model handles rotation internally.

### Response: dictionary, never an array; v3 returns both `character_id` and `background_job_id`

All character endpoints return frames keyed by direction name (e.g. `rotation_urls.south`,
`rotation_urls.south-west`). Index by direction name, never by position — there is no array
whose order you could be reading.

`create-character-v3` returns both `character_id` and `background_job_id` in the 200 response
body. The character row is created immediately with `status='processing'` and transitions to
`completed` once frame generation, upload, and 3D skeleton reconstruction finish. Persist the
`character_id` before the first poll — it is the only key back to the artefact.

### Reference images per direction have rules the spec states only in prose

Optional `directions` map, `mode='standard'` only:

- Missing directions are generated; provided ones are frozen and used as-is.
- Each image's dimensions must match `image_size` **exactly**, or 422.
- Bipedal templates require `south` if any reference is given. Quadruped templates
  (`bear`, `cat`, `dog`, `horse`, `lion`) additionally require `east`.
- When references are provided, `proportions` and bone scaling are **ignored** — the images drive
  the pose. Passing both is not an error; the proportions simply do nothing.

`template_id` defaults to `mannequin`. `proportions` applies to humanoids only.

### Perspective must be passed explicitly, every time

The camera enum is `CameraView` = side, low top-down, high top-down

The project uses `low top-down` everywhere
(`docs/adr/0005-low-top-down-8-direcoes.md:19@0f447499`). It is the default on the character
endpoints but **not** on every endpoint the same character has to sit next to — omit it on a tileset
call and the terrain lands in a different projection from the sprite.

### The style hints depend on the endpoint

On `create-character-v3`: `outline` and `detail` are soft hints that only apply in **from-scratch**
mode (no `reference_image`). They are **ignored** when a reference image is provided.
`shading` and `text_guidance_scale` do **not exist** on the v3 endpoint — they are v2-only
parameters that were not carried forward.

On `create-character-with-8-directions`: `outline`, `shading` and `detail` are documented as
"soft guidance — the model may not follow exactly". They are plain strings, not enums, so a typo
is accepted silently and simply has no effect.

Worse: the character endpoints' prose lists the detail options as low / medium / **high** detail,
while the spec's named `Detail` enum ends in `highly detailed`. The tileset and image endpoints
enforce the enum. Copying the character endpoint's wording into a tileset request is a 422.

### Lifecycle: the parts that fail after generation succeeded

| Call | The catch |
|---|---|
| `GET /characters/{character_id}` | `rotation_urls` is **null unless `status == 'completed'`** — polling the job is not optional |
| `GET /characters/{character_id}/zip` | returns **423** while anything is still generating, including animations |
| `POST /create-character-state` | source must be completed; result is grouped with the source via `group_id` |
| `DELETE /characters/{character_id}` | permanent, and takes every animation with it |
| `PATCH /characters/{character_id}/tags` | **replaces** all tags; max 20 tags, 50 chars each |
| `POST /characters/{character_id}/portrait` | **free**, no generation runs |

The ZIP is the cheapest way to get everything at once: `rotations/`, `animations/`, and a
`metadata.json` carrying keypoints for every frame — which is what makes pixel-accurate collision
possible without re-deriving it.

## References

- `querying-pixellab-api` — the spec-query discipline and the traps that apply to every endpoint
- `rotating-pixellab-sprites` — turning an existing sprite into 8 views without recreating it
- `animating-pixellab-sprites` — what to do with `character_id` once rotations exist
- `orchestrating-pixellab-jobs` — polling, the 200-vs-202 split, retry codes
- `guarding-generation-cost` — the plan → estimate → generate order that keeps this affordable
