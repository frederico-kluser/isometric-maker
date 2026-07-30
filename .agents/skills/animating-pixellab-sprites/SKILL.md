---
name: animating-pixellab-sprites
description: Covers the eight PixelLab animation endpoints and the three animation modes, where one mode costs 160-320 generations for the same eight directions another does for eight, plus the frame-count rules that are decided by image size rather than by the parameter you passed. Use whenever a task animates a character or object, picks an animation mode, sets a frame count, interpolates between poses, transfers an outfit, or estimates a skeleton - including Portuguese phrasings like "animar o personagem", "fazer o walk cycle", "quantos frames", "modo de animacao", "interpolar entre poses", "trocar a roupa do sprite", "esqueleto do personagem". Triggers on animate-character, animate-with-text, animate-with-skeleton, interpolation-v2, transfer-outfit-v2, edit-animation-v2, estimate-skeleton, template_animation_id, frame_count, mode=pro.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Animating PixelLab sprites

## When to use

Before animating anything. Animation is where this API's cost curve is steepest: the same eight
directions cost 8 generations or 320 depending on one string field.

## Injected knowledge

### The three modes, and why the default is not the cheapest

`/animate-character` and `/characters/animations` share one request schema and take `mode`:

| `mode` | Cost | Needs |
|---|---|---|
| `template` | **1 generation per direction** | `template_animation_id` |
| `v3` | scales with size and frames | `action_description` |
| `pro` | **20–40 per direction — 160–320 for all eight** | `action_description` |

The project's default is `template` and `pro` is refused without a recorded decision
(`docs/adr/0006-animacao-em-template-mode.md:5@554b0d42`). The API's own text says `pro` "usually
produces **lower** quality" than `v3` while costing far more — so the expensive mode is also the
worse one. On objects, `/objects/{object_id}/animations` defaults to `v3` and carries that cost
warning inline.

One job is queued **per direction**. Eight directions is eight jobs, eight ids to persist, and eight
chances to lose a paid generation. The response returns `background_job_ids` (plural) and
`directions` — zip them.

### `template_animation_id` cannot be enumerated from the spec

The field is a plain string with **no enum**. Its description lists ten ids and then literally
truncates with `...`: `angry`, `attack`, `attack-back`, `attack-left`, `attack-right`, `backflip`,
`bark`, `breathing-idle`, `cross-punch`, `crouched-walking`. The full list is not derivable — do not
state a total and do not claim an id exists without testing it.

The three the catalog uses are inside the visible prefix and are safe:
`breathing-idle`, `crouched-walking`, `attack` (`tools/pixellab-pipeline/assets/catalog.ts:67@886880d8`).

### `directions` defaults differ by mode, and the surprise is expensive in one direction and useless in the other

Same field, opposite defaults: **template mode defaults to every direction the character has**;
custom mode defaults to **south only**. Omitting it in template mode buys eight animations when you
wanted one. Omitting it in custom mode delivers one when you needed eight.

### Frame count is a negotiation, not a setting

Three endpoints, three different rules:

- `/animate-with-text` takes `n_frames` in the 2–20 range with default 4, and its own description
  says "the model will always generate 4 frames". The parameter does not do what it says. This
  endpoint also accepts **only 64×64**, exactly.
- `/animate-with-text-v2` has **no frame-count parameter at all** — the count follows the size:
  32×32 and 64×64 return 16 frames, while 128, 170 and 256 return 4.
- `/animate-with-text-v3` takes `frame_count` 4–16 and it **must be even**, under a pixel budget of
  `width × height × frame_count ≤ 524288`
  (`tools/pixellab-pipeline/src/endpoints.ts:207@08e4ea43`). Ask for 128×128 with 16 frames and the
  request is rejected after you have already built it.

`/animate-with-skeleton` has a stricter, undocumented-looking rule that the spec does state:
`skeleton_keypoints` requires **exactly 3 frames** — it is a three-frame window model, and any other
count is rejected.

### Which endpoints are synchronous

Unusually for this API, three animation endpoints return the artefact inline:
`/animate-with-skeleton`, `/animate-with-text` and `/estimate-skeleton` all answer `200` with
`images` or `keypoints` directly. Everything else in the family is asynchronous — and
`/animate-with-text-v3` is asynchronous while answering `200`, not `202`.

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S tag Animate
node $S flow /animate-with-text-v3
```

### Interpolation mode is a hidden second behaviour of the animation endpoints

Passing `end_frame` to `mode='v3'` silently switches the endpoint into interpolation: instead of
inventing motion from the action text, it animates **between** the start pose and the pose you gave.
`custom_start_frame` replaces the character's own rotation as frame zero, and `keep_first_frame=false`
stores exactly `frame_count` frames rather than the reference plus the frames.

The dedicated `/interpolation-v2` does the same between two arbitrary keyframes, capped at 16–128px
output, and is a Pro endpoint.

### The frame-batch endpoints share one constraint

`/edit-animation-v2` and `/transfer-outfit-v2` both take **2–16 frames**, with the real maximum
depending on frame size, and both answer `202`. They edit an existing sequence rather than producing
one: consistent text edit across all frames, or an outfit lifted from a reference onto every frame.
Neither preserves the character record — they take and return loose frames.

### Skeletons

`/estimate-skeleton` is synchronous and returns keypoints labelled from a fixed vocabulary
(`SkeletonLabel`: NOSE, NECK, shoulders, elbows, arms, hips, knees, legs, eyes, ears). Those feed
`/animate-with-skeleton` and are also stored on the character — `GET /characters/{character_id}`
returns `skeletons` keyed by direction for rotations and by frame for animations, which is what makes
frame-accurate hitboxes possible without re-estimating.

### Deleting animations

`DELETE /characters/{character_id}/animations` and `DELETE /objects/{object_id}/animations` remove
animations without touching the character or object. Regenerating a single direction of an existing
object animation needs `replace_existing=true` on the object route, otherwise the attempt returns
**409**.

## References

- `generating-pixellab-characters` — producing the `character_id` this skill animates
- `composing-pixellab-objects` — the object animation route and its review flow
- `orchestrating-pixellab-jobs` — one job per direction, and how to collect them
- `guarding-generation-cost` — why `mode='pro'` needs a recorded decision before it is submitted
