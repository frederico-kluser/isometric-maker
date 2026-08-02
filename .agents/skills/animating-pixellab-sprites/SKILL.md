---
name: animating-pixellab-sprites
description: Covers the PixelLab v3 animation endpoints — /animate-with-text-v3 (text + first frame → async background job), /enhance-animation-v3-prompt (action-prompt enrichment), and v3 mode on characters and objects — plus no-v3-alternative endpoints (/animate-with-skeleton, /estimate-skeleton, deletes), and the traps: mode='pro' costs 160-320 generations for eight directions yet the API says it usually produces lower quality; v3 answers 200, not 202, though async; frame count explicit 4-16 even on v3, by image size on v2. Use whenever animating a character or object, picking a mode, setting a frame count, interpolating poses, enhancing an action prompt, transferring an outfit, or estimating a skeleton — including Portuguese phrasings like "animar o personagem", "quantos frames", "interpolar entre poses", "trocar a roupa", "esqueleto do personagem". Triggers on animate-with-text-v3, enhance-animation-v3-prompt, animate-character, animate-with-skeleton, estimate-skeleton, template_animation_id, frame_count, mode=pro.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Animating PixelLab sprites

## When to use

Before animating anything. Animation is where this API's cost curve is steepest: the same eight
directions cost 8 generations or 320 depending on one string field. v3 is the current engine and the
default everywhere; the v1 and v2 text-animation endpoints are legacy.

## Injected knowledge

### v3 is the engine: `/animate-with-text-v3`

`POST /animate-with-text-v3` turns one image plus an action sentence into an animation. Verified
request shape:

| Field | Type / rules |
|---|---|
| `first_frame` | Base64Image, **required** — PNG/JPEG base64, max **256×256** px |
| `action` | string, **required**, 1–1000 chars |
| `last_frame` | optional Base64Image, max 256×256 — providing it switches to **interpolation** mode |
| `frame_count` | int 4–16, **must be even**, default 8 |
| `seed` | int ≥ 0, default 0 (0 = random) |
| `no_background` | bool — remove background from generated frames |
| `drift_threshold` | number ≥ 0 — color de-flicker sensitivity: frames whose foreground drifts from the first frame beyond this are corrected toward it; 0 corrects every frame, higher values correct fewer. Omit for the default. |
| `enhance_prompt` | bool, default false — see below |

Constraints:

- Canvas max **256×256** (`first_frame` and `last_frame`).
- Pixel budget: `width × height × frame_count ≤ 524288` — 128×128 with 16 frames is rejected after
  you have already built the request (`tools/pixellab-pipeline/src/endpoints.ts:200@7e700048`).
- Frame-count guidance from the spec: 4 = simple loops (idle, breathing), 8 = standard (walk, run),
  16 = complex (attack combos).

**Async despite 200.** The response is `AnimateWithTextV3Response` with `background_job_id` +
`status` (`processing`), and the endpoint answers **200, not 202**. Poll
`GET /background-jobs/{job_id}`; the frames arrive in `last_response.images[]`. One job covers the
whole animation (unlike character animation, which queues one job per direction).

**`enhance_prompt=true` is a separate charge.** It auto-expands `action` into a richer motion
description before generating — the spec's own text says it is equivalent to calling
`/enhance-animation-v3-prompt` with the same frames first — and costs an additional **0.05
generations**. The response carries `enhanced_prompt` and `enhance_usage` **separately** from the
generation's `usage`. Write the rich text yourself and leave it false to stay at one charge; pay the
extra only when the action text is thin.

Two modes:

- **Single-frame**: `first_frame` only; motion is invented from `action`.
- **Interpolation**: also pass `last_frame`; the model animates between the two poses.
### The prompt enhancer: `/enhance-animation-v3-prompt`

`POST /enhance-animation-v3-prompt` returns a richer motion description meant for the `action` field
of `/animate-with-text-v3`. **Synchronous, no job**: the 200 carries `enhanced_prompt` directly
(plus `usage`). Two modes mirror the animate endpoint: single-frame (`first_frame` only) and
interpolation (also `last_frame`, describing the transition between the two poses).

| Field | Type / rules |
|---|---|
| `first_frame` | Base64Image, **required** — basis of the motion description |
| `last_frame` | optional Base64Image — when present, the description covers the interpolation between the two poses |
| `action` | string, **required**, 1–500 chars (the animate endpoint accepts 1000; this one caps at 500) |

The description is grounded in the visible content (pose, props, orientation, clothing) and does not
introduce camera moves, cuts, or new objects unless explicitly requested.

### v3 on characters and objects

`POST /characters/animations` and `POST /animate-character` share `CreateCharacterAnimationRequest`.
`mode` is **auto-detected: v3 when `template_animation_id` is omitted**, template when it is present.
On objects, `POST /objects/{object_id}/animations` takes `mode` enum `["pro","v3"]` with **v3 as the
default**.

v3-mode fields (characters and objects):

- `frame_count` — 4–16, even, default 8. On characters it is used only in v3 mode; template mode
  uses the template's own count.
- `keep_first_frame` — default true: the input reference frame is stored as frame 0, so
  `frame_count=8` stores **9** frames. Set false to store exactly `frame_count` generated frames.
- `custom_start_frame` — replaces the character's rotation image (or the object's idle frame) as the
  start pose. **Requires exactly one direction.**
- `end_frame` — target pose; providing it enables interpolation mode. **Requires exactly one
  direction.** On 8-direction objects the API tells callers to ask the user which direction, not to
  pick one or default to south.
- `enhance_prompt` — v3 only (422 with template/pro on characters); +0.05 generations; the same
  enhanced description is reused across all requested directions; on objects it requires
  `animation_description` (cannot enhance an inherited one).

`directions` defaults differ by mode: **template animates every direction the character has; v3
defaults to south only**. Omitting it in template mode buys eight animations when you wanted one;
omitting it in v3 mode delivers one when you needed eight. Since v3 is the auto-detected default,
the second trap is reachable without ever setting `mode`.

Character v3 queues **one job per direction** — eight directions is eight jobs, eight ids to persist,
and eight chances to lose a paid generation. The response returns `background_job_ids` (plural) and
`directions` — zip them. (World-block animation via `/animate-with-text-v3` is different: one job
for all frames.)

### The mode trap: `pro` costs 160–320 and is worse

| `mode` | Cost | Needs |
|---|---|---|
| `template` | **1 generation per direction** | `template_animation_id` |
| `v3` | scales with size and frames | `action_description` |
| `pro` | **20–40 per direction — 160–320 for all eight** | `action_description` |

The project's default is `template` and `pro` is refused without a recorded decision
(`docs/adr/0006-animacao-em-template-mode.md:5@554b0d42`). The API's own text says `pro` "usually
produces **lower** quality" than `v3` while costing far more — so the expensive mode is also the
worse one. On objects, `pro` is also capped by canvas: ≤ 64 px → 16 frames only; ≤ 128 px → 4, 9 or
16; ≤ 170 px → 9 only; larger than 170 px → pro is not supported, use v3.
### `template_animation_id` cannot be enumerated from the spec

The field is a plain string with **no enum**; its description lists ten ids and then truncates with
`...`: `angry`, `attack`, `attack-back`, `attack-left`, `attack-right`, `backflip`, `bark`,
`breathing-idle`, `cross-punch`, `crouched-walking`. The full list is not derivable — do not state a
total and do not claim an id exists without testing it. The three the catalog uses are inside the
visible prefix and are safe: `breathing-idle`, `crouched-walking`, `attack`
(`tools/pixellab-pipeline/assets/catalog.ts:37@3d8a40c6`).

### Frame count: explicit on v3, decided by image size on v2

- `/animate-with-text-v3`: `frame_count` 4–16, even, default 8 — explicit, under the pixel budget.
- `/animate-with-text-v2` (legacy, Pro): **no frame-count parameter at all**. The count follows the
  size: 32×32 and 64×64 return **16** frames; 128, 170 and 256 return **4**.
- `/animate-with-text` (v1, **deprecated** — prefer v3): `n_frames` 2–20 with default 4, and its own
  description says "the model will always generate 4 frames" — the parameter does not do what it
  says. It also accepts **only 64×64**, exactly.
- `/animate-with-skeleton`: `skeleton_keypoints` requires **exactly 3 frames** — a three-frame
  window model; any other count is rejected with a 422.
- `/edit-animation-v2` and `/transfer-outfit-v2` (Pro/v2, kept — no v3 alternative): `frames` array
  of 2–16 items. They edit an existing sequence rather than producing one — a consistent text edit
  across all frames, or an outfit lifted from a reference onto every frame. Neither preserves the
  character record; they take and return loose frames.

### Interpolation across the family

Three ways to animate between two poses:

- `/animate-with-text-v3` with `last_frame` — the dedicated, non-Pro path.
- v3 mode on characters/objects with `end_frame` (+ `custom_start_frame`) — requires exactly one
  direction.
- `/interpolation-v2` (Pro, v2) — between two arbitrary keyframes, output capped at 16–128 px.

### Which endpoints are synchronous

| Behaviour | Endpoints |
|---|---|
| Sync 200 with the artefact | `/animate-with-skeleton`, `/estimate-skeleton`, `/enhance-animation-v3-prompt` |
| Async, answers **202** | `/animate-with-text-v2`, `/edit-animation-v2`, `/interpolation-v2`, `/transfer-outfit-v2` |
| Async, answers **200** (trap) | `/animate-with-text-v3` |

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S tag Animate
node $S flow /animate-with-text-v3
```

### Skeletons

`/estimate-skeleton` is synchronous and returns keypoints labelled from a fixed vocabulary
(`SkeletonLabel`: NOSE, NECK, left/right shoulders, elbows, arms, hips, knees, legs, eyes, ears).
Those feed `/animate-with-skeleton` and are also stored on the character — `GET /characters/{character_id}`
returns `skeletons` keyed by direction for rotations, which is what makes frame-accurate hitboxes
possible without re-estimating.

### Deleting animations

`DELETE /characters/{character_id}/animations` and `DELETE /objects/{object_id}/animations` remove
animations without touching the character or object. Regenerating a single direction of an existing
object animation needs `replace_existing=true` on the object route, otherwise the attempt returns
**409**.
### World-block animation via `/animate-with-text-v3` (ADR 0032)

World blocks use a **texture** technique (ADR 0032) instead of the 4-face approach. Three stages,
all inside `tools/character-builder/server/world-block.ts`:

1. **Base image** — `POST /create-image-pixflux` (synchronous), 48×48 px, top-down view. One
   generation, no background job. The result is saved as `base.png`.
2. **Action generation** — an LLM (Anthropic API, `claude-haiku-4-5-20251001`) turns the block
   description into an animation action text; it falls back to keyword matching when the API is
   unavailable (the fallback yields a different hash → separate cache).
3. **Animation** — `POST /animate-with-text-v3` with `first_frame` (the base image as Base64Image),
   `action` (the LLM-generated text), and `frame_count` (4, 8 or 16; user-configured). One job for
   all frames; the 48×48 canvas stays far below the 524,288 pixel budget even at 16 frames
   (`tools/character-builder/server/world-block.ts:54@759f4615`).

`/animate-with-text-v3` is asynchronous but answers **200** (not 202), and the job's result shape is
`BackgroundJobResponse` with `last_response.images[]`. The spritesheet is a horizontal strip packed
as RGBA raw with a TexturePacker-format JSON atlas; the sidecar `animation.json` carries `fps`,
`frameCount`, `action`, and `llmGenerated`.

## References

- `generating-pixellab-characters` — producing the `character_id` this skill animates
- `composing-pixellab-objects` — the object animation route and its review flow
- `orchestrating-pixellab-jobs` — one job per direction, and how to collect them
- `guarding-generation-cost` — why `mode='pro'` needs a recorded decision before it is submitted
- `docs/adr/0032-textura-animada-unica-abandono-3d.md` — the decision record for the texture technique
