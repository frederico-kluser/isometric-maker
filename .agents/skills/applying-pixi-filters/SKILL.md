---
name: applying-pixi-filters
description: Carries this project's budget rule for visual effects - a filter or mask forces a render target and breaks the batch, which is affordable on one element and not on a crowd, and several effects a pixel-art editor wants are cheaper as art than as shaders. Use whenever adding a glow, tint, shadow, blur, colour grade, cursor or selection highlight, dimmed Z level or clipping mask, or diagnosing a frame-rate drop that started with an effect - including Portuguese phrasings like "efeito de brilho", "destacar a celula sob o cursor", "realcar a selecao", "sombra embaixo", "esmaecer as camadas acima", "escurecer a tela", "recortar a area", "ficou lento depois do efeito", "mudar a cor". Triggers on filtro, mascara, blend, glow, realce, destaque, sombra, recorte, shader, efeito, render target.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Applying filters, masks and blend modes

## When to use

Before adding any visual effect, and whenever frame rate dropped right after one was added.

For the API read `tools/pixi-reference/vendor/skills/pixijs-filters/SKILL.md` and
`pixijs-blend-modes`; masks are covered in
`vendor/skills/pixijs-scene-core-concepts/references/masking.md`.

## Injected knowledge

### The budget rule, which is the whole point of this skill

A filter is not a property, it is a **rendering detour**: the subtree is drawn into a texture, the
shader runs, the result is composited. That costs a render-target switch and ends the batch the
subtree would otherwise have joined.

The rule this project uses, in the absence of measurements:

| Scale | Verdict |
|---|---|
| one element, occasionally — the selected object, a full-screen grade | fine |
| one element, every frame — a glow that pulses on the cell under the cursor | probably fine, measure it |
| per entity in a crowd — every placed object with an outline | **no**; find an art-side answer |
| per tile | **never** |

The trap is that all four look identical in code. `container.filters = [...]` on one sprite and on two
hundred sprites is the same line, and only the second one costs the frame. An editor reaches the bad
rows by accident more easily than a game does: "highlight everything the selection covers" is one
checkbox in the UI and a filter per tile underneath.

### Prefer art to shaders, in a pixel-art editor especially

Several effects this editor wants are cheaper, sharper and more controllable as authored pixels or as
batched per-sprite properties than as shaders:

- **Selection outline** → a pre-authored outlined frame in the atlas, swapped while the object is
  selected. A shader outline on a pixel sprite also tends to produce non-pixel-aligned edges, which
  fights everything `choosing-pixi-renderer` sets up.
- **Highlight of the cell under the cursor** → one sprite — a diamond the size of a tile — moved to
  the picked cell, or a tint on the tile already there. Both stay in the batch. Finding the cell is
  arithmetic, not a shader problem: picking is walking the `(+1,+1,+1)` diagonal from the top down
  until the first solid block (`docs/adr/0013-geometria-isometrica-64x32-z16.md:39@e194895c`).
- **Ground shadow** → a sprite. A blurred ellipse costs nothing as art and a lot as a blur pass.
- **Recolouring a region of a wardrobe piece** → tint, or a recoloured mask region the way the
  wardrobe research describes (`docs/02-personagem/guarda-roupa-e-silhueta.md:49-53@be1e5781`).

Reach for a filter when the effect genuinely needs neighbouring pixels — blur, displacement, a real
colour grade over the whole screen. Those are the cases a shader is actually for.

### Masks cost the same way, and clipping is usually not needed

A mask is the same detour with a different name. Before adding one, check whether the thing can
simply not be drawn: culling, bounds, or an atlas frame that is already the right shape. Clipping a
map preview panel with a mask is reasonable; clipping every thumbnail of the tile palette is a mask
per thumbnail.

### Dimming the Z levels above the one being edited

This is the editor's version of the decision worth writing down rather than improvising, because the
cheap version and the ruinous one are the same feature to the user. Z is integer and discrete in this
project (`docs/adr/0013-geometria-isometrica-64x32-z16.md:24@e194895c`), so "the levels above" is a
set of whole levels rather than a continuous height field — which is what makes the cheap version
available at all. Applied once per level it is a handful of operations; applied as a filter or mask
per tile it is thousands of detours.

Per-sprite tint on the dimmed levels stays in the batch, which is why it is the first thing to reach
for. A full-screen darkening filter is only one detour, but it also darkens the level being edited,
which is the one thing the feature exists to keep legible.

**Not verified:** whether the scene groups sprites per Z level, which is what decides whether "once
per level" is one call or a loop over every sprite. Check `composing-pixi-scene` before assuming it.
No product doc names this feature and no decision record covers it — the paragraph above is the
budget reasoning to apply *if* it becomes a requirement, not a decision already taken. If it does
become one, it deserves its own record, the way any feature whose cheap and ruinous versions look
identical to the user does.

### Blend modes are cheap, until they are not

Simple blend modes ride along with normal batching. The advanced ones live behind a separate import
in v8 and are more expensive; `pixijs-blend-modes` lists which is which. Check before assuming a mode
is free, and remember that mixing blend modes within a batch splits it — the same batching cost as a
filter, arriving without the word "filter" anywhere in the code.

### Filters were rewritten in v8

The filter construction API changed shape between v7 and v8, so a custom filter recalled from memory
will not compile — which is, for once, a v7 habit that fails loudly. Built-in filters and the extra
filter package are separate things; only what is in the pinned `pixi.js` is available here, and
adding the extras package is a dependency decision, per `routing-pixijs-work`.

Verify anything before writing it:

```bash
S=.agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs
node $S grep Filter          # what filters the pinned version actually ships
node $S members Filter       # the v8 construction surface
node $S prop filters         # where the property lives
```

### What is not verified

- **Nothing here has been measured.** The budget table is reasoning from how render targets work, not
  from a profile of this editor, which does not exist. Treat it as a default to challenge with
  numbers, and update this skill when numbers exist.
- Research did not establish the cost ranking of the mask kinds, nor exactly which blend modes require
  the extension import. Read `pixijs-blend-modes` and `pixijs-filters` rather than trusting a recalled
  list.

## References

- `tools/pixi-reference/vendor/skills/pixijs-filters/SKILL.md` — built-in filters and the v8 construction API
- `tools/pixi-reference/vendor/skills/pixijs-blend-modes/SKILL.md` — which modes need the extension import
- `tools/pixi-reference/vendor/skills/pixijs-scene-core-concepts/references/masking.md` — mask kinds
- `.agents/skills/profiling-pixi-performance/SKILL.md` — how to turn the guesses above into measurements
- `docs/02-personagem/guarda-roupa-e-silhueta.md` — the recolour-by-region mechanism, and why silhouette is an authoring constraint
