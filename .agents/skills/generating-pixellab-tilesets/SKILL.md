---
name: generating-pixellab-tilesets
description: Covers the eighteen PixelLab map endpoints — all v2: map tilesets never got a v3, and these four families (top-down Wang autotiling, sidescroller, isometric tiles, tiles-pro) are the entire tile pipeline an isometric map editor needs. Explains Wang autotiling on the vertex grid via pattern_4x4, the tile counts that change with transition_size, the camera view that must match the characters, the 2:1 dimetric geometry of isometric tiles, and how to actually place the returned tiles in an engine. Use whenever a task generates terrain, builds a map, creates tiles, or has to place a returned tileset in an engine — including Portuguese phrasings like "gerar o tileset", "criar o terreno", "tiles do mapa", "autotile", "transicao entre terrenos", "tile isometrico", "plataforma do sidescroller", "como montar o mapa com esses tiles". Triggers on create-tileset, tilesets-sidescroller, create-isometric-tile, create-tiles-pro, Wang, pattern_4x4, corners, transition_size, lower_description, upper_description, tile_size.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-spec-claims.mjs
---

# Generating PixelLab tilesets

## When to use

Before generating terrain, and before writing the code that places the tiles. Placement is where
this family goes wrong: the generation succeeds and the map still has seams, because the tiles were
indexed by the wrong field.

One thing first: **map tilesets never got a v3.** Characters have `/create-character-v3`, portraits
have their own v3 endpoints — the 18 endpoints in this skill are still v2, and the vendored spec
shows no v3 replacement coming. For an isometric map editor that is the normal state of things:
these four families are the entire tile pipeline, so this skill is the permanent path, not a
stopgap waiting for an upgrade.

## Injected knowledge

### Four unrelated families share one tag

`node $S tag "Create map"` returns 18 endpoints across four pipelines that do not interoperate:

| Family | Create | Retrieve | Shape |
|---|---|---|---|
| Top-down Wang | `POST /create-tileset`, `POST /tilesets` | `GET /tilesets`, `GET /tilesets/{tileset_id}`, `DELETE /tilesets/{tileset_id}` | two terrains, corner autotiling |
| Sidescroller | `POST /create-tileset-sidescroller`, `POST /tilesets-sidescroller` | `GET /tilesets-sidescroller`, `GET /tilesets-sidescroller/{tileset_id}`, `DELETE /tilesets-sidescroller/{tileset_id}` | one platform material, side view, transparent |
| Isometric tile | `POST /create-isometric-tile` | `GET /isometric-tiles`, `GET /isometric-tiles/{tile_id}`, `DELETE /isometric-tiles/{tile_id}` | a **single** tile, not a set |
| Tiles Pro | `POST /create-tiles-pro` | `GET /tiles-pro`, `GET /tiles-pro/{tile_id}`, `DELETE /tiles-pro/{tile_id}` | hex / iso / octagon / square kits, roads and buildings |

`POST /tilesets` and `POST /create-tileset` take the same request body; `/tilesets` is the
always-async form and only answers `202`. Each family is a separate collection: fetching a
sidescroller tileset from the top-down route returns **404**, not a helpful error.

### Top-down Wang: the terrain lives on the vertex grid

Terrain is defined per **vertex**, not per cell: a map of W×H cells has (W+1)×(H+1) vertices, each
holding one terrain value. Each cell reads its four corner vertices (NW, NE, SW, SE) and you place
the tile whose pattern matches. Because adjacent cells share vertices, tiles connect seamlessly by
construction — you never need edge-matching logic. That is why the returned `Tile` carries both
`corners` (NW/NE/SW/SE, each `lower` | `upper` | `transition`) and `pattern_4x4`.

Match on **`pattern_4x4`**, not on `connections`. `pattern_4x4` encodes terrain as `0=lower`,
`1=upper`, `2=transition`, `255=wildcard`; `row_1` and `row_2` hold the four corners while `row_0`
and `row_3` hold the terrain above and below. `connections` is **deprecated and null on newly
generated top-down tilesets** — code written against it silently gets nothing, and the twins
problem below makes it useless anyway.

The request takes two required descriptions — `lower_description` and `upper_description` — and
produces exactly two terrains. `tile_size` is `{width, height}`, each **16 or 32**; `64` exists in
the enum but **requires `mode='pro'`** (the `TileSize` schema says so, verbatim). `mode` ∈ standard,
pro; `spread_x`, `slope_size` and `raggedness` are **Pro only** and silently inert in standard
mode. `transition_size` ∈ 0, 0.25, 0.5, 1; `tile_strength` 0.1–2; `tileset_adherence` (0–500) and
`tileset_adherence_freedom` (0–900) steer how closely it follows the reference image.

### The tile count changes with `transition_size`, and the extras are ambiguous

At **1.0** the tileset returns **25 tiles instead of 16**, corners take a third value `transition`,
and a cliff wall occupies the cell **below** the terrain boundary — so a cliff spans two map rows.
The spec's own `total_tiles` description reads "16 for standard, 25 for transition_size=1.0".

Those 25 tiles cover only **21 distinct corner combinations**: four wall-continuation tiles share
their corners with a twin. Select by `pattern_4x4` or the twins collapse into one another and the
cliff renders wrong.

Do not hardcode either count: the retrieval endpoint's own guidance is to read `total_tiles` or the
length of `tiles`, because the route also serves tilesets generated by earlier versions that report
other counts at `transition_size=1.0`.

### Sidescroller: one material, no camera choice

Only `lower_description` is required — one platform material, no upper terrain. `tile_size` is
`{width, height}` **16 or 32, no `64` and no `mode`**: the sidescroller enum stops where the
top-down one branches into pro. There is no `view` parameter at all — the pipeline is always side
view and transparent, and `TilesetCameraView` has no `side` precisely because side view is a
different pipeline. `transition_size`, `tile_strength` and the two adherence knobs behave as in
top-down.

`POST /tilesets-sidescroller` and `POST /create-tileset-sidescroller` share the body; the former is
the always-async form. Both creation routes answer **only `202`** — no `200` path exists (unlike
top-down and isometric, which answer both).

### Isometric tiles: single blocks, and the geometry is the spec

`POST /create-isometric-tile` makes **one tile**, not a set, and it is the family that matches the
2:1 dimetric projection this editor renders (`packages/iso-core/src/iso-cube.ts`,
`docs/adr/0024-cubo-isometrico-canonico.md`). Two parameters define the geometry:

- `isometric_tile_size` ∈ **16, 32** — the width of the top diamond.
- `isometric_tile_shape` ∈ `thin tile` (~15% of canvas height), `thick tile` (~25%), `block` (~50%).
  The spec says it plainly: thicker tiles allow **more height variation** in game maps — thickness
  is the vertical budget the map can express.

Required: `description` and `image_size` (width/height 16–64; the spec notes sizes above 24 usually
look better). `outline` here is `single color outline` | `selective outline` | `lineless` — the
enum is **narrower than the tileset one**: there is no `single color black outline`. `detail` takes
the same `Detail` enum as the other families:

`Detail` = low detail, medium detail, highly detailed

The character endpoints (8-directions, v3) instead say `high detail` — writing the character-side
value here is a silent style drift, not an error.

The endpoint has **no proportion parameter** — `isometric_tile_shape` is the closest thing. Measured
across the five paid blocks in this project (48×48, `shape='block'`): the top diamond came out 2:1
in all five, and the **vertical edge varied between 20 and 22 px** block to block. Blocks that do
not share a height do not stack. A geometrically true cube in 2:1 dimetric has vertical edge
`d = W·√6/4 ≈ 0.6124·W`, so a correct cube sprite is ~11% taller than square — never `W/2`.

The lever that does exist is `init_image` plus `init_image_strength` (integer 1–999, default 300).
This project chains it: the code-drawn cube mould opens the first face, and that face's RESULT
becomes the `init_image` (and `color_image`) of the remaining three views — every block ships four
distinct views, one per camera rotation
(`docs/adr/0029-quatro-vistas-molde-encadeado-e-rotate.md`). A second technique routes the same
first face through `/create-character-v3` as `reference_image` and derives the four views from the
character's `rotation_urls`; the two are cached separately to be compared.

Two traps ride along:

- **`init_image_strength` has inverted polarity versus Stable Diffusion.** It sets how much noise
  is added before generation, so **higher means closer to the reference**. Anyone applying
  `denoising_strength` intuition tunes it backwards.
- **`style_image` and `style_strength` do not exist here**, and the request schema declares
  `additionalProperties: false` — sending them is a rejection, not a silent ignore. They do exist
  on `/create-tiles-pro` (`style_images`) and other endpoints of the same API, which is exactly
  what makes assuming them here so easy.

### Tiles Pro: kits with placement rules, not single tiles

`POST /create-tiles-pro` draws tile-shape outlines and has the model fill them, so by default it
produces **variations** rather than a connected set. `tile_type` ∈ hex, hex_pointy, isometric,
oblique, octagon, square_topdown; `tile_size` 16–256 (spec: 32px recommended); `tile_height` for
the extruded types; `tile_view` ∈ top-down, high top-down, low top-down, side, with
`tile_view_angle` and `tile_depth_ratio` for the 3D-looking views.

`tile_feature` switches the default: `roads` produces path autotile kits, `tileset` produces corner
Wang terrain transitions, `building` produces wall/floor construction kits (with
`building_wall_tiles`, `building_layout` grid|materials, per-floor descriptions). The response
tells you what you got: `kind` ∈ tiles, paths, tileset, coastline, building (default tiles), and
`tile_rules` carries the placement semantics — `rule_type` edge|corner|outline, `arity` 4 (square
or iso edges/corners) or 6 (hex edges), `connectivity` same|other, and a per-tile **bitmask**:
edge/4 `bit0=N bit1=E bit2=S bit3=W`, corner/4 `NW<<3|NE<<2|SW<<1|SE`, edge/6 hex edges CCW from
vertex 0. Tiles absent from the map are stamp-only — they carry no placement semantics.

Results come back as `storage_urls`, a map like `{"tile_0": "...", "tile_1": "..."}`, not inline
base64 like the other families. `DELETE /tiles-pro/{tile_id}` returns **409** while the tile is
still generating.

Prompting tip from the spec itself: number each variation in the description —
`"1). grass tile 2). dirt tile 3). stone tile"` — for control over which is which.

### Isometric tiles vs Tiles Pro — which one, when

- **A single map object** (a cube, a prop, a block that must stack): `POST /create-isometric-tile`.
  It is the only family fixed to the 2:1 dimetric projection, at 16–32 px, and its four-view
  chained output slots directly into the map's tiles.
- **A connected terrain or road kit in isometric view**: `POST /create-tiles-pro` with
  `tile_type=isometric` (or `hex_pointy` for hex maps). It produces the whole autotile set with
  `tile_rules` to place it, at any size 16–256 and view angle — but each kit is a `storage_urls`
  bundle you must place yourself, and the perspective is whatever `tile_view` you asked for, not
  necessarily the map's.

Both families are async and charged per generated tile; `mode='pro'` in top-down is the budget
escalation to watch (`guarding-generation-cost`).

### Perspective must match between tileset and character calls

The tileset camera enum is narrower than the general one:

`TilesetCameraView` = low top-down, high top-down

There is no `side` — the sidescroller family exists precisely because side view is a different
pipeline. The project standard is `low top-down` (`docs/adr/0005-low-top-down-8-direcoes.md:19@0f447499`),
and the endpoint default is **high top-down**. Omitting `view` puts the terrain in a different
perspective from the characters, with no error — and the same applies in the other direction: call
`/create-character-v3` with the identical `view` value you used for the terrain, or the two layers
never align in the editor.

### Retrieval quirks

All four families are asynchronous. `/create-tileset` and `/create-isometric-tile` declare **both
`200` and `202`** and may answer either — branch on the body, not the code (see
`orchestrating-pixellab-jobs`). The two always-async forms (`/tilesets`, `/tilesets-sidescroller`)
and `/create-tiles-pro` answer `202` only. Retrieval returns **423** while still generating, with
`Retry-After`; `DELETE /tiles-pro/{tile_id}` returns **409** while the tile is still generating.

```bash
S=.agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs
node $S endpoint /create-tileset
node $S response /tilesets/{tileset_id}
node $S flow /create-tiles-pro
```

### What the guides do not give you

The public guide at `pixellab.ai/docs/guides/map-tiles` is a **plugin UI tutorial**, not API
documentation: it covers selections and inpaint layers in the editor and contains no endpoint,
parameter or code. Everything above comes from the vendored spec
(`tools/pixellab-pipeline/openapi/openapi-v2.json`).

## References

- `querying-pixellab-api` — spec-query discipline, and why the public guides are not a source
- `orchestrating-pixellab-jobs` — the 423 retrieval contract and the dual 200/202 endpoints
- `composing-pixellab-objects` — props placed **on** a map, which is a different endpoint family
- `projecting-isometric-geometry` — the 2:1 dimetric math behind the tile shapes
- `guarding-generation-cost` — tile budgets and the `mode='pro'` escalation
