---
name: bootstrapping-pixi-app
description: Carries how this game starts and stops its renderer - the async init that v7 did not have, why the options list looks empty when it is not, and the rule that the frame loop draws but never decides, because the authoritative tick belongs to the server. Use whenever creating the application, wiring the frame loop, handling resize, or tearing the client down - including Portuguese phrasings like "iniciar o jogo", "subir o cliente", "criar a aplicacao", "loop de quadro", "o jogo trava ao redimensionar", "sair da partida", "limpar tudo ao desconectar", "onde ponho o update". Triggers on init, boot, ticker, deltaTime, resize, destroy, teardown, canvas, timestep, laco principal.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Bootstrapping the client

## When to use

Before writing the entry point, before adding anything to the frame loop, and before deciding what
happens when the player closes the tab.

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

### The loop draws. It does not decide.

This is not a rendering preference, it is the project's hardest constraint:

> "Nenhuma decisão de dano, acerto, morte, loot ou transação de item pode originar no cliente."
> — `AGENTS.md:51@e451cfee`

So the ticker callback may: read interpolated state, move sprites, play animations, update the HUD,
and send *intent* to the server. It may not: resolve a hit, apply damage, decide a death, move an
item, or advance any state the server also owns. The client may predict its own movement and it may
draw (`.agents/skills/enforcing-server-authority/SKILL.md:39-40@1e765468`).

Two separate rates, deliberately, and conflating them is how a client starts disagreeing with the
server:

| Rate | Driven by | Owns |
|---|---|---|
| server tick | the network | authoritative state; arrives, never advances locally |
| frame | the ticker | interpolation, animation, camera, HUD |

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

`Application.render` is registered as a ticker listener at low priority. Passing `autoStart: false`
suppresses that registration, which is what allows a hand-written loop that advances a fixed
simulation step and renders once afterwards. `Ticker` also offers a time scale and frame-rate clamps;
confirm the names with `inspect-pixi.mjs members Ticker` rather than from memory, and read
`pixijs-ticker` for priorities. How to consume state that arrives on the server tick is
`interpolating-pixi-state`.

### Teardown has to be complete, because nothing is ever restored

Permadeath is total and there is no restoration for any reason
(`docs/adr/0003-permadeath-total.md:17@b24cc681`). That raises the cost of a leaked listener or an
orphaned ticker callback from "a bit of garbage" to "a client still acting on a session that ended".

On disconnect or character death, tear down in this order, and treat each as mandatory:

1. Remove every callback this session added to the ticker.
2. Destroy the scene graph, with the options that also release textures the session owned.
3. Release atlases the next session will not reuse — see `profiling-pixi-performance` for what
   `Assets` does and does not free.
4. Only then drop the socket, so nothing in flight is handled by a half-destroyed scene.

`Application.destroy` takes options that decide how much goes with it; read them rather than
guessing, because the defaults do not free everything.

### Resize is a correctness problem here, not a cosmetic one

Pixel art demands rendering at logical resolution and then exactly one integer nearest upscale
(`tools/pixellab-pipeline/src/atlas.ts:15-16@e9504d6c`). A resize handler that scales the renderer to
an arbitrary window size breaks that upscale and the art goes soft. Snap to integer scale factors and
letterbox the remainder — the details are in `choosing-pixi-renderer`.

### What is not verified

There is no client in this repository. The API shape above is checked against the vendored 8.19.0
declarations, and the constraints come from accepted ADRs, but no boot sequence here has ever run.

## References

- `tools/pixi-reference/vendor/skills/pixijs-application/SKILL.md` — the full option and lifecycle surface
- `tools/pixi-reference/vendor/skills/pixijs-ticker/SKILL.md` — priorities, frame-rate clamps, shared tickers
- `.agents/skills/enforcing-server-authority/SKILL.md` — what the client is allowed to decide, which is nothing
