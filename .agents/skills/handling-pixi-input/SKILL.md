---
name: handling-pixi-input
description: Carries how this editor reads its user - the click that is itself the edit because there is no server to ask, the interactivity default that emits nothing until it is changed, and picking that walks the isometric diagonal instead of hit-testing tiles. Use whenever wiring clicks, pointer or keyboard input, selecting a celula or a bloco, painting by drag, deciding what one undo step contains, or diagnosing input that does not fire or picks the wrong thing - including Portuguese phrasings like "clicar na celula", "selecionar o bloco", "o clique nao funciona", "nao esta clicando", "clique atravessa", "pegou o bloco errado", "arrastar para pintar", "desfazer a edicao", "tecla nao responde", "atalho de teclado". Triggers on clique, ponteiro, celula, bloco, picking, eventMode, hitArea, teclado, arrastar, pintar, desfazer, hit test.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Handling input

## When to use

Before wiring the first click, before designing the map cursor, and whenever an event does not fire
or fires on the wrong thing.

For the event system itself read `tools/pixi-reference/vendor/skills/pixijs-events/SKILL.md`, and
`pixijs-math` for hit shapes and coordinate conversion.

## Injected knowledge

### The click is the edit, and undo is the safety net

This project is a local, single-user editor. There is nothing to ask permission from:

> "Sem servidor autoritativo, sem multiplayer, sem netcode, sem protocolo de rede, sem sharding."
> — `AGENTS.md:51@eb529ae5`

So a click on a cell **selects that cell**, a drag **paints**, a keypress **deletes**. The effect
lands on the open document, in this frame, with no round trip and nothing to confirm it.

What protects the user is therefore not authority — it is history. The undo/redo stack is ours to
write, and it was accepted as ours deliberately
(`docs/adr/0014-pixijs-para-o-editor.md:46@c4bf785c`). Two rules follow, and they are the whole
reason this section exists:

1. **An input handler must not mutate the document.** It builds a command and hands it to the
   history. A handler that writes straight into the map produces an edit that cannot be undone, and
   in an editor an un-undoable edit is the data loss.
2. **One gesture is one undoable command.** A drag that paints forty cells is a single entry, opened
   on pointer-down and committed on release — not forty entries, and not zero. Undo granularity is
   decided in the input layer and nowhere else, so getting it wrong here cannot be fixed downstream.

Keyboard shortcuts go through the same command path as the pointer. Two entry points building two
histories is how undo starts undoing something the user did not just do.

### Nothing is interactive until you say so

`EventMode` is `"none" | "passive" | "auto" | "static" | "dynamic"`
(`tools/pixi-reference/vendor/pixi-api.d.ts:20590@e58b8ac3`), and the default is `'passive'` —
which emits no events and is not hit-tested
(`tools/pixi-reference/vendor/pixi-api.d.ts:20574@e58b8ac3`). "My click handler never fires" is
almost always this, and it is the single most common input bug in v8.

The two that make something clickable:

- `'static'` — emits events, is hit-tested. What a button, a panel or the map surface wants.
- `'dynamic'` — also receives mock interaction events fired from a ticker, so an object under a
  stationary cursor still reacts when the *object* moves
  (`tools/pixi-reference/vendor/pixi-api.d.ts:20578@e58b8ac3`). That is work every tick whether
  anything moved or not, and the vendored docs say to use it *only* for moving or animated
  interactive elements (`tools/pixi-reference/vendor/pixi-api.d.ts:20585@e58b8ac3`). In an editor
  the pointer is usually what moves, so `'static'` is the answer unless something animates under a
  still cursor.

The v7 spelling still works: assigning true to the interactivity flag sets the mode to `'static'`
behind the scenes (`tools/pixi-reference/vendor/pixi-api.d.ts:20710@e58b8ac3`), and there is
**no deprecation warning at all**. That is convenient and dangerous — it means v7 input code
looks correct and reviews clean.

### The map is not hit-tested. Picking is arithmetic.

Hit-testing walks the tree, and a map is thousands of tiles. Do not make tiles interactive: the
fixed geometry already answers the question exactly.

> "o raio da câmera em espaço de grid é exatamente a diagonal `(+1,+1,+1)`. Selecionar o que está
> sob o cursor é caminhar essa diagonal do topo para baixo até achar o primeiro bloco sólido. Sem
> raycast, sem heurística."
> — `docs/adr/0013-geometria-isometrica-64x32-z16.md:39@e194895c`

So the whole map gets **one** hit shape, on the world container, and the pointer is converted to
grid coordinates by hand:

1. Convert the pointer position into the world container's local space. That one conversion already
   divides the stage scale out — do not divide by the scale factor again afterwards.
2. Invert the projection at the level you are testing:
   `a = sx/32`, `b = (sy + z*16)/16`, `x = (b+a)/2`, `y = (b-a)/2`
   (`docs/adr/0013-geometria-isometrica-64x32-z16.md:9@e194895c`).
3. Walk the diagonal `(+1,+1,+1)` downward from the highest occupied level and stop at the first
   solid block. Each level down is exactly `+1` in x and `+1` in y, so the walk is addition — step 2
   is paid once, not once per level.

That arithmetic assumes 32 and 16 are whole screen pixels, which holds because the stage scale is a
single integer factor: a 1,5× upscale destroys the 2:1 diamond seam
(`docs/adr/0013-geometria-isometrica-64x32-z16.md:38@e194895c`). The ADR states the seam, not the
picking consequence — that the pick would land off-centre inside the diamond under a fractional
factor is derived here.

Two consequences that are easy to miss:

- **One screen pixel maps to many cells.** Top-down order is what makes the answer single-valued;
  without it there is no "the" cell under the cursor, only a set.
- **Empty space still needs an answer.** When the walk finds no block, the pick is the ground plane
  at level zero — otherwise painting the first block on an empty map is impossible.

And the hover highlight must come from **the same walk** as the click, not from a cheaper
approximation. A highlight that disagrees with what the click selects is worse than no highlight,
because it teaches the user to distrust the cursor and click twice.

### Sprites are picked by a declared shape, never by bounds

Characters and props do stay individually interactive, and for them the rule is an explicit hit
shape rather than rendered bounds. A sprite's texture bounds include transparent margin, and the
atlas packer anchors at the feet — its default is `{ x: 0.5, y: 0.875 }`
(`tools/pixellab-pipeline/src/atlas.ts:216@a8bede59`) — so the margin sits mostly above the head and
bounds-based hits are generous in exactly the wrong direction.

That default is also already known to be wrong: with a Z level worth 16 px it misses by roughly
11 px on an inflated canvas, and the anchor becomes a measured value
(`docs/adr/0013-geometria-isometrica-64x32-z16.md:42@e194895c`). Input code must read the anchor
from the atlas data instead of assuming the constant, or the click target drifts by most of a level
the day the packer starts measuring.

Turn off child hit-testing on containers that are never clickable — ground, decoration, effects. The
flag defaults to true (`tools/pixi-reference/vendor/pixi-api.d.ts:20716@e58b8ac3`), so every static
child is walked until told otherwise. Confirm the member names with
`inspect-pixi.mjs members Container` rather than recalling them.

### Dragging is a stroke, and a stroke has to be closed

Painting cells, box-selecting and dragging a block are the same shape of gesture: open on
pointer-down, accumulate while the pointer moves, commit once on release.

- **Listen for `globalpointermove` (`tools/pixi-reference/vendor/pixi-api.d.ts:22603@e58b8ac3`), not
  `pointermove`.** In v8 the per-object move events fire only while the pointer is over the
  listening object, so a fast drag skips cells; the global ones fire on every movement regardless
  (`tools/pixi-reference/vendor/skills/pixijs-events/SKILL.md:84@7f436044`). The drag pattern is in
  that same skill.
- **Deduplicate by cell.** A slow drag inside one cell emits dozens of move events; the command
  holds cells, not events.
- **Close the stroke on `pointerupoutside`
  (`tools/pixi-reference/vendor/pixi-api.d.ts:22583@e58b8ac3`).** Listening only for release over
  the target leaves a stroke that never commits and a document stuck half-edited.

### Keyboard is not Pixi's

PixiJS handles pointer, mouse, touch and wheel. Keyboard is the DOM's, so keyboard handling lives
outside the scene graph and has to be torn down explicitly — see the teardown order in
`bootstrapping-pixi-app`. In an editor the destructive commands live on the keyboard, so a listener
that outlives the document it was bound to applies a delete to the wrong project.

Any label, tooltip or status text that input code produces is Brazilian Portuguese and comes from
the centralised string table, never from a literal at the call site
(`docs/adr/0016-ui-ptbr-strings-centralizadas.md:28@6de9bec2`).

### What is not verified

- No input code exists in this repository, and nothing here has ever rendered a frame
  (`docs/00-produto/visao.md:58@613eaec7`).
- The command/undo format does not exist yet. The rules above constrain it; they do not describe it.
- Three rules here are this skill's prescriptions, recorded in no ADR: one gesture equals one undo
  entry, the hover highlight reusing the click's walk, and the empty-space pick falling back to the
  ground plane at level zero. ADR 0014 makes the undo stack ours; it does not say how it is
  granularised, and ADR 0013 describes the walk without saying what a miss returns.
- Whether bounds-based hit-testing would be fast enough at this editor's sprite counts has not been
  measured, and neither has the cost of the diagonal walk on a deep stack.

## References

- `tools/pixi-reference/vendor/skills/pixijs-events/SKILL.md` — event modes, propagation, hit areas, cursors
- `tools/pixi-reference/vendor/skills/pixijs-math/SKILL.md` — hit shapes and coordinate conversion
- `docs/adr/0013-geometria-isometrica-64x32-z16.md` — the diamond, the Z level and the picking diagonal
- `docs/adr/0014-pixijs-para-o-editor.md` — why the picking and the undo stack are ours to write
- `docs/00-produto/glossario.md` — célula, bloco, nível Z: the words the UI and the code must use
