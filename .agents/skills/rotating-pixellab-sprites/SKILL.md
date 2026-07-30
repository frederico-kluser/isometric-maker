---
name: rotating-pixellab-sprites
description: Owns the three PixelLab rotation endpoints and the direction-ordering problem that produces sprites facing the wrong way with no error at all - three orderings coexist in the same API and only one is the return order. Use whenever a task turns an existing sprite to face another direction, generates the eight views of an image that already exists, or names rotation frames - including Portuguese phrasings like "girar o sprite", "gerar as rotacoes dessa imagem", "as oito direcoes", "virar o personagem pra leste", "em que ordem vem os frames", "ordem das direcoes", "mudar o angulo da camera". Use it before naming or indexing any rotation frame. Triggers on rotate, generate-8-rotations-v2, generate-8-rotations-v3, from_direction, to_direction, view_change, direction_change, DIRECTIONS_8.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Rotating PixelLab sprites

## When to use

Before rotating anything, and — more importantly — before writing the loop that names or indexes the
returned frames. Getting the order wrong makes characters walk sideways and raises no error anywhere
in the stack.

## Injected knowledge

### Three direction orderings coexist. Only one is the return order.

| Source | Order |
|---|---|
| Spec enum `Direction` | north, north-east, east, south-east, south, south-west, west, north-west |
| Inline `directions` keys on the 8-direction character endpoint | south, south-east, east, north-east, north, north-west, west, south-west |
| **Return order of `/generate-8-rotations-v2`** (the only one that declares one) | **S, SW, W, NW, N, NE, E, SE** |

`/generate-8-rotations-v2` states its output order explicitly: "Returns 8 images in order: South,
South-West, West, North-West, North, North-East, East, South-East". That is the project's canonical
frame-naming order (`tools/pixellab-pipeline/src/endpoints.ts:45@b6e61f99`,
`docs/adr/0005-low-top-down-8-direcoes.md:25@0f447499`).

The named `Direction` enum starts at north and runs clockwise; the request-side map on the character
endpoint starts at south and runs the other way round the circle. Neither is the response order.
Indexing frames by the enum's position is the single most reproducible way to ship a broken sprite.

### The three endpoints do different jobs

| Endpoint | Input | Output | Sync? |
|---|---|---|---|
| `/rotate` | one image + from/to direction and view | **one** rotated image | **synchronous** |
| `/generate-8-rotations-v2` | reference, concept or description | 8 images | async, `202` |
| `/generate-8-rotations-v3` | `first_frame` only | 8 frames | async, answers **`200`** |

`/rotate` is the only one that changes **camera view** as well as facing. Both `from_view` and
`to_view` take `CameraView` = side, low top-down, high top-down

It also exposes `view_change` (−90..90 degrees of tilt) and `direction_change` (−180..180 of turn)
as an alternative to naming directions.

The vendor's own guide warns that changing camera view is "not something the model has been trained
to do" and results are unreliable. Rotating within one view works; tilting between views is a gamble.

### Sizes are three different ranges for the same conceptual operation

- `/rotate`: 16–200
- `/generate-8-rotations-v2`: **32–168**
- `/generate-8-rotations-v3`: `first_frame` up to **256×256**

There is no global size rule in this API — `ImageSize` is namespaced per endpoint. Quoting one
endpoint's range as if it were the family's is wrong for two of the three.

### v2 and v3 are not versions of each other

`/generate-8-rotations-v2` takes a `method` ∈ rotate_character, create_with_style,
create_from_concept — so it can also **create** a character from scratch, not just rotate one, and it
accepts `description`, `style_description` and `concept_image`.

`/generate-8-rotations-v3` takes only `first_frame`, an optional `description` to improve consistency,
`no_background` and `seed`. It is strictly a rotator. It also documents its own polling cadence
(every 2–5 seconds) and a typical generation time of 30–180 seconds.

Neither persists a character. If you want the result stored, animatable and listable, use
`/create-character-pro` with `method='rotate_character'` or `/create-character-v3` with a
`reference_image` — both run the same rotation and keep the result as a character.

### v3 answers 200 while being asynchronous

`/generate-8-rotations-v3` returns `background_job_id` under status **`200`**, not `202`. Frames
arrive at `last_response.images` on the background job. Branch on the presence of
`background_job_id`, never on the code.

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S tag Rotate
node $S flow /generate-8-rotations-v3
node $S enums Direction
```

### `/rotate` has an unusual retry surface

Being synchronous, it answers **`529` Rate limit exceeded** alongside `429`. `529` is non-standard
and absent from most clients' transient-error lists
(`tools/pixellab-pipeline/src/api.ts:20@314e8627`).

### Rotation is not free, and re-rotating is not idempotent

Each call is a paid generation and `seed` is the only lever that makes a result reproducible.
Re-running without a fixed seed produces a different sprite and a second charge — which is why the
pipeline hashes decoded pixels rather than trusting that "the same request gives the same image".

## References

- `generating-pixellab-characters` — creating rotations as part of a persisted character instead
- `animating-pixellab-sprites` — what consumes the frame order downstream
- `orchestrating-pixellab-jobs` — the 200-vs-202 split and the retry codes
- `querying-pixellab-api` — the per-endpoint size namespacing behind the three ranges above
