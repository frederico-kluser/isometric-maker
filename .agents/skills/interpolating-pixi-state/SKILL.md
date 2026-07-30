---
name: interpolating-pixi-state
description: Carries how server-authoritative state becomes smooth motion on screen - buffering behind the newest snapshot rather than extrapolating ahead of it, keeping the render clock separate from the tick, and never letting a visual guess become state. Use whenever drawing entities whose positions arrive over the network, smoothing movement, predicting the local player, reconciling a correction, or diagnosing stutter and rubber-banding - including Portuguese phrasings like "o personagem anda tremendo", "esta dando teleporte", "voltou para tras", "suavizar o movimento", "predicao local", "chegou pacote atrasado", "lag", "reconciliar". Triggers on interpolacao, extrapolacao, snapshot, buffer, reconciliacao, predicao, rubber-band, jitter, tick do servidor.
metadata:
  type: knowledge
  verification_signal: node .agents/skills/scripts/check-pixi-claims.mjs
---

# Turning server state into motion

## When to use

Before drawing anything whose position comes from the network, and whenever movement looks wrong —
jittery, rubber-banding, or teleporting.

**Upstream has nothing on this.** Deep research across the 26 bundled PixiJS skills found zero
coverage of snapshot interpolation, server-tick reconciliation, or decoupling render from
simulation. This skill is the project's own reasoning, and it is labelled accordingly.

## Injected knowledge

### The one thing that is not negotiable

Interpolation is a **display** technique. It changes what is drawn, never what is true:

> "Nenhuma decisão de dano, acerto, morte, loot ou transação de item pode originar no cliente."
> — `AGENTS.md:51@e451cfee`

So an interpolated position may be used to draw a sprite, to place a name plate, and to decide what
the cursor is hovering. It may **not** be used to decide whether an attack reached, whether a player
is inside a zone, or whether an item is close enough to pick up. Those are the server's, computed
from the server's positions, at the server's tick.

The cost of getting this wrong is not a visual glitch. Permadeath is total and nothing is ever
restored for any reason (`docs/adr/0003-permadeath-total.md:17@b24cc681`), so a death caused by the
client and the server disagreeing about where someone stood is unrecoverable by design.

### Two clocks, and they must not be merged

| Clock | Source | Advances | Owns |
|---|---|---|---|
| tick | server | on arrival, never locally | authoritative positions and outcomes |
| frame | the ticker | every rendered frame | what the screen shows between ticks |

Rendering directly from the newest snapshot means every entity moves in discrete jumps at tick rate,
however smooth the frame rate is. That is the stutter people try to fix with easing and cannot.

### Draw slightly in the past, do not guess the future

The pattern that works, and the reason it works:

**Keep a small buffer of recent snapshots and render at a display time that is deliberately behind
the newest one.** Rendering between two snapshots you already have is interpolation, and it is always
correct — it draws a position that genuinely happened. Rendering ahead of the newest snapshot is
extrapolation, and it is a guess that must be taken back when it is wrong.

The trade is latency against correction. A buffer of roughly one to two tick intervals is the usual
starting point: enough that one late packet does not empty it, small enough that the player does not
feel the delay. **This project has not chosen a value**, and it cannot be chosen honestly without the
tick rate, which is not yet fixed.

Extrapolate only for the local player, and only for its own movement — which is the one prediction the
authority rules explicitly allow (`.agents/skills/enforcing-server-authority/SKILL.md:39-40@1e765468`).
Extrapolating other entities produces rubber-banding, and in a full-loot game rubber-banding during a
fight is a fairness complaint, not a polish complaint.

### Corrections have to be visible-but-smooth, and never silent

When the server contradicts a predicted local position, the correction is authoritative and must be
applied. Snapping is honest but ugly; easing is pretty but hides a desync that may be worth
diagnosing. The rule this project should follow: **ease small corrections, snap large ones, and count
both.** A rising correction rate is the earliest signal that something is wrong in netcode, and it is
free to measure once the code is written to notice.

Combat state is a special case and is *not* interpolated at all. The oscillating hit chance is a
deterministic function of the tick, computed locally from a seed the server sent once
(`docs/02-design/combate-zonas-oscilantes.md:44@793c7279`). It is evaluated at the tick, not
interpolated between frames — smoothing it would make the displayed curve disagree with the one that
resolves the roll.

### Where this attaches in PixiJS

The renderer side is small, which is the point. Three hooks, all verifiable:

```bash
S=.agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs
node $S members Ticker            # the frame clock, and its rate clamps
node $S exists UPDATE_PRIORITY    # ordering: interpolate before anything reads positions
node $S exists Application.render # so frames can be driven manually
```

`Application.render` is registered as a ticker listener at low priority, so an interpolation step
registered at a higher priority runs before the frame is drawn. Disabling the automatic start lets a
hand-written loop own the ordering explicitly — the shape is in `bootstrapping-pixi-app`.

Use elapsed milliseconds, never the per-frame scalar, for anything that advances the display clock:
the scalar is relative to a target frame rate and silently changes meaning on a display that is not
60 Hz. And remember the v8 callback receives a `Ticker`, not a number — the failure is `NaN`
positions and vanished sprites, with no error.

### What is not verified

Almost all of the tuning, and this is not a formality:

- **The tick rate is not decided.** Every buffer figure above is a starting point, not a value.
- **The commit window in ticks is an open question in the combat design**
  (`docs/02-design/combate-zonas-oscilantes.md:121@793c7279`).
- No netcode exists in this repository, so nothing here has been measured — only reasoned from the
  authority rules and the combat design.
- Upstream PixiJS material offers no guidance on this axis at all, so there is no external source to
  defer to. Treat this skill as the weakest-evidence member of the PixiJS set, and revise it against
  measurements as soon as measurements exist.

## References

- `.agents/skills/enforcing-server-authority/SKILL.md` — the five non-negotiables this skill serves
- `.agents/skills/bootstrapping-pixi-app/SKILL.md` — where the frame loop is wired
- `tools/pixi-reference/vendor/skills/pixijs-ticker/SKILL.md` — priorities, clamps, manual frames
- `docs/02-design/combate-zonas-oscilantes.md` — why combat state is evaluated, not interpolated
