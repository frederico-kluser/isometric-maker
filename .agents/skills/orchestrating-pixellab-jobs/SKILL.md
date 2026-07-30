---
name: orchestrating-pixellab-jobs
description: Owns the asynchronous contract of the PixelLab API - which endpoints hand back a job instead of an artefact, the four different result-retrieval shapes, the non-standard status codes, and the artefacts that auto-delete. Use whenever code submits a generation, polls a job, handles an API error, reads the balance, or resumes an interrupted run - including Portuguese phrasings like "fazer o poll", "esperar terminar", "o job travou", "nao sai de processing", "tratar o erro da API", "quantos creditos sobraram", "retomar depois do crash", "deu 429". Use it before writing any retry, timeout or polling loop against api.pixellab.ai. Triggers on background-jobs, background_job_id, processing, completed, stalled, finalizing, 202, 423, 429, 529, 410, Retry-After, last_response, balance, download_url, polling.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Orchestrating PixelLab jobs

## When to use

Before writing any code that submits work to this API and expects a result later. The asynchronous
contract is where money is lost, because the charge happens at submit and the artefact arrives
somewhere else entirely.

## Injected knowledge

### The status code does not tell you whether it is asynchronous

Of the 56 POST endpoints, **36 hand back a job id and 23 declare `202`**. The other 13 answer
**`200`** with a `background_job_id` in the body — including every character-creation endpoint,
`/map-objects`, `/generate-8-rotations-v3`, `/animate-with-text-v3`, `/create-1-direction-object`
and `/create-8-direction-object`.

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S summary                  # both counts, so the gap is visible
node $S list --async             # 200* marks async-but-answers-200
node $S flow /create-character-v3
```

Branch on the **shape of the body** — is there a `background_job_id`? — never on the status code.
Two endpoints, `/create-tileset` and `/create-isometric-tile`, declare both `200` and `202` and may
genuinely answer either way, which makes a code-based branch wrong even in principle.

This distinction is not academic: `docs/01-pixellab/modelo-assincrono.md:5@b581e174` states the 23
figure, which is correct about `202` and undercounts the asynchronous surface by 13. The repo's own
hand-written endpoint table gets it right (`tools/pixellab-pipeline/src/endpoints.ts:77@08e4ea43`
marks `create-character-with-8-directions` async despite its 200).

### Persist the id before the first poll

A successful POST to an asynchronous endpoint means **you have already been charged**
(`tools/pixellab-pipeline/src/api.ts:84@314e8627`). Losing the id after that point loses the
generation with no refund and no way to recover it. Write it to disk, then poll.

Most submit responses also carry the resource id immediately — `character_id`, `tileset_id`,
`tile_id`, `object_id`, `ui_asset_id` — before the resource has any content. Store that too; it is
what the second and third retrieval shapes below are keyed on.

### Four different ways to collect a result

There is no single "get my result" endpoint. Which one applies is per-family:

| Shape | How | Who uses it |
|---|---|---|
| Generic job | `GET /background-jobs/{job_id}`, read `last_response` | most Pro endpoints, images, animation, fonts |
| Resource poll | `GET` the resource by its own id | `/tilesets/{tileset_id}`, `/isometric-tiles/{tile_id}`, `/tiles-pro/{tile_id}`, `/objects/{object_id}`, `/ui-assets/{ui_asset_id}` |
| Dedicated job route | its own `GET .../{job_id}` | `/portrait-character-pro/{job_id}`, `/vocal-animation/{job_id}`, `/generate-font-pro/{job_id}` |
| Locked-until-ready | `GET` returns **423** with `Retry-After` until done | `/map-objects/{object_id}`, `/characters/{character_id}/zip`, sidescroller tilesets |

`node $S flow <path>` derives the chain for a specific endpoint from the spec, so it stays right
across snapshot refreshes.

### Job status values, and the ones only some routes use

`GET /background-jobs/{job_id}` returns `processing`, `completed` or `failed`, plus `created_at` and
`last_response`. The dedicated job routes add two more that the generic one never emits:
**`stalled`** and **`finalizing`**. Treating an unknown status as failure will abandon jobs that were
about to succeed; treat unknown as "keep polling" and bound it with a timeout instead.

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
standard code list (`tools/pixellab-pipeline/src/api.ts:20@314e8627`). Never retry 400/401/403/404/422
— retrying a validation error only burns quota.

`423` is not an error on the retrieval routes. It is the documented "still working" answer, and it
carries the server's own wait hint. Server `Retry-After` always wins over computed backoff.

### Artefacts that expire

**Map objects auto-delete 8 hours after creation.** The `download_url` on
`GET /map-objects/{object_id}` is a no-auth URL that stops working; fetch the PNG promptly rather
than storing the URL. Several other completed jobs likewise expose `download_url` /
`download_atlas_url` / `download_ttf_url` only while `status` is `completed`.

### Balance is two units, and mixing them is a real bug

`GET /balance` returns `credits.usd` **and** `subscription.generations` / `subscription.total` with
`subscription.status` in active, trial, expired or none. Endpoints priced "20–40 generations" bill
the subscription bucket; USD pricing applies to credits. The repo deliberately treats the number as
opaque and compares deltas between runs rather than trusting one reading
(`tools/pixellab-pipeline/src/api.ts:173@314e8627`).

Reading the balance is free and is the only external check that a supposedly idempotent rerun really
spent nothing.

### Deletion is not always allowed

`DELETE /tiles-pro/{tile_id}` returns **409** while the tile is still generating and only unblocks
once the job passes a stuck threshold. Delete-then-regenerate loops must handle that, or they spin.

## References

- `querying-pixellab-api` — the spec-query discipline this skill's commands belong to
- `guarding-generation-cost` — the ledger, the budget guards, and resuming an interrupted queue
- `generating-pixellab-characters`, `generating-pixellab-tilesets`, `composing-pixellab-objects` —
  the per-family retrieval shapes referenced above
