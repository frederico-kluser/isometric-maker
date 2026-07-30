---
name: applying-pixi-filters
description: Carries this game's budget rule for visual effects - a filter or mask forces a render target and breaks the batch, which is affordable on one element and not on a crowd, and several effects a pixel-art game wants are cheaper as art than as shaders. Use whenever adding a glow, tint, shadow, blur, colour grade, damage flash, fog of war or clipping mask, or diagnosing a frame-rate drop that started with an effect - including Portuguese phrasings like "efeito de brilho", "piscar quando toma dano", "sombra embaixo", "escurecer a tela", "recortar a area", "nevoa de guerra", "ficou lento depois do efeito", "mudar a cor". Triggers on filtro, mascara, blend, glow, flash, sombra, recorte, shader, efeito, render target.
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
| one element, occasionally — the targeted enemy, a full-screen grade | fine |
| one element, every frame — a glow that pulses on the player | probably fine, measure it |
| per entity in a crowd — every character with an outline | **no**; find an art-side answer |
| per tile | **never** |

The trap is that all four look identical in code. `container.filters = [...]` on one sprite and on two
hundred sprites is the same line, and only the second one costs the frame.

### Prefer art to shaders, in a pixel-art game especially

Several effects a game like this wants are cheaper, sharper and more controllable as authored pixels
than as shaders:

- **Outline / selection highlight** → a pre-authored outlined frame in the atlas, swapped on select.
  A shader outline on a pixel sprite also tends to produce non-pixel-aligned edges, which fights
  everything `choosing-pixi-renderer` sets up.
- **Damage flash** → tint, which is a batched per-sprite property, not a filter.
- **Ground shadow** → a sprite. A blurred ellipse costs nothing as art and a lot as a blur pass.
- **Team or faction colour** → tint, or a recoloured mask region the way the paper-doll research
  describes (`docs/03-arquitetura/paper-doll-e-equipamento.md:45-49@1316896a`).

Reach for a filter when the effect genuinely needs neighbouring pixels — blur, displacement, a real
colour grade over the whole screen. Those are the cases a shader is actually for.

### Masks cost the same way, and clipping is usually not needed

A mask is the same detour with a different name. Before adding one, check whether the thing can
simply not be drawn: culling, bounds, or an atlas frame that is already the right shape. Clipping a
minimap with a mask is reasonable; clipping every inventory slot is a mask per slot.

Fog of war is the case where this decision is worth writing down rather than improvising: as a
full-screen mask it is one detour, and as a per-tile mask it is thousands. If fog of war becomes a
requirement, it deserves its own decision record, because it also interacts with what the server is
willing to tell the client — and in a full-loot game, sending positions the player should not see is
an information leak, not a rendering choice.

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
  from a profile of this game, which does not exist. Treat it as a default to challenge with numbers,
  and update this skill when numbers exist.
- Research did not establish the cost ranking of the mask kinds, nor exactly which blend modes require
  the extension import. Read `pixijs-blend-modes` and `pixijs-filters` rather than trusting a recalled
  list.

## References

- `tools/pixi-reference/vendor/skills/pixijs-filters/SKILL.md` — built-in filters and the v8 construction API
- `tools/pixi-reference/vendor/skills/pixijs-blend-modes/SKILL.md` — which modes need the extension import
- `tools/pixi-reference/vendor/skills/pixijs-scene-core-concepts/references/masking.md` — mask kinds
- `.agents/skills/profiling-pixi-performance/SKILL.md` — how to turn the guesses above into measurements
