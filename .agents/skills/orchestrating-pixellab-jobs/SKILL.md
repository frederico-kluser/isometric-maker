---
name: orchestrating-pixellab-jobs
description: Owns the asynchronous contract of the PixelLab API - which endpoints hand back a job instead of an artefact, the four result-retrieval shapes, the v3 job patterns (create-character-v3, animate-with-text-v3, generate-8-rotations-v3, inpaint-v3), the non-standard status codes, and the artefacts that auto-delete. Use whenever code submits a generation, polls a job, handles an API error, reads the balance, or resumes an interrupted run - including Portuguese phrasings like "fazer o poll", "esperar terminar", "o job travou", "nao sai de processing", "tratar o erro da API", "quantos creditos sobraram", "retomar depois do crash", "deu 429". Use it before writing any retry, timeout or polling loop against api.pixellab.ai. Triggers on background-jobs, background_job_id, processing, completed, stalled, finalizing, 202, 423, 429, 529, 410, Retry-After, last_response, balance, download_url, polling, create-character-v3, animate-with-text-v3, generate-8-rotations-v3, inpaint-v3.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Orchestrating PixelLab jobs

## When to use

Before writing any code that submits work to this API and expects a result later. The asynchronous
contract is where money is lost, because the charge happens at submit and the artefact arrives
somewhere else entirely. The v3 endpoints (`/create-character-v3`, `/animate-with-text-v3`,
`/generate-8-rotations-v3`, `/inpaint-v3`) are as asynchronous as their v2 predecessors, with a
different mix of status codes — the polling discipline below is what keeps them from becoming
invisible charges.

## Injected knowledge

### The status code does not tell you whether it is asynchronous

Of the 56 POST endpoints, **36 hand back a job id and 23 declare `202`**. The other 13 answer
**`200`** with a `background_job_id` in the body: the seven character-creation endpoints
(`/create-character-with-4-directions`, `/create-character-with-8-directions`, `/create-character-pro`,
`/create-character-v3`, `/characters/animations`, `/animate-character`, `/create-character-state`),
the three object-lifecycle endpoints (`/create-1-direction-object`, `/create-8-direction-object`,
`/objects/{object_id}/states`), plus `/map-objects`, `/generate-8-rotations-v3` and
`/animate-with-text-v3`.

Those totals already include the v3 family: three of the four v3 endpoints —
`/create-character-v3`, `/animate-with-text-v3`, `/generate-8-rotations-v3` — answer `200`, and
`/inpaint-v3` is the one v3 endpoint that declares `202`. Recalculating the split with v3 lands on
the same 36/23 — but the very fact that three v3 endpoints answer `200` is the strongest argument
against any "200 is synchronous" heuristic.

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S summary                  # both counts, so the gap is visible
node $S list --async             # 200* marks async-but-answers-200
node $S flow /create-character-v3
node $S flow /generate-8-rotations-v3
```

Branch on the **shape of the body** — is there a `background_job_id`? — never on the status code.
Two endpoints, `/create-tileset` and `/create-isometric-tile`, declare both `200` and `202` and may
genuinely answer either way, which makes a code-based branch wrong even in principle.

This distinction is not academic: `docs/01-pixellab/modelo-assincrono.md:5@9335c20d` states the 23
figure, which is correct about `202` and undercounts the asynchronous surface by 13. The repo's own
hand-written endpoint table gets it right (`tools/pixellab-pipeline/src/endpoints.ts:156@7e700048`
marks `create-character-with-8-directions` async despite its 200).

### Persist the id before the first poll

A successful POST to an asynchronous endpoint means **you have already been charged**
(`tools/pixellab-pipeline/src/api.ts:89@55dd790d`). Losing the id after that point loses the
generation with no refund and no way to recover it. Write it to disk, then poll.

Most submit responses also carry the resource id immediately — `character_id`, `tileset_id`,
`tile_id`, `object_id`, `ui_asset_id` — before the resource has any content. Store that too; it is
what the second retrieval shape below is keyed on. This is where `/create-character-v3` differs
from `/generate-8-rotations-v3`: the v3 character endpoint returns **both** `background_job_id`
**and** `character_id` immediately (`tools/character-builder/server/mannequin.ts:29@07735991`),
while the rotations endpoint returns only the job id — there is no character to key a resource poll
on, the frames come back inside the job itself.

### Four different ways to collect a result

There is no single "get my result" endpoint. Which one applies is per-family:

| Shape | How | Who uses it |
|---|---|---|
| Generic job | `GET /background-jobs/{job_id}`, read `last_response` | most Pro endpoints, images, animation, fonts — and the v3 endpoints |
| Resource poll | `GET` the resource by its own id | `/tilesets/{tileset_id}`, `/isometric-tiles/{tile_id}`, `/tiles-pro/{tile_id}`, `/objects/{object_id}`, `/ui-assets/{ui_asset_id}`, `/characters/{character_id}` |
| Dedicated job route | its own `GET .../{job_id}` | `/portrait-character-pro/{job_id}`, `/vocal-animation/{job_id}`, `/generate-font-pro/{job_id}` |
| Locked-until-ready | `GET` returns **423** with `Retry-After` until done | `/map-objects/{object_id}`, `/characters/{character_id}/zip`, sidescroller tilesets |

`node $S flow <path>` derives the chain for a specific endpoint from the spec, so it stays right
across snapshot refreshes.

The v3 endpoints sit in the first shape, with one twist. The background job of `/create-character-v3`
carries **metadata only** — `character_id`, `saved_to_storage`, `uploaded_directions` — the pixels
come from `GET /characters/{character_id}`, whose `rotation_urls` is a dictionary keyed by direction
(`tools/character-builder/server/frames.ts:142@e5853132`). Poll the job for status, then fetch the
character for pixels.

### The v3 family: response shapes and polling cadence

| Endpoint | Status | Returns immediately | Where the result lands |
|---|---|---|---|
| `/create-character-v3` | `200` | `background_job_id` + `character_id` (+ `enhanced_prompt` if `enhance_prompt=true`) | `GET /characters/{character_id}` — `rotation_urls` dict |
| `/animate-with-text-v3` | `200` | `background_job_id` (+ `enhanced_prompt` if `enhance_prompt=true`) | `last_response.images` |
| `/generate-8-rotations-v3` | `200` | `background_job_id` only | `last_response.images` |
| `/inpaint-v3` | `202` | `background_job_id` | `last_response` |

For the rotation and animation endpoints the vendor documents the polling cadence itself: **every
2–5 seconds**, with a typical total of **30–180 seconds** before `status` is `completed`.
`/inpaint-v3` documents a slower cadence, every **5–10 seconds**. The v3 spec prose even ships a
reference loop (submit → poll → read `last_response`), which is a good default shape to copy.

The frames in `last_response.images` come back as a **dictionary keyed by direction or name** —
`south`, `south-east`, ... for rotations — **never an array**. Indexing by position instead of key
silently mislabels the frames and, once the frames reach direction-dependent code (mannequins,
compasses, walk cycles), corrupts the whole character.

### Job status values, and the ones only some routes use

`GET /background-jobs/{job_id}` returns `processing`, `completed` or `failed`, plus `created_at` and
`last_response`. The dedicated job routes (`/portrait-character-pro/{job_id}`,
`/generate-font-pro/{job_id}`) add two more that the generic one never emits: **`stalled`** and
**`finalizing`**. Treating an unknown status as failure will abandon jobs that were about to
succeed; treat unknown as "keep polling" and bound it with a timeout instead.

### The error codes that are easy to get wrong

| Code | Meaning | Retry? |
|---|---|---|
| `402` | insufficient credits | no — top up |
| `409` | already animated / still generating, on delete | no — resolve the conflict |
| `410` | **permanent** generation failure | no — the job is gone |
| `422` | validation error, arrives **after** submission | no — our bug |
| `423` | Locked: still generating, honours `Retry-After` | yes, that is its purpose |
| `429` | concurrency limit reached | yes, with backoff |
| `529` | rate limit exceeded — **non-standard**, most HTTP clients ignore it | yes |

`529` appears on the synchronous endpoints and is invisible to any retry policy written against the
standard code list (`tools/pixellab-pipeline/src/api.ts:20@55dd790d`). Never retry 400/401/403/404/422
— retrying a validation error only burns quota.

`423` is not an error on the retrieval routes. It is the documented "still working" answer, and it
carries the server's own wait hint. Server `Retry-After` always wins over computed backoff.

`429` reads "Too many concurrent jobs" / "Concurrency limit reached" on submission and "Too many
requests" on polling. The ceiling number is undocumented in the spec; the project models it per
subscription tier and treats 4 (t2) as its working ceiling — `free` 1, `t1` 2, `t2` 4, `t3` 20, the
last being the only figure the vendor documents ("up to 20 concurrent jobs")
(`tools/pixellab-pipeline/src/cost.ts:368@84fca7a8`).

### Artefacts that expire

**Map objects auto-delete 8 hours after creation.** The `download_url` on
`GET /map-objects/{object_id}` is a no-auth URL that stops working; fetch the PNG promptly rather
than storing the URL. Several other completed jobs likewise expose `download_url` /
`download_atlas_url` / `download_ttf_url` only while `status` is `completed`.

### Balance is two units, and mixing them is a real bug

`GET /balance` returns `credits.usd` **and** `subscription.generations` / `subscription.total` with
`subscription.status` in active, trial, expired or none. Endpoints priced "20–40 generations" bill
the subscription bucket; USD pricing applies to credits. The v3 endpoints bill in generations —
`/create-character-v3` documents `ceil(w*h*8 / 65536)` generations for reference-image mode — so a
balance check against `credits.usd` alone reads zero change for v3 work. The repo deliberately
treats the number as opaque and compares deltas between runs rather than trusting one reading
(`tools/pixellab-pipeline/src/api.ts:186@55dd790d`).

Reading the balance is free and is the only external check that a supposedly idempotent rerun really
spent nothing.

### Deletion is not always allowed

`DELETE /tiles-pro/{tile_id}` returns **409** while the tile is still generating and only unblocks
once the job passes a stuck threshold. Delete-then-regenerate loops must handle that, or they spin.

### `llms.txt` is an index, not a reference

`GET /llms.txt` is the API's own machine-readable grouped listing — the endpoint index an agent is
most likely to be handed first. It is a fine map of which paths exist, and nothing more: no
parameter, enum, limit or response shape. Anything beyond "this endpoint exists" must come from the
vendored spec.

## References

- `querying-pixellab-api` — the spec-query discipline this skill's commands belong to
- `guarding-generation-cost` — the ledger, the budget guards, and resuming an interrupted queue
- `generating-pixellab-characters`, `generating-pixellab-tilesets`, `composing-pixellab-objects` —
  the per-family retrieval shapes referenced above
