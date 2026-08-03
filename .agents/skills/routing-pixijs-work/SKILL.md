---
name: routing-pixijs-work
description: Routes any task touching PixiJS in this repo — the exported game's runtime (tools/runtime) and the atlas packer (tools/pixellab-pipeline/src/atlas.ts) — choosing between the 26 official PixiJS skills vendored from the package and this repo's own bridge skills, and enforcing that no PixiJS API is ever written from memory. The map editor no longer uses PixiJS; route its rendering to the Three.js family instead. Use whenever a request involves drawing, rendering, scene, camera, sprite, animation, tilemap, atlas, input or frame rate in the runtime or the packer - including Portuguese phrasings like "desenhar na tela", "renderizar o mapa", "montar a cena", "animar os sprites do jogo", "mover a camera", "carregar o atlas", "esta com lag", "quantos quadros por segundo". Use it before writing any line that imports pixi.js. Triggers on PixiJS, pixi, renderizador, cliente, canvas, WebGPU, WebGL, sprite, spritesheet, tilemap, isometrico, culling, ticker, draw call, runtime, atlas, jogo exportado.
metadata:
  type: router
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Routing PixiJS work

**Sub-router.** `project-router` runs first and asks the general questions. This one runs after it,
for the PixiJS half of a task, and asks only what is specific to PixiJS. Its questions to the
developer are in Brazilian Portuguese, like every other question this repo asks.

**The map editor is Three.js — it does not route here.** PixiJS survives in `tools/runtime`, the
exported game's runtime, and `tools/pixellab-pipeline/src/atlas.ts`, the atlas packer. Tasks about
the editor's viewport route to the Three.js family instead.

## When to use

Before writing any line that imports `pixi.js` — in `tools/runtime` or
`tools/pixellab-pipeline/src/atlas.ts`. Before answering any question about what PixiJS can or
cannot do. Before estimating whether something will hold its frame rate.

Not for the map editor: it renders with Three.js and is routed to the Three.js family
(`bootstrapping-threejs-scene`, `creating-threejs-cubes`, `controlling-threejs-camera`,
`raycasting-threejs-blocks`).

## The rule that comes before any routing

**Never write the PixiJS API from memory.** This is the same rule the repo already applies to the
PixelLab API (`AGENTS.md:22@eb529ae5`), and PixiJS earns it for a different and nastier reason.

v8 did not extend v7, it replaced parts of it — and then **kept the v7 methods as deprecated shims**.
There are 97 deprecated declarations in the vendored surface. `Graphics.beginFill` is still declared,
directly beside `@deprecated since 8.0.0`. So v7 code written from memory **typechecks clean** and
fails only in review, or never.

The source of truth is `tools/pixi-reference/vendor/`, pinned at pixi.js 8.19.0
(`tools/pixi-reference/vendor/PROVENIENCIA.txt:3@3d9e069a`). Consult it; do not recall it.

## Procedure

### 1. Ask, in Portuguese

`project-router` has already asked about scope and acceptance. Ask only what changes renderer work:

- "Isso roda no jogo exportado (`tools/runtime`) ou no empacotador de atlas (`tools/pixellab-pipeline/src/atlas.ts`)?"
- "Qual o orçamento de quadro? 60 fps travado, ou 30 é aceitável nesse caso?"
- "Quantos sprites simultâneos, na pior hipótese que você consegue imaginar?"
- "Isso desenha o mapa do jogo exportado, ou é um passo do build de sprites? Com que frequência muda?"
- "Pode depender de pacote da comunidade, ou só do `pixi.js` que já está fixado?"

The last one is not a formality: several things a renderer needs — tilemap, UI kit, extra filters —
live in **separate packages that are not installed here and whose v8 compatibility this repo has not
verified**. Adding one is a dependency decision, not an implementation detail.

### 2. Classify the surface

Which of the ten areas the task touches, and for each: is the question **what the API does** or **how
this repo does it**? That single distinction decides the routing.

### 3. Route

**API question → the vendored upstream skill.** Read it, do not copy it into ours.
**Project convention → the bridge skill here.** It carries what upstream cannot know.

Most real tasks need one of each.

| The task is about | Upstream, for the API | Here, for this repo |
|---|---|---|
| booting the app, the frame loop, teardown | `pixijs-application`, `pixijs-ticker` | `bootstrapping-pixi-app` |
| WebGPU vs WebGL, resolution, pixel-art sharpness | `pixijs-core-concepts`, `pixijs-environments` | `choosing-pixi-renderer` |
| containers, camera, draw order, culling | `pixijs-scene-core-concepts`, `pixijs-scene-container` | `composing-pixi-scene` |
| sprites, atlas, animation, wardrobe layers | `pixijs-scene-sprite`, `pixijs-assets` | `animating-pixi-sprites` |
| the ground, tiles, stacked blocks, very many quads | `pixijs-scene-particle-container` | `rendering-pixi-tilemap` |
| clicks, pointer, hit-testing | `pixijs-events`, `pixijs-math` | `handling-pixi-input` |
| labels, UI text, fonts | `pixijs-scene-text` | `building-pixi-ui` |
| filters, masks, blend modes | `pixijs-filters`, `pixijs-blend-modes` | `applying-pixi-filters` |
| smoothing motion between grid cells, the jump | `pixijs-ticker` | `interpolating-pixi-state` |
| frame rate, draw calls, GPU memory, leaks | `pixijs-performance` | `profiling-pixi-performance` |
| shapes and vector drawing | `pixijs-scene-graphics` | — none; upstream is enough |
| upgrading, or diagnosing v7-looking code | `pixijs-migration-v8` | — none; upstream is enough |

Areas with no bridge skill are areas where this project has **no convention yet**. That is a fact
about the project, not an omission: inventing one to fill the table would be exactly the speculative
rule this system exists to prevent.

Upstream also ships `pixijs-accessibility`, `pixijs-color`, `pixijs-create`, `pixijs-custom-rendering`,
`pixijs-scene-mesh`, `pixijs-scene-dom-container`, `pixijs-scene-gif`, `pixijs-html-source` and
`pixijs-math`. List them all with `inspect-pixi.mjs skills`.

### 4. Load before implementing

Read the selected skills before writing code, not while debugging it. Upstream skills are read from
`tools/pixi-reference/vendor/skills/<name>/SKILL.md`, and several have a `references/` directory with
the detail — `pixijs-assets` alone has twelve.

### 5. Verify before claiming

Every PixiJS symbol that ends up written in a skill is checked. Run the signal, and run
`inspect-pixi.mjs exists` on anything you are about to assert.

## The commands

```bash
S=.agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs
node $S version                    # what is vendored, and how much of it
node $S exists Container.zIndex    # exit 0 = real and current, exit 1 = absent OR deprecated
node $S grep Sprite                # find the right name
node $S members AnimatedSprite     # everything callable, inheritance included
node $S member Ticker deltaMS      # one member, with its doc comment
node $S options ApplicationOptions # what app.init actually accepts
node $S prop roundPixels           # where an option is really declared
node $S deprecated fill            # what v8 kept as a v7 shim
node $S skills tilemap             # search the 26 upstream skills
node $S skill events               # where to read one, and its references/
```

## Three traps in the vendored surface

These are not PixiJS bugs. They are properties of the declaration file, and each one makes a naive
lookup answer "no" about something that exists.

**Declaration merging, on three levels.** `Container` is declared twice — once as a class, once as an
interface extending `PixiMixins.Container`. Forty-eight interfaces live inside `namespace PixiMixins`
blocks. And utility wrappers hide parents: `SortMixin extends Required<SortMixinConstructor>`. So
`Container.zIndex` resolves five hops away from `Container`. The bundler also renames colliding
symbols — the class everyone calls `Text` is declared `Text$1` and re-exported by alias.

**`ApplicationOptions` has an empty body.** Every option passed to `app.init()` is merged in from
somewhere else: `resizeTo` from the resize plugin, `autoStart` and `sharedTicker` from the ticker
plugin. Reading the interface and concluding "there are no options" is the trap.

**Some options are behind a mapped type and are not enumerable at all.** `width`, `height`,
`background` and friends arrive through `ExtractRendererOptions` over the registered renderer
systems, which only a type checker resolves. `inspect-pixi.mjs options` says so explicitly rather
than printing a short list as if it were complete; `prop` is the way around it.

## What is deliberately not here

This skill and its ten siblings do not restate the PixiJS API. Upstream publishes 26 skills and 38
reference documents describing it, versioned with the library and MIT-licensed, and copying them here
would fork a document that upstream keeps current and we would not
(`tools/pixi-reference/README.md:22@2718f200`). When neither the vendored skills nor the declaration
file answer a question, upstream's own fallback applies: fetch
`https://pixijs.download/release/docs/llms.txt`, the index regenerated on every release.

## Rules

- **Consult before asserting.** `inspect-pixi.mjs exists` costs one command. A wrong API claim costs a
  debugging session in a browser.
- **Deprecated counts as absent.** If `exists` exits 1 because a member is deprecated, it is v7. Find
  the v8 replacement named in the deprecation note.
- **Never edit `tools/pixi-reference/vendor/`.** It is generated, and hand edits break `--check` by
  design. To move version, change the pin, regenerate, and treat every new failure as a changelog
  entry.
- **Do not add a renderer dependency casually.** Nothing beyond `pixi.js` is installed, and this repo
  has verified nothing about the v8 compatibility of the community packages.
- **Do not invent a project convention to fill a gap in the routing table.** Propose it through
  `meta-skill-evolution` as a draft instead.

## References

- `tools/pixi-reference/README.md` — what is vendored, why, and how to regenerate it
- `.agents/skills/catalog.md` — the full skill index this router sits inside
- `.agents/skills/projecting-isometric-geometry/SKILL.md` — the coordinate space and depth key that
  every renderer decision here has to honour
