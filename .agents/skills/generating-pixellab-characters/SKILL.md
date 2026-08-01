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

### Four endpoints that all produce "a character with 8 directions" — six rows, because v3 and the 8-directions endpoint appear once per mode

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

`create-character-v3` with `reference_image` takes a single south-facing sprite (max 256×256)
and rotates it into 8 directions. `reference_image` is a `Base64Image` **object** —
`{type:'base64', base64, format:'png'}` — not a bare base64 string; only `base64` is required,
the other two fields carry schema defaults. `image_size` is likewise an object,
`V3OutputImageSize` `{width, height}`, both required integers 32–256 — while the endpoint prose
still claims 16–256 for from-scratch, a contradiction inside the spec itself that stays open.
`outline` and `detail` are **ignored** when `reference_image` is present — the spec says so
explicitly. `template_id` picks the 3D skeleton
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

`enhance_prompt` (v3, from-scratch only) is a second bill line, not a free switch: it costs an
**additional 0.05 generations**, returned separately from generation `usage` as `enhance_usage`,
with the expanded text in `enhanced_prompt`. Combined with `reference_image` the API answers
**422** — the field description says so, and the character-builder refuses the pair before
spending (`tools/character-builder/server/sprite-lab.ts:218@eb6f3fe7`).

On `create-character-with-8-directions`: `outline`, `shading` and `detail` are documented as
"soft guidance — the model may not follow exactly". They are plain strings, not enums, so a typo
is accepted silently and simply has no effect.

### PixelLab's own MCP advertises a v3 that does not exist

The vendor's MCP surface exposes a **single** `create_character` tool whose signature is a superset:
it accepts `proportions`, `text_guidance_scale`, `n_directions` and `shading` alongside a `mode`
parameter taking `"standard"`, `"pro"` or `"v3"`, and states that those four are *ignored* under
`mode="v3"`.

The REST schema does not work that way. `CreateCharacterV3Request` declares
`additionalProperties: false` over eleven fields, and none of those four is among them — they are
**rejected**, not ignored. An agent that reads the MCP documentation and writes a REST body from it
produces a request the API refuses.

This is the most reachable wrong answer about v3, because the wrong source is the vendor's own. The
rule from `querying-pixellab-api` applies at full strength: the vendored spec is the only source, and
a vendor page that contradicts it loses.

### `template_id` selects a skeleton, never a style

Open string, default `mannequin`, documented values `mannequin`, `bear`, `cat`, `dog`, `horse`,
`lion`. The spec says it "picks the 3D template the skeleton estimator fits to the generated frames
so the character can be animated", and that it "must match the body type in `reference_image`".
Passing `bear` to make the art bear-like does nothing to the art and mis-fits the skeleton.

`mannequin` is a **value**, never a parameter name. A body containing `"mannequin": true` is invalid.

### The open risk this endpoint carries

`/animate-character` describes itself as animating characters "previously created using the
create-character-with-4-directions or create-character-with-8-directions endpoints", and its
**Character Requirements** repeat that the character "must have been created with 4 or 8 directions".
`create-character-v3` is named in neither place — yet its own `template_id` exists so that "the
character can be animated", and it returns a `character_id`.

The studio already bets on one side of that contradiction. **No paid call has settled it.** If the
prose is right, the character pipeline breaks after generation with the money already spent. Do not
present v3 → `/animate-character` as verified; see `docs/adr/0019-create-character-v3-e-o-caminho-do-personagem.md`.

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

### 429 is documented; its number is not

The v3 response list includes `429 Concurrency limit reached`, but no spec field, skill, or
pipeline module documents **how many** concurrent jobs trip it. The Sprite Studio's ceiling of
4 parallel v3 submissions is a **project decision**, not an API fact
(`tools/character-builder/server/sprite-lab.ts:170@eb6f3fe7`) — never quote 4 back to a user as
a documented API limit.

### The character-builder Sprite Studio pipeline (repo flow, not API shape)

The studio's Laboratório is a v3 workbench (`server/sprite-lab.ts` in `tools/character-builder`):
it fires N parallel `create-character-v3` submissions (1–4, deterministic seeds base+i) with
every knob of the endpoint exposed, then keeps only the `south` frame of each candidate — the
endpoint always produces all 8 directions, and the other 7 land on disk as byproduct. The
workbench exports a `sprite-lab-south` JSON client-side; the wizard imports **only**
`sprite-lab-south` or `sprite-wizard-directions` bundles — any other `kind` is refused by name
(`tools/character-builder/server/sprite-bundle.ts:5@3da6fb26`) — continues to the 8 directions
through the v3 reference mode, and exports everything back as base64 JSON. Poses and wardrobe
import the wizard bundle as a derived character.

Reading the frames of a v3 job goes through one parser
(`tools/character-builder/server/frames.ts:76@da9dd168`): `last_response.images` (new format) or
`rotation_urls` (old) — a dictionary keyed by direction name, with all 8 canonical keys
mandatory. `storage_urls` wins over inline base64; `skeletons` only becomes a boolean flag; the
south pose is `frames['south'][0]`. Keying by name, never by index, is what keeps east and west
from being silently swapped.

## References

- `querying-pixellab-api` — the spec-query discipline and the traps that apply to every endpoint
- `rotating-pixellab-sprites` — turning an existing sprite into 8 views without recreating it
- `animating-pixellab-sprites` — what to do with `character_id` once rotations exist
- `orchestrating-pixellab-jobs` — polling, the 200-vs-202 split, retry codes
- `guarding-generation-cost` — the plan → estimate → generate order that keeps this affordable
