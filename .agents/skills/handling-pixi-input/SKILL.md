---
name: handling-pixi-input
description: Carries how this game reads the player - lock-on engagement by click with zones on the number keys, the interactivity default that emits nothing until it is changed, and the rule that a click is a request to the server and never a decision. Use whenever wiring clicks, pointer or keyboard input, selecting a target, dragging, or diagnosing input that does not fire or fires on the wrong object - including Portuguese phrasings like "clicar no inimigo", "selecionar o alvo", "travar no alvo", "o clique nao funciona", "nao esta clicando", "clique atravessa", "arrastar item", "tecla nao responde", "trocar de zona". Triggers on clique, ponteiro, alvo, eventMode, hitArea, teclado, arrastar, engajamento, hit test.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Handling input

## When to use

Before wiring the first click, before designing targeting, and whenever an event does not fire.

For the event system itself read `tools/pixi-reference/vendor/skills/pixijs-events/SKILL.md`, and
`pixijs-math` for hit shapes and coordinate conversion.

## Injected knowledge

### A click is a request. It is never a decision.

This is the constraint every input handler in this project is written under:

> "Nenhuma decisão de dano, acerto, morte, loot ou transação de item pode originar no cliente."
> — `AGENTS.md:51@e451cfee`

So a click on an enemy sends *intent to engage*. It does not select a victim, roll a hit, or apply
damage. A drag onto an inventory slot sends *intent to move an item*; the item does not move until
the server's ledger says it did. The client is public, inspectable code — treat everything it
produces as hostile input to the server
(`docs/adr/0001-pixijs-em-vez-de-cocos.md:28@a1022690`).

Practical consequence for the renderer: **never mutate authoritative state in an event handler.** Show
an optimistic affordance if it helps the feel — a highlight, a cursor change — but the state that
matters arrives from the server, through `interpolating-pixi-state`.

### Nothing is interactive until you say so

`EventMode` is `"none" | "passive" | "auto" | "static" | "dynamic"`
(`tools/pixi-reference/vendor/pixi-api.d.ts:20590@e58b8ac3`), and the default is `'passive'` —
which emits no events and is not hit-tested. "My click handler never fires" is almost always this,
and it is the single most common input bug in v8.

The two that make something clickable:

- `'static'` — emits events, is hit-tested. What a button or an enemy wants.
- `'dynamic'` — also receives synthetic move events driven by the ticker, so an object under a
  stationary cursor still reacts when the *object* moves. Costs more; use it only where things move
  under a still pointer, which in this game means the world, not the HUD.

The v7 spelling still works: assigning true to the interactivity flag sets the mode to `'static'`
behind the scenes, with **no deprecation warning at all**. That is convenient and dangerous — it
means v7 input code looks correct and reviews clean.

### Hit-testing cost is a scene-shape problem

Hit-testing walks the tree. In a world with thousands of ground tiles, that walk is the input cost,
and no amount of tuning individual handlers fixes it. Two rules, both about shape rather than code:

1. **Turn off child hit-testing on containers that are never clickable** — the ground, decoration,
   effects. The flag defaults to true (`inspect-pixi.mjs member Container interactiveChildren`), so
   every static tile is walked until told otherwise.
2. **Give clickable entities an explicit hit shape** rather than letting the test use rendered bounds.
   A character's texture bounds include transparent margin, and with the feet anchor at
   `{ x: 0.5, y: 0.875 }` (`tools/pixellab-pipeline/src/atlas.ts:216@e9504d6c`) that margin sits
   mostly above the head — so bounds-based hits are generous in exactly the wrong direction.

If the ground must be clickable — move-to-click — put one hit shape on the world container and
convert the click to tile coordinates yourself. Do not make tiles individually interactive.

### Targeting is lock-on, and the zone is a keypress

Engagement is lock-on by click; the zone aimed at is chosen with keys `1`–`4`, and the per-zone hit
chance oscillates as a deterministic function of the tick and the engagement state
(`docs/adr/0004-combate-alvo-travado-zonas-oscilantes.md:15@baea0827`). Three things follow for input
code specifically:

- **The server sends the seed and parameters once; the client computes the curve locally**
  (`docs/02-design/combate-zonas-oscilantes.md:44@793c7279`). So the UI can show a live oscillation
  without asking the server anything — that is the design's point, and it is what makes it cheap
  during a fight and graceful when the network degrades.
- **The roll uses the value at the commit tick, which is the keypress plus N ticks**
  (`docs/02-design/combate-zonas-oscilantes.md:52@793c7279`). Input must therefore timestamp against
  the tick, not against wall-clock or frame time, or the display and the resolution disagree.
- **Zone switching has a cooldown and a cost** (`:52`). The UI has to show that, or the player will
  read the delay as input lag.

The commit window in ticks is **not yet decided** (`docs/02-design/combate-zonas-oscilantes.md:121@793c7279`).
Do not hard-code one; read it from configuration and say so where it is used.

### Keyboard is not Pixi's

PixiJS handles pointer, mouse, touch and wheel. Keyboard is the DOM's, which means keyboard handling
lives outside the scene graph and has to be torn down explicitly — see the teardown order in
`bootstrapping-pixi-app`, because a listener surviving a session in a permadeath game is a client
still acting after the character is gone.

### What is not verified

- No input code exists in this repository.
- The concrete oscillation parameters and the commit window are open questions in the design, marked
  as such (`docs/02-design/combate-zonas-oscilantes.md:121@793c7279`).
- Whether bounds-based hit-testing is fast enough at this game's entity counts has not been measured.

## References

- `tools/pixi-reference/vendor/skills/pixijs-events/SKILL.md` — event modes, propagation, hit areas, cursors
- `tools/pixi-reference/vendor/skills/pixijs-math/SKILL.md` — hit shapes and coordinate conversion
- `.agents/skills/enforcing-server-authority/SKILL.md` — why a click can never decide anything
- `docs/02-design/combate-zonas-oscilantes.md` — the engagement design and its open parameters
