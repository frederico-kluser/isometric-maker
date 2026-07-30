---
name: building-pixi-ui
description: Carries how this editor draws text and interface - every string the user reads is Brazilian Portuguese with accents that no built-in glyph set contains, those strings live in one frozen module reached by property access, glyph-atlas text is the default for anything whose string changes, and no UI toolkit has been verified against the pinned version. Use whenever adding a rotulo, a properties panel, the cost bar or an error message, choosing a font, or diagnosing text that is blurry, missing accents or expensive - including Portuguese phrasings like "texto na tela", "rotulo do botao", "painel de propriedades", "barra de custo", "mensagem de erro", "a acentuacao sumiu", "a fonte esta borrada", "o texto esta pesado". Triggers on texto, fonte, rotulo, interface, acentuacao, BitmapText, glifo, painel, propriedades, mensagem, custo, strings centralizadas.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Building the interface

## When to use

Before adding any text, before choosing a font, and before proposing a UI toolkit.

For the API read `tools/pixi-reference/vendor/skills/pixijs-scene-text/SKILL.md`, which has one
reference document per text class. This skill does not restate them.

## Injected knowledge

### Every string the user reads is Brazilian Portuguese

This is a hard rule of the repository, not a localisation plan:

> "Todo texto que o usuário do editor lê (UI, mensagens de erro) e o texto do jogo exportado" —
> português do Brasil — `AGENTS.md:10@eb529ae5`

The rendering consequence is concrete and easy to miss until it ships: pt-BR needs
`á à â ã é ê í ó ô õ ú ç` and their capitals, and no built-in preset contains them. The vendored
types describe `BitmapFontManager.ASCII` as "all the ASCII table" and `BitmapFontManager.ALPHANUMERIC`
as the union of ALPHA and NUMERIC (`tools/pixi-reference/vendor/pixi-api.d.ts:39897-39906@e58b8ac3`),
and `chars` falls back to ALPHANUMERIC when nobody passes it
(`tools/pixi-reference/vendor/pixi-api.d.ts:39713-39715@e58b8ac3`). The vendor states the consequence
as a rule: `chars` is "Essential for non-ASCII, CJK, or restricted charsets"
(`tools/pixi-reference/vendor/skills/pixijs-scene-text/references/bitmap-text.md:95@e0e7f7e1`).

So any font this project installs spells the accented range into `chars` explicitly, and the check
for it belongs in whatever installs the font, not in review. The bug it prevents is
*content-dependent*, which is why this class of bug ships at all: it survives every test that happens
to use unaccented words, and the first casualty is a word like "Configurações" that nobody wrote a
test for.

One inference to not make. Installing is described as *pre*-generation, not as a lock — "without
install, the first `BitmapText` with a new `fontFamily` generates the atlas lazily"
(`tools/pixi-reference/vendor/skills/pixijs-scene-text/SKILL.md:71@592cce05`) — and the vendored
types show `DynamicBitmapFont.ensureCharacters`
(`tools/pixi-reference/vendor/pixi-api.d.ts:40250@e58b8ac3`) next to a `getFont` that takes the text
itself (`tools/pixi-reference/vendor/pixi-api.d.ts:39916@e58b8ac3`). Whether a generated font extends
itself for a character outside `chars` is not settled by the vendor, so plan around neither answer.
What *is* fixed by construction is a bitmap font loaded from a file: its glyphs are whatever its
atlas contains, so a pixel font that shipped without `ç` never draws one. That regression arrives
with the art, not with the text.

Identifiers, types and JSON keys stay English (`AGENTS.md:11@eb529ae5`). A label's variable name is
English; its value is Portuguese.

### The strings do not live where they are drawn

Every visible string lives in one frozen module, `src/i18n/pt-BR.ts`, reached by direct property
access and **not** through a `t('chave')` function. The reason is the compiler: both tsconfigs enable
`noUncheckedIndexedAccess`, so indexing an object by string yields `string | undefined` and invites
a `!` that erases the check, while property access makes a missing key a compile error instead of an
empty label (`docs/adr/0016-ui-ptbr-strings-centralizadas.md:39@6de9bec2`).

```ts
import { S } from './i18n/pt-BR.ts';
label.textContent = S.custoDaSessao;   // English identifier, Portuguese value
```

Error messages are inside the rule, not an exception to it — they are what the user reads at the
worst moment, and the text that most often escapes centralisation
(`docs/adr/0016-ui-ptbr-strings-centralizadas.md:53@6de9bec2`). Nothing mechanical enforces this:
there is no linter and no CI, so a literal typed straight into a component compiles and ships
(`docs/adr/0016-ui-ptbr-strings-centralizadas.md:56@6de9bec2`).

### Glyph-atlas text is the default for anything whose string changes

Canvas-rendered text re-rasterises and re-uploads whenever its string changes; glyph-atlas text only
repositions quads. Moving, rotating or scaling either one is free — the cost is on the *string*, not
on the transform, and that is the part that gets misremembered into "text is expensive, avoid it".

So: **glyph-atlas text for anything that updates, canvas text only for static strings.** Confirm the
class names and the font-installation call with `inspect-pixi.mjs grep Text` and
`inspect-pixi.mjs exists BitmapFont` before writing either.

The pixel-art constraint from `choosing-pixi-renderer` applies to fonts too: a pixel font must be
sampled nearest and drawn at an integer scale, or it blurs exactly like the tiles do. A font designed
at 8px displayed at 1.5× is unreadable in a way that reads as "the font is bad".

### What this editor's interface actually has to show

Four kinds of text, and none of them is a game HUD:

- **Rótulo** — a name on a control, a layer or a tool. Static string, so canvas text is the right
  default. The exception worth care is a label anchored to a world position: it belongs in screen
  space so it does not scale with the camera zoom, which is the world/screen split described in
  `composing-pixi-scene`.
- **Painel de propriedades** — the inspector for the current selection. Mostly static strings around
  values that change only when the user edits them.
- **Barra de custo** — the one element that is live, and the only one with money behind it. The
  budget guard informs and never refuses, so a number on screen is the last thing standing between
  the user and a surprise invoice
  (`docs/adr/0012-guard-de-orcamento-informativo.md:59@23c76213`). The report it renders carries the
  session total, the month total and the balance — and the balance is typed `number | undefined`, so
  the widget needs a state for "not known", not a zero
  (`docs/adr/0012-guard-de-orcamento-informativo.md:33-38@23c76213`); the confirmation that precedes
  each generation adds the estimate for that action
  (`docs/adr/0012-guard-de-orcamento-informativo.md:46@23c76213`). Showing the accumulated totals is
  the whole point — an estimate of US$ 0,02 displayed three hundred times is how an informative
  guard becomes a surprise.
- **Mensagem de erro** — pt-BR, from the strings module, and specific enough to say what to do next.

### No UI toolkit has been verified

The community UI and layout packages are **not installed here, and their compatibility with the
pinned 8.19.0 was not established by research** — it is one of the explicit gaps. Nothing in this
repository has verified them.

That leaves two honest options, and picking between them is a decision to record, not an
implementation detail:

1. **Hand-rolled containers plus text.** No dependency, no compatibility risk, and full control of
   the pixel grid — which anything drawn over the map needs anyway. Costs more code.
2. **Adopt a toolkit**, after verifying its version against the pin and recording the result.

Option 1 is the lower-risk default, and the burden of proof is on adopting a dependency rather than
on avoiding one.

### What is not verified

- No UI exists in this repository.
- **Whether the panels are DOM or drawn on the canvas has not been decided.** The ADR's own example
  assigns to `textContent`, which is a DOM property
  (`docs/adr/0016-ui-ptbr-strings-centralizadas.md:9@6de9bec2`). Everything above about glyph
  atlases and nearest sampling applies to text Pixi draws; DOM chrome with a web font has neither
  that problem nor that budget. The strings rule applies to both.
- The community UI and layout packages are unverified against 8.19.0, as stated above.
- No bitmap font has been generated for this project. That the presets exclude the accented range is
  documented; what an uncovered character actually draws — nothing, a blank, a fallback box — is
  neither stated in the vendor nor observed here, so do not promise a symptom.

## References

- `tools/pixi-reference/vendor/skills/pixijs-scene-text/SKILL.md` — the text classes and when each fits
- `tools/pixi-reference/vendor/skills/pixijs-assets/references/fonts.md` — loading and installing fonts
- `.agents/skills/guarding-generation-cost/SKILL.md` — where the numbers in the cost bar come from
- `.agents/skills/composing-pixi-scene/SKILL.md` — the world/screen split a world-anchored label needs
- `.agents/skills/choosing-pixi-renderer/SKILL.md` — why an integer scale matters for a pixel font
