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

## Injected knowledge

### The rule, and why it is unusually strict

> "A API do PixelLab **muda sem versionar** — o `info.version` do spec é literalmente `"dev"`."
> — `AGENTS.md:22@4a84b2d0`

The vendored snapshot is the source of truth, not your memory and not any blog:
`tools/pixellab-pipeline/openapi/openapi-v2.json`, captured 2026-07-29, sha256 `5b11c9a7afa1…`
(`tools/pixellab-pipeline/openapi/PROVENIENCIA.txt:1@86625fb2`). There is a real, documented case of
a guide in this same machine going stale and being wrong by an order of magnitude on price
(`docs/01-pixellab/delta-vs-guia-antigo.md:16@2feba2c8`).

### One command instead of a 387 KB file

Run the bundled script — do not load the spec into context:

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S summary                          # counts + snapshot provenance
node $S endpoint /create-tileset         # required fields, props, every constraint
node $S grep character                   # find the right path
node $S enums CameraView                 # authoritative enum values
node $S list --async                     # the 23 POST that return 202
node $S limits                           # size constraints, per endpoint
```

`endpoint` exits 1 and suggests near matches when a path does not exist, so it doubles as the
existence check.

### Two structural traps in the spec itself

**Constraints hide one level down.** Optional fields are `anyOf: [{real}, {type:"null"}]`, so
`.properties.x.enum` reads empty on most fields. A flat lookup silently returns "no constraint" for
fields that very much have one. `inspect-spec.mjs` walks recursively; hand-written `jq` usually does
not.

**There is no global size rule.** `ImageSize` is namespaced per endpoint
(`app__endpoints__external__v2__<endpoint>__ImageSize`). Quoting one endpoint's range as if it were
the API's range is wrong for most of the surface.

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
| `DIRECTIONS_8`, the **return** order of the 8-rotation endpoints | S, SW, W, NW, N, NE, E, SE |
| Inline enum on `/create-character-with-8-directions` | south, south-east, east, … |

The project's canonical order for naming frames is the return order — S, SW, W, NW, N, NE, E, SE
(`tools/pixellab-pipeline/src/endpoints.ts:45@08e4ea43`,
`docs/adr/0005-low-top-down-8-direcoes.md:25@0f447499`). Getting it wrong makes the sprite walk
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
(`tools/pixellab-pipeline/src/endpoints.ts:90@08e4ea43`). Crop against the real returned metadata,
never against the requested value, or the atlas cuts the sprites' heads off.

### Prices are always estimates

Write "preço estimado", never a flat price. PixelLab labels its own column `Estimated Price* (USD)`
with the note that it varies with GPU time (`AGENTS.md:33@4a84b2d0`). One conflict is still
unresolved and must stay marked as such: the spec's formula and the published table disagree on
`/create-character-v3` at 64×64 (1 vs 2 generations); the repo's rule is to use the larger
(`docs/01-pixellab/custos-e-limites.md:59@86c1d244`).

### Refreshing the snapshot

```bash
curl -s https://api.pixellab.ai/v2/openapi.json \
  -o tools/pixellab-pipeline/openapi/openapi-v2.json
sha256sum tools/pixellab-pipeline/openapi/openapi-v2.json   # rewrite PROVENIENCIA.txt with date + hash
node $S summary                                             # confirm the counts moved
bash scripts/check-docs.sh                                  # docs may now cite dead endpoints
```

Two caveats, both currently true. `npm run refresh-openapi` points at a script that does not exist
(`tools/pixellab-pipeline/package.json:13@cb7194dc`). And `npm run codegen` emits
`openapi/schema.d.ts`, which **nothing imports** — so the "schema drift becomes a compile error"
promise in `docs/adr/0002-cliente-rest-gerado-do-openapi.md:30@56cea0d4` does not currently hold.
Treat `node $S summary` plus this skill's verification signal as the real drift detector.

## References

- `references/spec-queries.md` — raw `jq` recipes, for when the script is not enough
- Machine-wide skill `pixellab-assets` — general API lore, licensing, cost strategy. This skill
  deliberately does not restate it; it covers only what is true of the vendored snapshot in **this**
  repository.
