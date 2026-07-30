---
name: querying-pixellab-api
description: Answers any question about the PixelLab API by querying the vendored OpenAPI spec instead of recalling it, because that API changes without versioning. Use whenever a task mentions a PixelLab endpoint, parameter, enum, size limit, animation template, direction order, background job, spec refresh, or price - including Portuguese phrasings like "qual endpoint", "quais parametros", "esse enum aceita", "quantas direcoes", "atualizar o spec", "quanto custa a geracao". Use it before writing any code that calls api.pixellab.ai and before stating that an endpoint, field or limit exists. Triggers on create-character, animate-character, create-tileset, map-objects, background-jobs, inspect-spec, openapi.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Querying the PixelLab API

## When to use

Before asserting anything about this API. Before writing a request body. Before quoting a limit,
an enum value, a price, or a response code.

This skill is the **hub**. It owns what is true of every endpoint; the nine domain skills below own
what is true of one family. Load this one first, then the family.

## Routing to the domain skills

| The task is about | Load |
|---|---|
| creating a character, its lifecycle, ZIP, tags, states | `generating-pixellab-characters` |
| turning a sprite to face another way, frame ordering | `rotating-pixellab-sprites` |
| animation, frame counts, animation modes, skeletons | `animating-pixellab-sprites` |
| props, map objects, the review/select-frames flow | `composing-pixellab-objects` |
| terrain, Wang tilesets, isometric tiles, tiles-pro | `generating-pixellab-tilesets` |
| text-to-image, model choice, prompt enhancement | `creating-pixellab-images` |
| inpaint, edit, resize, remove background, to-pixelart | `editing-pixellab-images` |
| portraits, visemes, lip-sync, talking heads | `generating-pixellab-portraits` |
| UI panels, HUD elements, pixel fonts | `designing-pixellab-interfaces` |
| polling, retries, error codes, balance, job lifecycle | `orchestrating-pixellab-jobs` |

## Injected knowledge

### The rule, and why it is unusually strict

> "A API do PixelLab **muda sem versionar** — o `info.version` do spec é literalmente `"dev"`."
> — `AGENTS.md:22@7a66ff95`

The vendored snapshot is the source of truth, not your memory and not any blog:
`tools/pixellab-pipeline/openapi/openapi-v2.json`, captured 2026-07-29, sha256 `5b11c9a7afa1…`
(`tools/pixellab-pipeline/openapi/PROVENIENCIA.txt:1@86625fb2`). There is a real, documented case of
a guide in this same machine going stale and being wrong by an order of magnitude on price
(`docs/01-pixellab/delta-vs-guia-antigo.md:16@bc48ce53`).

### One command instead of a 387 KB file

Run the bundled script — do not load the spec into context:

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S summary                          # counts + snapshot provenance
node $S endpoint /create-tileset         # required fields, props, every constraint
node $S response /create-tileset         # what each status code actually returns
node $S flow /create-tileset             # the submit -> poll -> fetch chain
node $S tag "Create map"                 # every endpoint in one spec group
node $S grep character                   # find the right path
node $S enums CameraView                 # authoritative enum values
node $S list --async                     # the 36 POST that hand back a job id
node $S limits                           # size constraints, per endpoint
```

`endpoint` exits 1 and suggests near matches when a path does not exist, so it doubles as the
existence check.

### Three structural traps in the spec itself

**Constraints hide one level down.** Optional fields are `anyOf: [{real}, {type:"null"}]`, so
`.properties.x.enum` reads empty on most fields. A flat lookup silently returns "no constraint" for
fields that very much have one. `inspect-spec.mjs` walks recursively; hand-written `jq` usually does
not.

**There is no global size rule.** `ImageSize` is namespaced per endpoint
(`app__endpoints__external__v2__<endpoint>__ImageSize`) — 34 separate size schemas. Quoting one
endpoint's range as if it were the API's range is wrong for most of the surface.

**The status code does not say whether an endpoint is asynchronous.** 36 POSTs hand back a
`background_job_id`; only 23 of them declare `202`. The other 13 — every character-creation
endpoint, `/map-objects`, `/generate-8-rotations-v3`, `/animate-with-text-v3`,
`/create-1-direction-object` — answer `200` with a job id in the body. Two more,
`/create-tileset` and `/create-isometric-tile`, declare **both** and may answer either.

Branch on the presence of `background_job_id`, never on the code. Anything testing
`responses['202']` undercounts the asynchronous surface by 13 endpoints, and reading `image` off a
job-shaped body silently discards a generation you already paid for. This skill's own inspector used
to make that mistake; `orchestrating-pixellab-jobs` owns the full contract.

### What the spec cannot tell you

`template_animation_id` on `/animate-character` is a plain string with **no enum**. Its description
lists ten ids and then literally truncates with `...`. The complete list is not derivable from the
spec, so do not state a total and do not claim an id exists without testing it. The three ids the
catalog uses are inside the visible prefix and are safe: `breathing-idle`, `crouched-walking`,
`attack` (`tools/pixellab-pipeline/assets/catalog.ts:67@886880d8`).

### Three direction orderings coexist — this is a live bug source

| Source | Order |
|---|---|
| Spec enum `Direction` | north, north-east, east, south-east, south, south-west, west, north-west |
| `DIRECTIONS_8`, the return order of **`/generate-8-rotations-v2` only** | S, SW, W, NW, N, NE, E, SE |
| Inline enum on `/create-character-with-8-directions` | south, south-east, east, … |

Do **not** widen that middle row into "the 8-rotation endpoints". The family's two members make
opposite claims, and only one of them claims an order at all — both quotes are in
`tools/pixellab-pipeline/openapi/openapi-v2.json`, printable with `node $S endpoint <path>`:

- **`/generate-8-rotations-v2`** — "Returns 8 images **in order**: South, South-West, West,
  North-West, North, North-East, East, South-East". A genuine positional contract, and it is exactly
  `DIRECTIONS_8` (`tools/pixellab-pipeline/src/endpoints.ts:45@b6e61f99`).
- **`/create-character-with-8-directions`** — no return order exists to get wrong: it "creates 8
  rotation images in a **dictionary format** for easy access by direction name" and "Returns
  dictionary of images by direction name". The one ordering it documents is a *layout* — "Fixed
  8-rotation layout in **clockwise** order starting from south" — which is the **mirror** of
  `DIRECTIONS_8` (S, SE, E, NE, N, NW, W, SW). Applying `DIRECTIONS_8` positionally here is a
  category error, not a 422.

The lesson generalises past these two: **read by key wherever a key exists, and trust position only
where the spec says "in order".** Schemas make it checkable — `CharacterRotationUrls` is an object
keyed by direction name whose four diagonals are nullable, not an array.

The project's canonical order for *naming frames on disk* remains S, SW, W, NW, N, NE, E, SE
(`docs/adr/0005-low-top-down-8-direcoes.md:25@0f447499`) — a repo convention that happens to match
one endpoint, not a promise the API makes everywhere. Getting it wrong makes the sprite walk
sideways and produces no error at all.

### Perspective must be passed explicitly

The project uses `view: "low top-down"` everywhere. `TilesetCameraView` accepts it, but **the
endpoint's default is `high top-down`** — omit it and the terrain lands in a different perspective
from the characters (`docs/adr/0005-low-top-down-8-direcoes.md:19@0f447499`).

Verified enum values: `CameraView` = side, low top-down, high top-down.
`TilesetCameraView` = low top-down, high top-down.

### The canvas comes back bigger than you asked

`/create-character-with-4-directions` and `/create-character-with-8-directions` inflate the canvas by
about 40% — ask for 64×64 and roughly 90×90 comes back
(`tools/pixellab-pipeline/src/endpoints.ts:90@b6e61f99`). Crop against the real returned metadata,
never against the requested value, or the atlas cuts the sprites' heads off.

### Prices are always estimates

Write "preço estimado", never a flat price. PixelLab labels its own column `Estimated Price* (USD)`
with the note that it varies with GPU time (`AGENTS.md:33@7a66ff95`). One conflict is still
unresolved and must stay marked as such: the spec's formula and the published table disagree on
`/create-character-v3` at 64×64 (1 vs 2 generations); the repo's rule is to use the larger
(`docs/01-pixellab/custos-e-limites.md:59@39059cac`).

### The vendor's public pages are not a substitute for the spec

Checked directly, and each is a trap in its own way:

- **`pixellab.ai/docs/guides/*`** — the "Getting started", "Rotating a character" and "Map tiles"
  guides are **plugin UI tutorials** for Aseprite and Pixelorama. Menu paths and screenshots, no
  endpoint, no parameter, no code. Citing them as API documentation produces confident nonsense.
- **The site's own "API Documentation" link points at `api.pixellab.ai/v1/docs`** — a **v1** URL,
  while the live API is v2. Following the vendor's own navigation lands on the wrong version.
- **The MCP server is hosted, not a package.** `pixellab-code/pixellab-mcp` configures a remote
  `https://api.pixellab.ai/mcp` over HTTP with the same Bearer token, exposing four coarse tools
  (`create_character`, `animate_character`, `create_tileset`, `create_isometric_tile`). It does not
  document async handling, image return format or cost, and it cannot express the parameters this
  project depends on. It is not an alternative to the generated REST client of
  `docs/adr/0002-cliente-rest-gerado-do-openapi.md:1@fbd2951e`.

- **`GET /llms.txt`** is the API's own machine-readable index — the grouped endpoint listing an
  agent is most likely to be handed. It is an **index, not a reference**: it names the 79 paths and
  their categories and carries no parameter, enum, limit or response shape. It is a fine map and a
  useless source. Anything beyond "this endpoint exists" must come from the spec.

The only source that survived checking is the vendored spec. That is the whole reason the rule is
worded as strictly as it is.

### Refreshing the snapshot

```bash
curl -s https://api.pixellab.ai/v2/openapi.json \
  -o tools/pixellab-pipeline/openapi/openapi-v2.json
sha256sum tools/pixellab-pipeline/openapi/openapi-v2.json   # rewrite PROVENIENCIA.txt with date + hash
node $S summary                                             # confirm the counts moved
bash scripts/check-docs.sh                                  # docs may now cite dead endpoints
```

Two caveats, both currently true. `npm run refresh-openapi` points at a script that does not exist
(`tools/pixellab-pipeline/package.json:13@395c57f1`). And `npm run codegen` emits
`openapi/schema.d.ts`, which **nothing imports** — so the "schema drift becomes a compile error"
promise in `docs/adr/0002-cliente-rest-gerado-do-openapi.md:30@fbd2951e` does not currently hold.
Treat `node $S summary` plus this skill's verification signal as the real drift detector.

## References

- `references/spec-queries.md` — raw `jq` recipes, for when the script is not enough
- The nine domain skills in the routing table above — each owns one spec group and its traps
- Machine-wide skill `pixellab-assets` — general API lore, licensing, cost strategy. This skill
  deliberately does not restate it; it covers only what is true of the vendored snapshot in **this**
  repository.
