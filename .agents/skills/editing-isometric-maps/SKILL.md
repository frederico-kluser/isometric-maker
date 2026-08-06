---
name: editing-isometric-maps
description: Owns how this editor places blocks on the isometric map, Three.js only: picking is Raycaster with the face-normal contract — click the face of a cube to place in the adjacent cell, click the ground plane to place at z=0 — backed by a pure MapData→MapData editing state (placeBlock, removeBlock, paintBlock, stackBlock, undo/redo), an RLE column store with no holes, autotile rules that survive in iso-core but never reached the UI, and the export contract buildExport. Use whenever selecting or placing a piece, painting terrain, stacking or removing a block, or exporting the map — including PT-BR phrasings like "colocar a peca no mapa", "empilhar um bloco em cima do outro", "clicou na celula errada", "clique na face do cubo", "pintar o terreno", "faltou a peca do autotile", "exportar o projeto", "desfazer a edicao". Triggers on pick3d, pickColumnTop, hitFace, face normal, ground plane, paintBlock, removeBlock, placeBlock, stackBlock, autotile, tile_rules, RLE, Cell3D, undo, redo, buildExport, MapData.
metadata:
  type: knowledge
  verification_signal: cd tools/character-builder && npm test
---

# Editing isometric maps

## When to use

Before wiring any tool that changes the map, before writing mouse-to-cell code, and before promising
an editing feature. Read the second half first if the request is about brushes, undo or layers: what
exists and what does not is the load-bearing part.

## Picking is DDA voxel raycasting — the face normal is the contract

**DDA walks the MapData, not the meshes.** The 2D editor picked a cell by walking the grid diagonal
from the top down; that arithmetic is retired with the 2D renderer. The 3D editor fires a ray
from the camera through the cursor and walks the `MapData` RLE columns directly using the
Amanatides-Woo DDA algorithm (`packages/iso-core/src/dda-raycast.ts:65-210`). No meshes are
needed — the ray marches through the voxel grid, querying `isOccupied` against the RLE data on
every step.

The contract (`tools/character-builder/src/map/3d/pick3d-raycaster.ts:44-56`):

- `hit` — the **occupied** cell under the cursor: the target of `remover` and `pintar`. `null` when
  the cursor is over empty space.
- `placement` — the **empty** cell where a new piece lands. **Placement is never null**: the ground
  plane guarantees a fallback, so a tool always has a cell to write to.
- `hitFace` — `'top' | 'side' | 'ground' | null`: what the ray actually hit, and the input the stack
  tool uses to decide where a piece lands.

Two rules follow from the face normal (`tools/character-builder/src/map/3d/pick3d-raycaster.ts:197-280`):

1. **Clicking the face of a cube places in the adjacent cell.** The hit's face normal — derived
   from the DDA step direction in map coordinates — is added to the cube's cell. This is the
   Minecraft-style contract: clicking the side of a block lands the new block *next to* it.
2. **Clicking the ground plane places at z = 0.** Empty space intersects the z=0 plane
   analytically, and `hit` stays `null` — "no cell under the cursor" is a real answer, and
   `pintar` on empty ground places instead of refusing.

The `empilhar` tool gets a narrower contract. `pickColumnTop`
(`tools/character-builder/src/map/3d/pick3d-raycaster.ts:291-308`) keeps the exact placement
when the ray hit a side face or the ground, but when the ray hits a **top** face it snaps the
placement to the top of that column — stacking works even when the user is not aiming at the exact
top face.

Coordinate mapping: Three.js is Y-up. Map `(x, y, z)` lives in the world as `(x, z, y)` — map `y`
becomes world `Z`, map `z` (height) becomes world `Y`. The DDA engine operates entirely in map
coordinates (`worldToMap` at `tools/character-builder/src/map/3d/pick3d-raycaster.ts:89-91`) so
the coordinate mapping happens once at the boundary, not on every DDA step.

The picking mechanics themselves (NDC, `setFromCamera`, DDA walk) are owned by
`raycasting-threejs-blocks`; this skill owns what the editor does with the result.

## The map model constrains the editor, and that is the point

- **Blocks are a dense column per `(x, y)`, indexed by `z` from 0 to the top, serialised with RLE**
  (`packages/iso-core/src/map.ts:92@0a012d80`). **A column has no holes**: its height is the highest
  occupied `z` plus one (`packages/iso-core/src/map.ts:90@0a012d80`). A tool that would leave a
  floating gap is not expressing a hole — it is producing an invalid column.
- **An object occupies exactly one cell.** The format forbids multi-cell sprites
  (`packages/iso-core/src/map.ts:34@0a012d80`) because they produce cyclic occlusion, which has no
  correct linear draw order. **Anything larger than one cell is sliced at authoring time.** A request
  for a 2×2 piece is a request to change the format, and it needs a decision.
- **Edges are sparse and survive in the format, but nothing edits them.** Walls belonged to edges,
  and either of the two cells sharing an edge may record it
  (`packages/iso-core/src/map.ts:277@0a012d80`). The wall tooling was removed with the 2D editor;
  `MapData` still carries `edges` for the runtime (`packages/iso-core/src/map.ts:71@0a012d80`), and
  no editor tool touches them today.

## The editing state is a pure module, shared by every editor

`map/editor/map-state.ts` is the state machine. It is **pure**: no React, no Three, no DOM — every
mutation is `MapData → MapData`
(`tools/character-builder/src/map/editor/map-state.ts:4@3f5156b0`). Undo/redo is a snapshot stack
(100 entries), not an inverse-command system, and **an identical map does not create an entry** —
dragging the mouse over the same cell would otherwise generate dozens of empty undo steps
(`tools/character-builder/src/map/editor/map-state.ts:159@3f5156b0`).

The operations, and the semantics that surprise:

| Operation | Semantics |
|---|---|
| `placeBlock` (`tools/character-builder/src/map/editor/map-state.ts:67@3f5156b0`) | Places at the exact cell. Intermediate levels become explicit air — that is what allows a bridge with a gap underneath. Negative `z` is refused by returning the map intact. |
| `removeBlock` (`tools/character-builder/src/map/editor/map-state.ts:83@3f5156b0`) | Empties the cell; a column left as all air disappears from the map. |
| `paintBlock` (`tools/character-builder/src/map/editor/map-state.ts:105@3f5156b0`) | Replaces the type of an already-occupied cell; an empty cell stays as it is. |
| `stackBlock` | Places at the first empty `z` **above the current top**, never into a gap. |

The camera rotation never appears in the document — `MapData` does not know the view angle
(`tools/character-builder/src/map/editor/map-state.ts:9@3f5156b0`). The editor opens on an 8×8
starter platform so there is always a floor to click
(`tools/character-builder/src/map/editor/map-state.ts:196@3f5156b0`).

## The three editor modes

The editor has three modes (`tools/character-builder/src/map/3d/map-editor-3d.tsx:213`):

| Mode | Purpose |
|---|---|
| `'editar'` | Place, remove, paint blocks |
| `'testar'` | Run the test character with WASD movement |
| `'simular'` | Run block physics simulation (falling blocks, domino effect) |

The Escape key handler has three branches (`tools/character-builder/src/map/3d/map-editor-3d.tsx:1095-1104`):
- In `'testar'`: exits test mode
- In `'simular'`: exits simular mode (discarding changes)
- In `'editar'`: no-op (passed to browser)

## The placement tools that exist — the editor is the tool layer

Four tools, and they are thin: `empilhar`, `colocar`, `pintar`, `remover`
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:172`). The component resolves the
pointer to a `Pick3DResult` via DDA and feeds it to the map-state operations; nothing mutates in
place and nothing writes to the screen from the tool layer
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:417-484`):

- `remover` → `removeBlock(hit)` when the cursor is over a block;
- `pintar` → `paintBlock(hit)` on an occupied cell, `placeBlock(placement)` on empty ground;
- `colocar` and `empilhar` → `placeBlock(placement)` — the difference is entirely in the picking:
  `colocar` uses the exact adjacent cell from the face normal, `empilhar` uses `pickColumnTop` so a
  top-face click stacks on the column top (`tools/character-builder/src/map/3d/map-editor-3d.tsx:258@e80414d9`).

The old pure tool modules (`map/tools/paint.ts`, `stack.ts`, `wall.ts`) are gone with the 2D editor;
their semantics now live in map-state.ts and in the picking functions above.

Preview and feedback are tool state, not validity: the preview cube sits on the placement cell and
turns red only for `remover` (a destructive action), and the highlight marks the occupied cell under
the cursor (`tools/character-builder/src/map/3d/map-editor-3d.tsx:204`,
`tools/character-builder/src/map/3d/scene3d.ts:688`).

Dragging with the button held repeats the single-cell operation per pointer move — that is **not** a
brush (`tools/character-builder/src/map/3d/map-editor-3d.tsx:506`).

**Keyboard (edit mode):** `R` rotates (shift+R reverses), `1`–`4` pick a discrete view,
Ctrl+Z/Y undo and redo, arrow keys pan the camera 10% of the viewport per step
(`tools/character-builder/src/map/3d/map-editor-3d.tsx:1114-1137`). Middle mouse or shift+drag
pans; wheel zooms with coalesced deltas and continuous damping.

## Simular mode: block physics simulation

The "Simular" button (`tools/character-builder/src/map/3d/map-editor-3d.tsx:1358-1367`) enters
a simulation mode backed by `packages/iso-core/src/block-physics.ts`. It:

1. Snapshots the map (`simOriginalMapRef`)
2. Builds a `BlockWorld` from the RLE columns (`buildBlockWorld`)
3. Runs `initBlockPhysics` to find unsupported blocks
4. Starts a 100ms-tick rAF loop calling `stepBlockPhysics`

The simulation UI has four controls (`tools/character-builder/src/map/3d/map-editor-3d.tsx:1280-1334`):
- **Play/Pause** — toggle the simulation loop
- **Step** — advance one physics step (even when paused)
- **Aplicar** — apply the simulation result to the document (pushes a new history entry)
- **Descartar** — discard changes, restore original map

The support rule (`hasSupport` in `packages/iso-core/src/block-physics.ts:80-89`): a block at
`(x,y,z)` has support if `z === 0` (floor) or a block exists at `(x,y,z-1)`. Unsupported
blocks fall 1 level per `fallInterval` ticks (6 ticks at 1/60s each = ~100ms per level).
When a falling block hits a supported position, it lands. Blocks that fell can destabilize
blocks below them — the domino effect is handled by `findUnsupported` detecting new
unsupported blocks after each descent.

The entity collision: if a falling block lands on the test character's cell, the character is
pushed out via MTV (`pushPlayerOutOfCell` in `packages/iso-core/src/block-physics.ts:227-243`).

## The rendering module does not edit

`scene3d.ts` is the renderer. `createIsoScene3D` builds the WebGLRenderer, the lights, the
orthographic camera, the grid and the ground plane; the scene lives **outside React**, created once
in a `useEffect` and updated by imperative calls to `render(state)`
(`tools/character-builder/src/map/3d/scene3d.ts:192-868`). `render` takes the whole
`Scene3DState` — map, preview, highlight, rotation, actor — and draws it in one pass
(`tools/character-builder/src/map/3d/scene3d.ts:710-714`).

`syncBlocks` diffs instanced meshes against the RLE map: it iterates the runs, adds cells to
`BlockInstancing` for every occupied cell that has no instance yet, and removes instances whose
cells are gone (`tools/character-builder/src/map/3d/scene3d.ts:581-684`). Hidden cells (fully
surrounded) are culled by `computeHiddenCells` before instancing. A shared `BoxGeometry` is
reused for every cube of the same sprite proportion — nothing allocates geometry per block.
Textures keep nearest filtering with mipmaps off so pixel art stays crisp.

The grid and the ground plane resize to cover the occupied area plus a margin, so there is always a
clickable floor around the content (`tools/character-builder/src/map/3d/scene3d.ts:677-679`).
Camera controls live in `controls3d.ts` — pan, continuous damped zoom, and the four discrete
views; the 280 ms rotation animation is driven by the single rAF tick loop
(`tools/character-builder/src/map/3d/scene3d.ts:318-395`).

**Never add an editing feature to the renderer.** Edits belong to the tool layer, and this module
renders.

## Autotiling consumes rules; it never hardcoded a table — and it never reached the UI

Domain knowledge, kept because the rules survive in iso-core even though the editor-side module is
gone. Autotile was **never wired to the UI**: no brush paints with a neighbour mask, and the 2D
editor's `autotile.ts` was removed with the rest of the 2D editor. The `tile_rules` parser lives
on in `packages/iso-core/src/tile-rules.ts`, and any future autotile wiring must respect it.

The neighbour mask is 4 bits — a bit set when the neighbour in that direction carries the **same
terrain at the same `z`** — and the piece is looked up in the `tile_rules` the API returned. **Do not
write the 16-entry table by hand.** **A combination with no matching piece is a visible error —
never a silent fallback**: substituting a nearby tile hides a tileset that was paid for and came
back incomplete.

**The bit order is a guess.** `bit0 = N, bit1 = L, bit2 = S, bit3 = O` is this repo's convention,
recorded as open assumption AB-371. The whole parser rests on assumptions AB-370 through AB-375
(`packages/iso-core/src/tile-rules.ts:13@4c299d05`) because **the real fixture was never generated**
(`packages/iso-core/src/tile-rules.ts:9@4c299d05`). The API declares `additionalProperties: true` on
that payload, so the parser must reject fields it does not recognise rather than assume a shape.
Treat every autotiling result as provisional until one real response has been captured.

## Export is a contract — built in iso-core, not in the editor

`buildExport` (`packages/iso-core/src/map-instances.ts:213@372c1f8c`) turns a `MapData` plus a
catalog into the export document; the editor calls it with the tile geometry and downloads the
result as `mapa.json` (`tools/character-builder/src/map/3d/map-editor-3d.tsx:417@e80414d9`).

### Authoring format and export format are deliberately different

The map is **authored as RLE columns** — compact, hole-free, heavily tested. It is **exported** as a
list of instances, where every placed block carries `id`, `x`, `y`, `z`, `kind` and `material`
already resolved, next to a material table with the physical properties
(`docs/adr/0027-exportacao-v2-instancias-e-materiais.md`). Whoever writes physics should not have to
decode RLE or carry the palette to find out whether a cell is solid. The redundancy — `kind` and
`material` appear in the palette *and* in each instance — is deliberate and derived; it is never
hand-edited.

The instance id is `b:x:y:z`, derived from the position
(`packages/iso-core/src/map-instances.ts:47@372c1f8c`). A counter would need persisted state kept in
sync with undo; a UUID would change every save and make the file undiffable. The consequence to
know: **moving a block changes its id**, because a block is not an entity that walks — it is the
contents of a cell.

**The old atlas check is gone, and that is a behaviour change.** The 2D editor's `export.ts`
checked every referenced atlas on disk before declaring success and failed with the filename; that
module was removed. `buildExport` is a pure function in iso-core — the browser editor cannot see the
filesystem — so a missing asset surfaces only when the runtime loads, not at export time. Do not
promise an editor-side absence check; the contract that remains is the instance format itself.

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
  material with friction, density and movement cost
  (`packages/iso-core/src/map-instances.ts:134@372c1f8c`), and the collision code still reads the
  block store directly and ignores all of it. The **data** exists; the wiring does not.
- **Autotiling wired to the UI.** The rules survive in iso-core; no brush consumes them.
- **Edge editing.** Walls, doors and stairs have no editor tool since the 2D editor was removed.
  `simulating-isometric-physics` carries the account of what the model does and does not honour for
  doors and stairs.

Entries that are now implemented and must not be claimed as absent:
- **undo/redo** — snapshot stack (`tools/character-builder/src/map/editor/map-state.ts:141`)
- **camera rotation** — four views with animated turn (`rotating-isometric-camera`)
- **block physics simulation** — simular mode with Play/Pause/Step/Apply/Discard (this section)
- **DDA voxel raycasting** — Amanatides-Woo DDA replaces Three.js Raycaster for picking (`raycasting-threejs-blocks`)
- **camera pan with arrow keys** — 10% viewport per step in edit mode
- **touch/pinch zoom** — `setZoomAnchored` with absolute zoom from pinch gestures
- **zoom-to-fit** — projects 8 bounding box vertices, fits with 10% margin
- **coalesced wheel zoom** — accumulated per frame, anchored on cursor, continuous damped

These are absences, not defects. **Do not invent a convention to fill one.** Propose it through
`meta-skill-evolution` as a draft, or ask. A rule invented to make a table look complete is exactly
the failure this skill library exists to prevent.

## Rules

- **Never pick a cell with arithmetic.** Raycast, and let the face normal decide the adjacent cell.
- **Never hand-write the autotile table.** Consume `tile_rules`, and surface what is missing.
- **Never present the mask bit order as settled.** It is AB-371, and it is a guess.
- **Never produce a column with a hole.** Height is derived from the top occupied level.
- **Never add an editing feature to the renderer.** That module renders.

## References

- `tools/character-builder/src/map/3d/pick3d-raycaster.ts` — hit, placement, and the face-normal contract
- `tools/character-builder/src/map/3d/scene3d.ts` — the Three.js scene, the mesh diff, and the raycast targets
- `tools/character-builder/src/map/3d/map-editor-3d.tsx` — the tool layer and pointer wiring
- `tools/character-builder/src/map/3d/block-def.ts` — `BlockDef`, `Facing`, `Cell3D` (extracted from the old `scene.ts`)
- `tools/character-builder/src/map/editor/map-state.ts` — pure `MapData → MapData` state and history
- `tools/character-builder/src/map/editor/blocks-api.ts` — the palette; `BlockDef` (appearance) vs `BlockDefinition` (physics)
- `packages/iso-core/src/map.ts` — `MapData`, RLE columns, the one-cell object rule
- `packages/iso-core/src/tile-rules.ts` — the open assumptions AB-370 to AB-375
- `packages/iso-core/src/map-instances.ts` — instances, ids, `buildExport`
- `.agents/skills/raycasting-threejs-blocks/SKILL.md` — the raycaster mechanics behind the contract
- `.agents/skills/rotating-isometric-camera/SKILL.md` — the four views and the animated turn
- `.agents/skills/generating-pixellab-tilesets/SKILL.md` — where `tile_rules` comes from
