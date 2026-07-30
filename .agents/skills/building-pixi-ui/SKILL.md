---
name: building-pixi-ui
description: Carries how this game draws text and interface - every player-visible string is Brazilian Portuguese with accents that break naive bitmap fonts, glyph-atlas text is the default because the HUD updates every tick, and no UI toolkit has been verified against the pinned version. Use whenever adding a label, HUD element, damage number, inventory or menu, choosing a font, or diagnosing text that is blurry, missing accents or expensive - including Portuguese phrasings like "texto na tela", "mostrar o nome", "numero de dano", "barra de vida", "menu de inventario", "a acentuacao sumiu", "a fonte esta borrada", "o texto esta pesado". Triggers on texto, fonte, HUD, rotulo, interface, acentuacao, BitmapText, glifo, inventario, menu.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Building the interface

## When to use

Before adding any text, before choosing a font, and before proposing a UI toolkit.

For the API read `tools/pixi-reference/vendor/skills/pixijs-scene-text/SKILL.md`, which has five
reference documents covering the three text classes.

## Injected knowledge

### Every string the player reads is Brazilian Portuguese

This is a hard rule of the repository, not a localisation plan:

> "Todo texto que o jogador lê (UI, itens, diálogo, mensagens de erro do jogo)" — português do Brasil
> — `AGENTS.md:9@e451cfee`

The rendering consequence is concrete and easy to miss until it ships: pt-BR needs
`á à â ã é ê í ó ô õ ú ç` and their capitals. A glyph atlas built from an ASCII character set renders
those as blanks or as the fallback box — and the failure is *content-dependent*, so it survives every
test that happens to use unaccented words. Any bitmap font this project installs must declare the
accented range explicitly, and the check for it belongs in whatever generates the font, not in review.

Identifiers, types and JSON keys stay English (`AGENTS.md:11@e451cfee`). A label's variable name is
English; its value is Portuguese.

### Glyph-atlas text is the default here, and the reason is the HUD

Pixi offers canvas-rendered text and glyph-atlas text. Canvas-rendered text re-rasterises when its
string changes, which is fine for a title and wrong for anything that changes every tick — health,
damage numbers, the oscillating hit chance, cooldowns. In this game that is most of the HUD.

So: **glyph-atlas text for anything that updates, canvas text only for static strings.** Confirm the
class names and the font-installation call with `inspect-pixi.mjs grep Text` and
`inspect-pixi.mjs exists BitmapFont` before writing either.

The pixel-art constraint from `choosing-pixi-renderer` applies to fonts too: a pixel font must be
sampled nearest and drawn at an integer scale, or it blurs exactly like the sprites do. A font
designed at 8px displayed at 1.5× is unreadable in a way that reads as "the font is bad".

### Damage numbers are the awkward case

They are anchored to a world position but must not scale with camera zoom, so they live in screen
space with their position converted per frame — the world/screen split is in `composing-pixi-scene`.
They are also numerous, short-lived and all the same size, which makes them the one HUD element worth
pooling rather than allocating: creating and destroying text objects per hit is how a fight drops
frames.

### No UI toolkit has been verified

The community UI and layout packages are **not installed here, and their compatibility with the
pinned 8.19.0 was not established by research** — it is one of the explicit gaps. Nothing in this
repository has verified them.

That leaves two honest options, and picking between them is a decision to record, not an
implementation detail:

1. **Hand-rolled containers plus glyph-atlas text.** No dependency, no compatibility risk, and full
   control of the pixel grid — which a pixel-art HUD needs anyway. Costs more code.
2. **Adopt a toolkit**, after verifying its version against the pin and recording the result.

Given that this game's UI is a pixel-art HUD on an integer grid, option 1 is the lower-risk default,
and the burden of proof is on adopting a dependency rather than on avoiding one.

### The HUD has to show things the combat design requires

Not renderer detail, but it constrains the UI's shape, so it belongs here. Engagement is lock-on with
four zones on keys `1`–`4`, and the per-zone chance oscillates as a deterministic function of the tick
(`docs/adr/0004-combate-alvo-travado-zonas-oscilantes.md:15@baea0827`). The client computes that curve
locally from a seed sent once (`docs/02-design/combate-zonas-oscilantes.md:44@793c7279`), so the HUD
can display it live at frame rate without any network traffic.

Two consequences: the zone display updates every frame, which is why glyph-atlas text is the default;
and **zone switching has a cooldown and a cost** (`docs/02-design/combate-zonas-oscilantes.md:52@793c7279`)
that the UI must show, or the player reads the delay as input lag.

### Full loot raises the bar on confirmation

Death drops everything and nothing is ever restored (`docs/adr/0003-permadeath-total.md:17@b24cc681`).
Any UI that can destroy, drop or trade an item is operating on irreversible actions, so it needs
confirmation proportionate to that — and the confirmation is a UI affordance only. The transaction
itself is the server's, through the ledger, as `enforcing-server-authority` requires.

### What is not verified

- No UI exists in this repository.
- The community UI and layout packages are unverified against 8.19.0, as stated above.
- No bitmap font has been generated for this project, so the accent-coverage failure described above
  is predicted from the character set, not observed.

## References

- `tools/pixi-reference/vendor/skills/pixijs-scene-text/SKILL.md` — the three text classes and when each fits
- `tools/pixi-reference/vendor/skills/pixijs-assets/references/fonts.md` — loading and installing fonts
- `.agents/skills/composing-pixi-scene/SKILL.md` — the world/screen split damage numbers depend on
- `.agents/skills/choosing-pixi-renderer/SKILL.md` — why an integer scale matters for a pixel font
