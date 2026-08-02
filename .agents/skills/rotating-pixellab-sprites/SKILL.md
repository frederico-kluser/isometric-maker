---
name: rotating-pixellab-sprites
description: Owns the PixelLab rotation endpoints — led by /generate-8-rotations-v3, the go-to rotator — and the direction-ordering problem that produces sprites facing the wrong way with no error at all: three orderings coexist in the same API, only v2's is a documented return order, and v3 answers 200 but is asynchronous, returning frames keyed by direction name. Use whenever a task turns an existing sprite to face another direction, generates the eight views of an image that already exists, or names rotation frames — including Portuguese phrasings like "girar o sprite", "gerar as rotacoes dessa imagem", "as oito direcoes", "virar o personagem pra leste", "em que ordem vem os frames", "ordem das direcoes", "mudar o angulo da camera". Use it before naming or indexing any rotation frame. Triggers on rotate, generate-8-rotations-v3, generate-8-rotations-v2, from_direction, to_direction, view_change, direction_change, DIRECTIONS_8.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Rotating PixelLab sprites

## When to use

Before rotating anything, and — more importantly — before writing the loop that
names or indexes the returned frames. Getting the order wrong makes characters
walk sideways and raises no error anywhere in the stack.

The go-to endpoint is `/generate-8-rotations-v3`: strictly a rotator, one
`first_frame` in, 8 frames out.

## Injected knowledge

### Primary endpoint: `/generate-8-rotations-v3`

`Generate8RotationsV3Request` — only `first_frame` is required:

| Field | Type | Notes |
|---|---|---|
| `first_frame` | `Base64Image` (PNG/JPEG base64), required | max **256×256** pixels |
| `description` | string ≤ 2000, optional | consistency hint: "the subject is always analyzed from the reference frame; this text is taken into account as an extra hint" |
| `no_background` | boolean, optional | "Remove background from generated frames" |
| `seed` | integer ≥ 0, optional, default 0 | 0 = random; the only reproducibility lever |

There is **no `method` field** — v3 is strictly a rotator, unlike v2 whose
`method` ∈ rotate_character, create_with_style, create_from_concept. There is
also no `image_size` and no `view`: the model derives the output size from the
input (`V3OutputImageSize`, 32–256, is advisory).

Response — `Generate8RotationsV3Response` — comes back under status **`200`**
with `background_job_id` (required) and `status` (processing, completed,
failed). **The 200 is a trap: the endpoint is asynchronous.** Branch on the
presence of `background_job_id`, never on the status code. Poll the job
(`GET /background-jobs/{job_id}`) every 2–5 seconds; typical generation time is
30–180 seconds. When `status` is `completed`, the 8 frames are at
`last_response.images`.

**Neither persists a character**: v3 returns frames only — no
`character_id` — and v2 is the same. If you want the result stored, animatable
and listable, use `/create-character-pro` with `method='rotate_character'` or
`/create-character-v3` with a `reference_image` — both run the same rotation and
keep the result as a character.

The money leaves at the POST itself — losing the `background_job_id` returns
nothing.

### Direction ordering — the critical trap

Three direction orderings coexist in the same API:

| Source | Order |
|---|---|
| Spec enum `Direction` | north, north-east, east, south-east, south, south-west, west, north-west |
| Inline `directions` keys on `/create-character-with-8-directions` | south, south-east, east, north-east, north, north-west, west, south-west |
| **Return order of `/generate-8-rotations-v2`** (the only one that declares one) | **S, SW, W, NW, N, NE, E, SE** |

`/generate-8-rotations-v2` states its output order explicitly: "Returns 8 images
in order: South, South-West, West, North-West, North, North-East, East,
South-East". That is the project's canonical frame-naming order
(`tools/pixellab-pipeline/src/endpoints.ts:49@7e700048`,
`docs/adr/0005-low-top-down-8-direcoes.md:25@0f447499`).

**v3 makes no positional promise**: the frames arrive at `last_response.images`
keyed by direction name — a dictionary, not a positional array. ALWAYS index by
direction name, never by position. The vendored spec does not pin the shape
(`last_response` is an open object); the keyed shape is the endpoint's observed
behavior, and ADR 0005's wording ("`generate-8-rotations-v3` devolve os frames
em S, SW, …") predates the dict-shaped response.

Indexing frames by the enum's position is the single most reproducible way to
ship a broken sprite.

### The other two rotation endpoints (brief)

| Endpoint | Input | Output | Sync? | Notes |
|---|---|---|---|---|
| `/generate-8-rotations-v3` | `first_frame` (Base64Image, max 256×256) | 8 frames | async, answers **200** | **the go-to rotator** — no `method` |
| `/generate-8-rotations-v2` | reference, concept or description via `method` | 8 images | async, `202` | rotator and creator; exists, but v3 is preferred for pure rotation |
| `/rotate` | one image + from/to direction and view | **one** rotated image | **synchronous** | single-frame rotator + view-change; kept for reference |

`/rotate` is the only one that changes **camera view** as well as facing. Both
`from_view` and `to_view` take `CameraView` = side, low top-down, high top-down.
It also exposes `view_change` (−90..90 degrees of tilt) and `direction_change`
(−180..180 of turn) as an alternative to naming directions.

The vendor's guide warns that changing camera view is "not something the model
has been trained to do" and results are unreliable. That wording is not in the
vendored spec's `/rotate` description — treat it as unverified against the
current spec. The practical advice is the same either way: rotating within one
view works; tilting between views is a gamble.

### v2 and v3 are not versions of each other

Same name, different jobs. v2 takes a `method` ∈ rotate_character,
create_with_style, create_from_concept, so it can also **create** a character
from scratch, not just rotate one, and it accepts `description`,
`style_description` and `concept_image`. v3 is strictly a rotator. Prefer v3 for
pure rotation; reach for v2 (or the character endpoints) when the task is
creation, not rotation.

### Sizes are three different ranges for the same conceptual operation

- `/rotate`: 16–200 (the spec lists 16/32/64/128)
- `/generate-8-rotations-v2`: **32–168** (`image_size` 32–168, `reference_image` max 168×168)
- `/generate-8-rotations-v3`: `first_frame` up to **256×256** (`V3OutputImageSize` 32–256)

There is no global size rule in this API — `ImageSize` is namespaced per
endpoint. Quoting one endpoint's range as if it were the family's is wrong for
two of the three.

### `/rotate` has an unusual retry surface

Being synchronous, it answers **`529` Rate limit exceeded** alongside `429`.
`529` is non-standard and absent from most clients' transient-error lists
(`tools/pixellab-pipeline/src/api.ts:20@55dd790d`).

### Rotation is not free, and re-rotating is not idempotent

Each call is a paid generation and `seed` is the only lever that makes a result
reproducible. Re-running without a fixed seed produces a different sprite and a
second charge — which is why the pipeline hashes decoded pixels rather than
trusting that "the same request gives the same image".

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S endpoint /generate-8-rotations-v3
node $S flow /generate-8-rotations-v3
node $S tag Rotate
node $S enums Direction
```

## References

- `generating-pixellab-characters` — creating rotations as part of a persisted character instead
- `animating-pixellab-sprites` — what consumes the frame order downstream
- `orchestrating-pixellab-jobs` — the 200-vs-202 split and the retry codes
- `querying-pixellab-api` — the per-endpoint size namespacing behind the three ranges above
