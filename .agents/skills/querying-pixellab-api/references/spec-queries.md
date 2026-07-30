# Raw spec queries

Loaded on demand. Use `scripts/inspect-spec.mjs` first — these are for the cases it does not cover,
and for reading when you need to know *how* it answers.

## Contents

- [Why naive queries return wrong answers](#why-naive-queries-return-wrong-answers)
- [Existence and operation shape](#existence-and-operation-shape)
- [Required fields, enums and numeric bounds](#required-fields-enums-and-numeric-bounds)
- [All named enums](#all-named-enums)
- [Size limits per endpoint](#size-limits-per-endpoint)
- [Spec structure reference](#spec-structure-reference)

## Why naive queries return wrong answers

Two shapes in this spec defeat the obvious query:

**Optional fields wrap their real schema.** A nullable field is
`anyOf: [{...real...}, {"type": "null"}]`, so `.properties.x.enum` is `null` for most constrained
fields. Every query below reaches through with `..|objects`.

**`/balance` has no POST.** A query written as `.paths[$p].post` returns `null` for GET-only paths and
reads as "missing". Iterate over methods instead.

## Existence and operation shape

```bash
cd tools/pixellab-pipeline/openapi

jq -r --arg p "/create-tileset" '
  (.paths[$p] // {"__missing__":true}) as $o
  | if $o.__missing__ then "MISSING \($p)"
    else ($o | to_entries[] | .key as $m | .value |
      "\($m|ascii_upcase) \($p)  opId=\(.operationId)\n" +
      "  reqSchema=\((.requestBody.content["application/json"].schema["$ref"] // "-")|sub("^#/components/schemas/";""))\n" +
      "  pathParams=\([(.parameters//[])[]|.name]|join(","))\n" +
      "  responses=\(.responses|keys|join(","))")
    end' openapi-v2.json
```

## Required fields, enums and numeric bounds

```bash
jq -r --arg s CreateTilesetRequest '
  .components.schemas[$s]
  | "required=[\((.required//[])|join(","))]",
    (.properties | to_entries[] | .key as $k | .value
     | [ ..|objects
         | select(has("enum") or has("maximum") or has("minimum") or has("multipleOf") or has("$ref"))
         | {enum, maximum, minimum, multipleOf, ref: .["$ref"]}
         | with_entries(select(.value != null)) ]
     | map(select(length > 0)) | unique | select(length > 0)
     | "  \($k) \(tostring)")' openapi-v2.json
```

## All named enums

```bash
jq -r '.components.schemas | to_entries[] | select(.value.enum)
       | "\(.key) = \(.value.enum | join(", "))"' openapi-v2.json
```

Verified values at snapshot time:

```text
CameraView         = side, low top-down, high top-down
TilesetCameraView  = low top-down, high top-down
Direction          = north, north-east, east, south-east, south, south-west, west, north-west
Outline            = single color black outline, single color outline, selective outline, lineless
Shading            = flat shading, basic shading, medium shading, detailed shading, highly detailed shading
Detail             = low detail, medium detail, highly detailed
SkeletonLabel      = 18 keypoints, NOSE … LEFT EAR
```

Note `Shading` — every value carries the word `shading`. Quoting it as `flat, basic, medium` is a
common transcription slip and `check-spec-claims.mjs` will reject it.

## Size limits per endpoint

```bash
jq -r '.components.schemas | to_entries[]
       | select(.key | test("ImageSize|TileSize|OutputSize"; "i"))
       | "\(.key | sub("^app__endpoints__external__v2__"; ""))  \(.value.properties.width | tostring)"' \
  openapi-v2.json
```

There is no global size rule. Each endpoint namespaces its own `ImageSize`, so a limit quoted from
one endpoint is wrong for most others.

## Spec structure reference

Five top-level keys: `openapi`, `info`, `servers`, `paths`, `components`.

- `servers` is `[{"url": "/v2"}]`; the absolute base is hardcoded in the client at
  `tools/pixellab-pipeline/src/api.ts:17@314e8627`
- `components` has only `schemas` and `securitySchemes` (`HTTPBearer`)
- request bodies are always `requestBody.content["application/json"].schema.$ref`
- shared numeric idioms: `text_guidance_scale` and `guidance_scale` 1–20, `init_image_strength`
  1–999, `seed` ≥ 0
