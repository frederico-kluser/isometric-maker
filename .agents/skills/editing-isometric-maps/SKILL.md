---
name: editing-isometric-maps
description: Owns how this editor places pieces on an isometric map - picking as a downward walk along the grid diagonal instead of sprite hit-testing, the pure floor, stack and edge tools, the RLE column store that keeps no holes, autotiling driven by rules the API returned, and an export that fails loudly when an atlas is missing. Use whenever selecting or placing a bloco, a parede or a porta, painting terrain, stacking or removing a block, wiring a brush, computing a neighbour mask, or exporting the project - including Portuguese phrasings like "colocar a peca no mapa", "empilhar um bloco em cima do outro", "clicou na celula errada", "pintar o terreno", "faltou a peca do autotile", "exportar o projeto", "o atlas nao foi encontrado", "desfazer a edicao". Triggers on pick, pickWithHighlight, pintarChao, empilharBloco, colocarNaAresta, buildMask, autotile, missingMasks, BlockStore, EdgeStore, exportProject, tile_rules, RLE, brush, footprint.
metadata:
  type: knowledge
  verification_signal: cd tools/map-builder && npm test
---

# Editing isometric maps

## When to use

Before wiring any tool that changes the map, before writing mouse-to-cell code, and before promising
an editing feature. Read the second half first if the request is about brushes, undo or layers: what
exists and what does not is the load-bearing part.

## Picking is arithmetic, not hit-testing

**Never hit-test sprites to find the cell under the cursor.** Isometric sprites are rectangles with
transparent corners; their bounding boxes overlap by design, so hit-testing picks whichever sprite
the scene graph happens to reach first. It is wrong at the diamond edges — exactly where the user
aims.

The right method is a walk, and it works because of the identity owned by
`projecting-isometric-geometry`: each Z level advances exactly `zStep/tileHeight` of a cell in both
axes, which is half a cell in this geometry
(`tools/map-builder/src/picking.ts:12@59f858fb`).

The algorithm (`tools/map-builder/src/picking.ts:160@59f858fb`):

1. Find `zMax`, the highest `z` holding blocks.
2. For `z` from `zMax` down to 0: convert `(sx, sy, z)` to world, floor to a cell, and if that cell
   has a block at `z`, return it.
3. Nothing occupied → return `null`, meaning "no cell", which is a real answer and not an error.

Top-down order is what makes it correct: the first hit is the nearest surface to the camera. Walking
bottom-up returns cells buried under other cells.

`pickWithHighlight` returns the picked cell **and** the floor cell below it
(`tools/map-builder/src/picking.ts:218@59f858fb`), because highlighting only the picked cell leaves
the user unable to see where a placement would land.

## The map model constrains the editor, and that is the point

- **Blocks are a dense column per `(x, y)`, indexed by `z` from 0 to the top, serialised with RLE**
  (`packages/iso-core/src/map.ts:92@0a012d80`). **A column has no holes**: its height is the highest
  occupied `z` plus one (`packages/iso-core/src/map.ts:90@0a012d80`). A tool that would leave a
  floating gap is not expressing a hole — it is producing an invalid column.
- **Edges are sparse.** Walls belong to edges, not cells, and either of the two cells sharing an edge
  may record it.
- **An object occupies exactly one cell.** The format forbids multi-cell sprites
  (`packages/iso-core/src/map.ts:34@0a012d80`) because they produce cyclic occlusion, which has no
  correct linear draw order. **Anything larger than one cell is sliced at authoring time.** A request
  for a 2×2 piece is a request to change the format, and it needs a decision.

## Autotiling consumes rules; it never hardcodes a table

The neighbour mask is 4 bits — a bit set when the neighbour in that direction carries the **same
terrain at the same `z`** (`tools/map-builder/src/autotile.ts:40@fc26feb1`). The piece is then looked
up in the `tile_rules` the API returned. **Do not write the 16-entry table by hand**
(`tools/map-builder/src/autotile.ts:12@fc26feb1`).

**A combination with no matching piece is a visible error, never a silent fallback**
(`tools/map-builder/src/autotile.ts:8@fc26feb1`). `missingMasks` exists so the editor can say
*which* combinations the tileset failed to deliver
(`tools/map-builder/src/autotile.ts:145@fc26feb1`). Substituting a nearby tile hides a tileset that
was paid for and came back incomplete.

**The bit order is a guess.** `bit0 = N, bit1 = L, bit2 = S, bit3 = O` is this repo's convention,
recorded as open assumption AB-371. The whole `tile_rules` parser rests on five such assumptions,
AB-370 through AB-374, because **the real fixture was never generated**
(`packages/iso-core/src/tile-rules.ts:9@4c299d05`). The API declares `additionalProperties: true` on
that payload, so the parser must reject fields it does not recognise rather than assume a shape
(`packages/iso-core/src/tile-rules.ts:13@4c299d05`).

Treat every autotiling result as provisional until one real response has been captured. Writing a
skill line, a test or a UI message that presents the bit order as settled would launder a guess into
a fact.

## Export is a contract, and it fails by absence

`project.json` is **the contract with the runtime**, with paths relative to the project file
(`tools/map-builder/src/export.ts:7@7b09f10b`). It is written atomically — temp file in the same
directory, then rename.

Every referenced atlas is checked to exist on disk **before** success is declared, and a missing one
**fails with the filename** (`tools/map-builder/src/export.ts:16@7b09f10b`). Exporting a project that
silently omits an atlas produces a runtime that loads and then draws nothing, and the cause is three
steps removed from the symptom.

### Authoring format and export format are deliberately different

The map is authored as RLE columns — compact, hole-free, heavily tested. It is **exported** as a
list of instances, where every placed block carries `id`, `x`, `y`, `z`, `kind` and `material`
already resolved, next to a material table with the physical properties
(`packages/iso-core/src/map-instances.ts`, `docs/adr/0027-exportacao-v2-instancias-e-materiais.md`).

Whoever writes physics should not have to decode RLE or carry the palette to find out whether a cell
is solid. The redundancy — `kind` and `material` appear in the palette *and* in each instance — is
deliberate and derived; it is never hand-edited.

The instance id is `b:x:y:z`, derived from the position. A counter would need persisted state kept in
sync with undo; a UUID would change every save and make the file undiffable. The consequence to know:
**moving a block changes its id**, because a block is not an entity that walks — it is the contents
of a cell.

## The rendering module does not edit

`scene.ts` is the renderer; `renderer.ts` is its superseded predecessor and still draws coloured
rectangles. Edits belong to the tool layer. Two boot constraints must hold before the first
`Assets.load`: nearest sampling with mipmaps off, and a whole-number stage scale. Sprites come from
a pool so that painting does not allocate per frame.

**Sprite scale must be uniform and the anchor declared.** Setting `width` and `height` separately
scales the axes differently, the art's top diamond stops being 2:1 and blocks stop seaming — the
symptom reads as "the generated art is wrong" and is not. `projecting-isometric-geometry` owns the
arithmetic; `tools/map-builder/src/placement.ts` is the one implementation, with tests.

## The placement tools that exist, and the state they return

Three modules under the editor's tool directory, all pure: each takes the current store and returns
a **new** one plus a pt-BR message. Nothing mutates in place, and nothing writes to the screen —
edits go through `iso-core` operations only (`tools/map-builder/src/tools/paint.ts:11@d704c95a`).

| Tool | Operations | Semantics that surprise |
|---|---|---|
| floor | `pintarChao`, `apagarChao` | paints at `z = 0` and **replaces** an existing block rather than refusing (`tools/map-builder/src/tools/paint.ts:4@d704c95a`) |
| stack | `empilharBloco`, `removerBloco`, `alturaColuna` | stacks at the first empty `z` **above the current top**, never into a gap; removes from the top only (`tools/map-builder/src/tools/stack.ts:8@b67dab5f`) |
| edge | `colocarNaAresta`, `removerDaAresta`, `elementoNaAresta`, `arestaProxima` | `arestaProxima` switches the cursor into edge mode by proximity, which is why placing a wall does not need a separate tool selection |

Both column rules follow from the store having no holes: stacking above the top and removing from the
top are the only operations that keep a column contiguous.

**Edges carry four element types** — `parede`, `porta`, `pilar`, `escada` — where a pillar sits on
the **vertex**, not the edge (`tools/map-builder/src/tools/wall.ts:23@027ac4e4`). Two of those four
have documented behaviour the model does not implement: a door is meant to allow passage and a stair
is meant to allow a step regardless of height, but `CollisionMap.hasEdge` takes no type, so nothing
can distinguish them. `simulating-isometric-physics` carries the full account. **Do not tell a user
that a placed door opens anything.**

The same three names — door, pillar, stair — are also identified in a returned tileset by a
**heuristic over the terrain name**, recorded as open assumption AB-372
(`packages/iso-core/src/tile-rules.ts:21@4c299d05`). The API may have a field that makes the
heuristic obsolete.

## What does not exist yet — say so instead of inventing it

- **Multi-cell brush shapes.** Single-cell operations exist; rectangle, line and bucket do not, and
  there is no convention for what one drag produces. Dragging with the button held repeats the
  single-cell operation, which is not the same thing.
- **Layer visibility by Z.** Nothing hides or dims the levels above the one being edited — the
  standard remedy for editing a floor under a roof.
- **Placement validity feedback.** `canEnter` and `canCross` exist in the model but are not wired to
  the real stores at all. The preview cube turns red for a destructive tool; that is tool state, not
  a validity check.
- **Physics that consumes the material table.** `map-instances.ts` resolves every placed block to a
  material with friction, density and movement cost, and `collision.ts` still reads the block store
  directly and ignores all of it. The **data** exists; the wiring does not.

Two entries that used to live here are now implemented, and claiming otherwise wastes a task:
**undo/redo** exists as a snapshot stack (`tools/map-builder/src/editor/map-state.ts`), and **camera
rotation** exists in four views with an animated turn (`rotating-isometric-camera`).

These are absences, not defects. **Do not invent a convention to fill one.** Propose it through
`meta-skill-evolution` as a draft, or ask. A rule invented to make a table look complete is exactly
the failure this skill library exists to prevent.

## Rules

- **Never hit-test a sprite to find a cell.** Walk the diagonal.
- **Never hand-write the autotile table.** Consume `tile_rules`, and surface what is missing.
- **Never present the mask bit order as settled.** It is AB-371, and it is a guess.
- **Never let an export succeed with a missing atlas.** Fail with the filename.
- **Never produce a column with a hole.** Height is derived from the top occupied level.
- **Never add an editing feature to the renderer.** That module renders.

## References

- `tools/map-builder/src/picking.ts` — the diagonal walk and the highlight pair
- `tools/map-builder/src/autotile.ts` — mask, lookup, and the missing-combination report
- `tools/map-builder/src/export.ts` — the runtime contract and failure by absence
- `packages/iso-core/src/map.ts` — `BlockStore`, `EdgeStore`, the one-cell object rule
- `packages/iso-core/src/tile-rules.ts` — the five open assumptions AB-370 to AB-374
- `.agents/skills/projecting-isometric-geometry/SKILL.md` — the identity that makes picking cheap
- `.agents/skills/generating-pixellab-tilesets/SKILL.md` — where `tile_rules` comes from
