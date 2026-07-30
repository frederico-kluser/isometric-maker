---
name: composing-pixi-scene
description: Carries how this game arranges what it draws - the world/screen split that makes a camera possible, depth sorted by feet position because the perspective is three-quarter top-down, and the culling behaviour that changed underneath camera-scrolled worlds. Use whenever building the scene graph, moving the camera, deciding what draws on top of what, grouping layers, or cutting what is off-screen - including Portuguese phrasings like "camera segue o jogador", "o personagem aparece atras da arvore", "ordem de desenho", "z-index", "montar a cena", "sumiu da tela", "esconder o que esta fora", "agrupar as camadas". Triggers on camera, mundo, profundidade, ordenacao, culling, cullArea, camada, zIndex, sortableChildren, viewport.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Composing the scene

## When to use

Before adding the first `Container`, before implementing a camera, and whenever something draws in
front of what it should be behind.

For the API — containers, transforms, bounds, render groups — read
`tools/pixi-reference/vendor/skills/pixijs-scene-core-concepts/SKILL.md`, which has seven reference
documents, and `pixijs-scene-container`.

## Injected knowledge

### Two coordinate spaces, and the camera is the transform between them

PixiJS is only a renderer: scene, tilemap, collision, camera and UI are all ours
(`docs/adr/0001-pixijs-em-vez-de-cocos.md:27@a1022690`). There is no camera object; a camera is a
`Container` whose transform is the inverse of where you want to look.

The split that keeps this manageable:

| Space | Holds | Moves with the camera |
|---|---|---|
| world | ground, entities, effects, name plates | yes — it *is* the camera transform |
| screen | HUD, inventory, targeting UI, damage numbers | no |

Damage numbers are the case that catches people: they are anchored to a world position but must not
scale with camera zoom, so they belong in screen space with their position converted each frame.
`Container` provides local/global conversion in both directions — check the exact names with
`inspect-pixi.mjs members Container` rather than recalling them.

**Keep the camera transform on integer device pixels.** A fractional camera offset reintroduces the
shimmering that `choosing-pixi-renderer` exists to prevent, and it does so for every sprite at once,
which makes it look like an art problem rather than a transform problem.

### Depth is the feet, because the perspective is three-quarter

The game is `low top-down`, chosen so equipment is readable
(`docs/adr/0005-low-top-down-8-direcoes.md:17@0f447499`). In that perspective, whoever is lower on
the screen is nearer the viewer, so **draw order is sorted by the sprite's ground position**, not by
insertion order and not by texture.

This is exactly why the atlas anchors sprites at the feet, `{ x: 0.5, y: 0.875 }`
(`tools/pixellab-pipeline/src/atlas.ts:216@e9504d6c`): the sprite's `y` already *is* its depth. A
centre anchor would make depth depend on how tall each sprite happens to be.

`Container` supports per-child ordering and an opt-in automatic sort; the cost is a sort of the
child list every time it is marked dirty, which for a busy world container is every frame. Two ways
to keep that cheap, in order of preference:

1. **Sort only the entity container**, never the whole world. Ground and static decoration have fixed
   relative order and do not belong in the sorted set.
2. **Give the sorted set a stable key** — the ground `y`, rounded — so that equal values do not
   reshuffle between frames and make sprites flicker past each other.

### Layers exist, and are labelled experimental

`RenderLayer` lets draw order be decided independently of parent/child structure, which is the
natural fit for "this effect belongs to the entity but must draw above everything". The vendored
declaration says of it:

> "This is a new API and therefore considered experimental at this stage."
> — `tools/pixi-reference/vendor/pixi-api.d.ts:16554@e58b8ac3`

Use it if it is the right tool, but record that it is experimental where the decision is made, and do
not build something load-bearing on it without a fallback that uses ordinary ordering.

### Culling changed underneath camera-scrolled worlds

`Container.cullArea` is interpreted in the container's **local** coordinate space and projected to
global before the test. This changed in 8.16.0, and the pre-change idiom — pre-transforming the rect
into world coordinates yourself — now double-applies the transform.

That lands squarely on this game: the world container's transform is non-identity by construction,
because it *is* the camera. A cull rect computed the old way gets offset and scaled twice, and the
symptom is content disappearing near the screen edges as the camera moves, which reads like a bounds
bug rather than a coordinate-space one.

Culling is opt-in per container and there is a plugin that runs the cull each frame; get the exact
names from `inspect-pixi.mjs prop cullable` and `inspect-pixi.mjs exists CullerPlugin`. Turn culling
**off** for containers whose children are all on screen anyway — the test is not free, and running it
over the HUD is pure cost.

### Caching a container is a method call, not an assignment

v7's cache flag was a property you assigned. v8 replaced it with a method taking a boolean or an
options object (`inspect-pixi.mjs member Container cacheAsTexture`). Assigning to it the v7 way is a
type error, which is one of the few v7 habits that fails loudly instead of silently.

It is the right tool for a static composed layer — a lit ground chunk that does not change — and the
wrong tool for anything that moves, because every change re-renders the cache to a texture.

Render groups are the other half of that trade-off: they move a subtree onto the GPU as a unit so its
own transform is cheap to change, which suits a large static world that pans. Both are described
properly in `pixijs-scene-core-concepts`; the project rule is simply **measure before applying
either**, because both trade memory for CPU and this project has no measurements yet.

### `name` is gone

`Container.name` is deprecated since 8.0.0 in favour of `label`. It still exists, so v7 code compiles
— see `routing-pixijs-work` for why that is the general hazard here, not the exception.

### What is not verified

No scene has ever been built in this repository. The API facts are checked against the vendored
8.19.0 declarations; the depth and camera rules are derived from accepted ADRs; the *interaction*
between them at MMO scale has not been measured.

## References

- `tools/pixi-reference/vendor/skills/pixijs-scene-core-concepts/SKILL.md` — scene graph, transforms, layers, masking
- `tools/pixi-reference/vendor/skills/pixijs-scene-container/SKILL.md` — the Container API in full
- `tools/pixi-reference/vendor/skills/pixijs-performance/SKILL.md` — culling and caching, measured
- `docs/adr/0005-low-top-down-8-direcoes.md` — why the perspective forces feet-based depth
