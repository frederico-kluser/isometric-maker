---
name: bootstrapping-pixi-app
description: Carries how this editor starts and stops its renderer - the async init that v7 did not have, why the options list looks empty when it is not, the boot values the isometric geometry fixes, and the rule that the frame loop draws while the document changes only by user command. Use whenever creating the application, wiring the frame loop, handling resize, choosing the stage scale, or tearing the editor down - including Portuguese phrasings like "iniciar o editor", "subir o editor", "criar a aplicacao", "loop de quadro", "o editor trava ao redimensionar a janela", "fechar o projeto", "limpar tudo ao fechar", "onde ponho o update", "qual zoom usar". Triggers on init, boot, ticker, deltaTime, resize, destroy, teardown, canvas, escala inteira, zoom, laco principal.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Bootstrapping the editor

## When to use

Before writing the entry point, before adding anything to the frame loop, before picking the stage
scale, and before deciding what happens when the user closes a project or the tab.

For the API — `Application`, `Ticker`, the plugins — read
`tools/pixi-reference/vendor/skills/pixijs-application/SKILL.md` and `pixijs-ticker`. This skill does
not restate them.

## Injected knowledge

### Construction is asynchronous, and this is the single most common v7 mistake

v8 split construction from initialisation: the constructor returns immediately and `init` returns a
promise. Nothing about the renderer exists until it resolves — not `stage`, not the canvas, not the
ticker. Code that constructs and immediately draws is v7 code, and it fails at runtime rather than at
compile time. Verify the shape with:

```bash
node .agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs members Application
node .agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs options ApplicationOptions
```

### The options list looks empty and is not

`ApplicationOptions` has a literally empty body. Every option is merged in from elsewhere — the
resize plugin contributes `resizeTo`, the ticker plugin contributes `autoStart` and `sharedTicker`,
and `width`, `height` and the background options arrive through a mapped type over the registered
renderer systems that no text reader resolves.

Consequence: **never conclude an option does not exist by reading the interface.** Use
`inspect-pixi.mjs options ApplicationOptions` for the reachable ones and `inspect-pixi.mjs prop
<nome>` for anything behind the mapped type. This is described in full in `routing-pixijs-work`.

### Three boot values the isometric geometry already decided

The map is a 2:1 diamond, and that makes three renderer options a boot decision rather than a later
tuning knob: `resolution: 1`, `autoDensity: false`, and a single **integer** scale factor applied on
the stage (`docs/adr/0013-geometria-isometrica-64x32-z16.md:38@e194895c`).

The reason is the seam. A 1,5× upscale lands diamond edges on half-pixels, the tiles stop meeting,
and no amount of edge extrusion repairs it — the geometry is wrong before sampling ever happens.

**The defaults are already right, and that is the whole trap.** `resolution` defaults to `1` and
`autoDensity` to `false`
(`tools/pixi-reference/vendor/skills/pixijs-application/references/application-options.md:22-23@5514896f`).
Nothing non-integer arrives from the monitor unless someone asks for it. What asks for it is the
standard HiDPI recipe, printed as the example directly under that table —
`resolution: window.devicePixelRatio, autoDensity: true`
(`tools/pixi-reference/vendor/skills/pixijs-application/references/application-options.md:27-35@5514896f`).
It is correct advice for a normal canvas app, it is exactly wrong here, and it is the first thing
somebody reaches for when the art looks blurry. So write both values down explicitly at `init`: not
because the default would betray you, but so that turning them on becomes an argument instead of an
unnoticed edit.

Then put the zoom on the stage as an integer (1×, 2×, 3×). Neither option is listed on
`ApplicationOptions`; both are real, and both reach the renderer as `ViewSystemOptions`
(`tools/pixi-reference/vendor/pixi-api.d.ts:12312-12319@e58b8ac3`), one of the shared renderer
systems whose options the mapped type merges in. Sampling and mipmaps are the other half of this and
belong to `choosing-pixi-renderer`.

### The loop draws. It does not decide.

There is no server and no authoritative tick to defer to
(`AGENTS.md:51@eb529ae5`). The rule survives anyway, with a different owner: in an editor the
document changes because the user issued a command, and for no other reason. **A frame is not an
edit.** Nothing in the saved document advances on its own — no physics, no clock, no elapsed-time
integration writing back into the project. Preview playback does run on its own fixed step, but
everything it advances is scratch state that is thrown away; that clock belongs to
`interpolating-pixi-state`, and none of it is the document.

The concrete casualty is undo. Every document mutation has to be a command the history can reverse,
so a mutation that originates in a ticker callback has no command behind it: it cannot be undone, it
cannot be attributed, and it makes the file on disk drift away from what the user believes they
authored. There is no exception to earn here, because there is nothing racing the user.

The ticker callback may: move the camera, advance a preview animation, redraw the tile cursor and the
selection overlay, update the status bar, and read the document. It may not: write to the document,
allocate an id, mark the project dirty, or change anything the undo stack would need to know about.

| Rate | Driven by | Owns |
|---|---|---|
| frame | the ticker | camera, preview animation, cursor, selection overlay |
| edit | the user's command | the document, the undo stack, ids, the file on disk |

The rates are unrelated on purpose. Frames are continuous; edits arrive in bursts and then nothing
happens for minutes.

### The ticker callback receives a Ticker, not a number

`TickerCallback` is `(this: T, ticker: Ticker) => any`
(`tools/pixi-reference/vendor/pixi-api.d.ts:18922@e58b8ac3`). v7 handed the callback a raw delta
number, and code written that way **does not throw**: adding a number to a `Ticker` coerces to a
string and then to `NaN`, so positions quietly become `NaN` and sprites vanish. There is no error to
search for. If things disappear on the first frame, check this before anything else.

`Ticker` exposes both a per-frame scalar and elapsed milliseconds; use the millisecond value for
anything time-based, because the scalar is a multiplier relative to a target frame rate and silently
changes meaning when the display is not 60 Hz.

### Driving frames yourself

The TickerPlugin registers `app.render()` as a ticker listener at `UPDATE_PRIORITY.LOW`
(`tools/pixi-reference/vendor/skills/pixijs-ticker/SKILL.md:76@e9ca8e1f`). `autoStart: false` stops
that plugin from starting the ticker, so `app.render()` stops being called each frame
(`tools/pixi-reference/vendor/skills/pixijs-application/references/application-options.md:129@5514896f`)
— **it is documented as not starting the loop, not as unregistering the listener**, so drive frames
the way the vendored skill says to: `app.ticker.update()` and then `app.render()` in your own loop
(`tools/pixi-reference/vendor/skills/pixijs-application/SKILL.md:146@052f2fd2`). That is what lets a
hand-written loop decide when a frame is worth drawing at all, which matters more for an editor than
for a game: an editor is idle most of the time,
and a document nobody is touching has nothing new to show. Rendering only when the camera, the
selection or a preview animation actually changed is the shape the API permits — **whether it is
worth the bookkeeping here has not been measured, because nothing has been drawn yet.**

`Ticker` also offers a time scale and frame-rate clamps; confirm the names with `inspect-pixi.mjs
members Ticker` rather than from memory, and read `pixijs-ticker` for priorities.

### Teardown has to be complete, because the session outlives the document

A game process ends when the game ends. An editor opens a project, closes it, and opens another one
in the same page, so everything the previous document registered is still registered unless it was
removed by hand. A leaked ticker callback is not garbage here — it is code still drawing a scene that
was destroyed, against textures that were freed.

When closing a project, tear down in this order, and treat each step as mandatory:

1. Remove every callback this document added to the ticker.
2. Destroy the scene graph, with the options that also release textures the document owned.
3. Release atlases the next document will not reuse — see `profiling-pixi-performance` for what
   `Assets` does and does not free.

`Application.destroy` takes options that decide how much goes with it; read them rather than
guessing, because the defaults do not free everything. Only tear the whole application down when the
page is going away; closing a project should reach step 3 and stop.

### Resize is a correctness problem here, not a cosmetic one

Pixel art demands rendering at logical resolution and then exactly one integer nearest upscale
(`tools/pixellab-pipeline/src/atlas.ts:15-16@a8bede59`). A resize handler that scales the renderer to
an arbitrary window size breaks that upscale and the diamond seam goes with it. Snap to integer scale
factors and letterbox the remainder; the leftover pixels are the price of the guarantee, and they are
cheap. The details are in `choosing-pixi-renderer`.

### What is not verified

There is no editor in this repository. The API shape above is checked against the vendored 8.19.0
declarations and the constraints come from accepted ADRs, but no boot sequence here has ever run and
no frame has ever been rendered (`docs/adr/0014-pixijs-para-o-editor.md:57@c4bf785c`). Treat every
performance statement as a hypothesis until the first window exists.

**The command model is anticipated, not decided.** An ADR states that undo/redo is a piece this
project writes itself (`docs/adr/0014-pixijs-para-o-editor.md:46@c4bf785c`); no ADR says mutations
are commands. "Every document mutation is a command" above is engineering consequence, not a recorded
decision — if it is ever made formally, it should be made in an ADR and cited from here.

## References

- `tools/pixi-reference/vendor/skills/pixijs-application/SKILL.md` — the full option and lifecycle surface
- `tools/pixi-reference/vendor/skills/pixijs-ticker/SKILL.md` — priorities, frame-rate clamps, shared tickers
- `docs/adr/0013-geometria-isometrica-64x32-z16.md` — the 2:1 diamond and why the stage scale is an integer
- `.agents/skills/choosing-pixi-renderer/SKILL.md` — sampling, mipmaps and the upscale this boot sets up
- `.agents/skills/interpolating-pixi-state/SKILL.md` — the preview clock the frame loop is allowed to run
