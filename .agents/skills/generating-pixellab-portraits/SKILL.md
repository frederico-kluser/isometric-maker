---
name: generating-pixellab-portraits
description: Covers PixelLab portraits and lip-sync, a pipeline whose cost lands once per expression and then makes every line of dialogue free - and where the free endpoint is the one an engine should actually call. Use whenever a task builds dialogue faces, talking heads, NPC busts, mouth animation or lip-sync, or converts between a bust and a full-body sprite - including Portuguese phrasings like "retrato do NPC", "cabeca falante", "sincronizar a boca", "animacao de fala", "dialogo com rosto", "gerar o busto do personagem". Triggers on portrait-character-pro, vocal-animation, talking-gif, lip-sync, viseme, viseme_count, mood, grid_url, portrait_to_character.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Generating PixelLab portraits

## When to use

Before building any dialogue face. The cost structure here is unlike the rest of the API and it
rewards getting the order right: one paid step, then unlimited free ones.

## Injected knowledge

### The pipeline, and where the single charge lands

1. **Get a portrait.** `POST /portrait-character-pro` with `direction='character_to_portrait'` turns
   an existing full-body sprite into a bust. The reverse, `portrait_to_character`, turns a bust into
   a full-body sprite. Paid, asynchronous, `202`.
2. **Attach it.** `POST /characters/{character_id}/portrait` — **free, no generation runs**.
   Overwrites any existing portrait.
3. **Generate mouth positions.** `POST /vocal-animation` — **this is the only step that costs**, and
   you pay it once per expression.
4. **Speak, forever, for free.** `POST /talking-gif` or `POST /lip-sync` re-order the mouth positions
   that step 3 produced. Both are explicitly free and unlimited.

Getting this backwards — regenerating visemes per line of dialogue — turns a one-off cost into a
per-line one.

None of this family is modelled in the pipeline: `tools/pixellab-pipeline/src/endpoints.ts:13@b6e61f99`
lists the 22 endpoints it calls and no portrait route is among them. Everything here comes from the
vendored spec (`tools/pixellab-pipeline/openapi/openapi-v2.json:1@8bc0acb9`), so treat it as **not
yet exercised by this repository**.

### `/lip-sync` is the one a game should call, not `/talking-gif`

Both are free. `/talking-gif` renders an animated GIF and hands back `gif_base64`. `/lip-sync`
returns the **frame plan**: which mouth position, for how long, and how far through the text it
lands, plus `grid_url`, `row` and `viseme_order`.

That is everything needed to blit the right cell of the stored spritesheet — column from the frame,
row from the expression — and hold each frame for an exact duration. A GIF cannot do that: GIF stores
delays in 10ms steps, which is why `/talking-gif` returns the `frame_ms` it **actually** encoded
alongside the one you requested. For an engine, the GIF is a downgrade.

### `viseme_count` must be identical across a character's expressions

`viseme_count` ∈ 3, 5, 7, 12 — 3 for tiny portraits, **7 recommended**, 12 for large close-ups. It
**must match across every expression stored on one character**, and a mismatch is a `400`, not a
silent fallback.

`mood` ∈ neutral, happy, angry, sad, surprised. The mouth positions themselves are the same across
moods — the expression is what is held on the rest of the face — so you call `/vocal-animation` once
per mood you want, and each one costs.

### Two forms of `/vocal-animation` that store different things

- With `character_id`: generates from the character's **stored portrait** and saves the set onto the
  character. Afterwards `/talking-gif` and `/lip-sync` need only the character id.
- With `portrait`: generates from the image you pass and **stores nothing**. The frames come back
  inline from the GET and keeping them is your problem.

They are mutually exclusive. The stateless form is the one that loses work if you do not persist the
response.

### Portrait constraints the schema does not state

`POST /characters/{character_id}/portrait` rejects anything that is not a valid PNG or is outside
**16–256px**, as a `422`. The stored portrait is always **square** and the response tells you the
edge length it settled on.

`/portrait-character-pro` takes `result_size` ∈ 16, 32, 48, 64, 128, 160 — a fixed set, not a range —
and 128/160 render at 2K, costing more. It can also answer **`400` No internal style for this
size/view**: not every size and `CameraView` combination has a style behind it, and that failure is
about the combination, not about your image.

### Polling these uses dedicated routes, with two extra statuses

`/portrait-character-pro/{job_id}`, `/vocal-animation/{job_id}` and `/generate-font-pro/{job_id}`
each have their own GET rather than going through the generic background-jobs route. They report
`processing`, **`stalled`**, **`finalizing`**, `failed` and `completed` — two statuses the generic
route never emits. They answer **`423`** with `Retry-After` while still working and **`410`** when
the generation failed permanently.

`/vocal-animation/{job_id}` streams: `completed_visemes` fills up while the job runs, so partial
progress is observable.

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S tag Generate
node $S flow /vocal-animation
node $S response /vocal-animation/{job_id}
```

### Lip-sync is alphabet-based, which is why it works in Portuguese

Mouth shapes are derived from the **letters** of the text, so any language using the latin alphabet
works without extra configuration. `text` is capped at 500 characters on both free endpoints.

### A paid-plan gate

`/vocal-animation` can answer **`403` Requires a paid plan**. It is the only endpoint in this family
that does, and it fails at the step that costs — so a free-tier account can build the whole pipeline
up to the point where it would become useful and then stop.

## References

- `generating-pixellab-characters` — the `character_id` that portraits attach to
- `designing-pixellab-interfaces` — dialogue boxes and the font that renders the line
- `orchestrating-pixellab-jobs` — dedicated job routes, `stalled`/`finalizing`, and `423`/`410`
