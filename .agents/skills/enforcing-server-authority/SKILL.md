---
name: enforcing-server-authority
description: Carries the non-negotiable rules for game code in a permadeath, full-loot MMO with no GMs - the client decides nothing, infrastructure failure never kills, items move only through sanctioned transactions, and nothing is ever restored. Use whenever writing or designing client, server, netcode, combat, damage, hit resolution, death, loot, inventory, trade, economy or anti-cheat code - including Portuguese phrasings like "calcular o dano", "resolver o acerto", "matar o personagem", "transferir o item", "sistema de loot", "predicao no cliente", "protocolo de rede", "anti-cheat". Use it before designing any protocol message. Triggers on tick, autoritativo, permadeath, full loot, ledger, dupe, PvP, zonas oscilantes, PixiJS.
metadata:
  type: knowledge
  verification_signal: explicit user confirmation (no server code exists yet, so no test can validate this skill)
---

# Enforcing server authority

## When to use

Before writing the first line of any client, server or shared-protocol code, and before designing any
message that crosses the network.

> **This skill's verification signal is the weakest in the system, on purpose.** There is no game
> code and therefore no test to run. Everything below is distilled from accepted ADRs, not inferred
> — but any *change* to this skill needs a human to confirm it, because nothing else can.

## Injected knowledge

### Why the rules are harder here than in a normal game

Permadeath is total and nothing is ever restored, so a failure of authority is not a balance bug — it
is the irreversible destruction of someone's progress with no appeal:

> "Nenhuma decisão de dano, acerto, morte, loot ou transação de item pode originar no cliente."
> — `AGENTS.md:51@b5b22e84`

> "**nenhuma restauração, nunca.** Nem por bug do servidor, nem por queda de rede, nem por decisão de
> suporte." — `docs/adr/0003-permadeath-total.md:17@b24cc681`

The client is public, inspectable code (`docs/adr/0001-pixijs-em-vez-de-cocos.md:28@a1022690`). Treat
everything arriving from it as hostile.

### The five non-negotiables

1. **The client decides nothing** that has consequences: not the hit, not the damage, not the death,
   not the loot, not the item move. It may predict its own movement and it may draw.
2. **Infrastructure failure fails in the player's favour.** "a morte só é real quando a transação
   commita" — a database error must not kill anyone
   (`docs/adr/0003-permadeath-total.md:22@b24cc681`).
3. **Items move only through sanctioned transactions**, through an idempotent ledger. An ad-hoc
   `UPDATE` on an item row must be structurally impossible, not merely discouraged.
4. **One living character per account.** Without it a mule alt holds the gear and death stops costing
   anything (`docs/adr/0003-permadeath-total.md:24@b24cc681`).
5. **Death is audited.** Deterministic replay retained 30 days, so a dispute is settled by evidence
   rather than trust (`:23`).

### Combat: deterministic by design, and what that forces

Engagement is lock-on by click. The per-zone hit chance oscillates as a **deterministic function of
the tick** and the engagement state; the zone aimed at is chosen with keys `1`–`4`. Angle
multipliers stack on top: front `1.0×`, flank `1.5×`, back `2.5×`
(`docs/adr/0004-combate-alvo-travado-zonas-oscilantes.md:15@baea0827`).

The server sends the seed and parameters **once**; the client computes the curve locally. That is why
the design was chosen: it is immune to aimbot, costs almost no bandwidth during a fight, and degrades
gracefully when the network does (`docs/02-design/combate-zonas-oscilantes.md:44@793c7279`).

The cost of that determinism is that a bot can predict the peak. Four mitigation layers, in order
(`docs/02-design/combate-zonas-oscilantes.md:52@793c7279`):

1. **delayed commit** — the roll uses the value at the commit tick, which is the keypress plus N ticks
2. **zone-switch cooldown and cost**
3. **commit-reveal** — hash sent when the engagement opens, revealed at resolution, auditable after
4. **statistical detection**

Detection runs in **log-only mode for the first four to six weeks**, and the response is never an
instant ban — only a silent demotion into a suspect queue (`:68`). Residual bot advantage is accepted
at roughly 1–2% and instrumented by a CI regression test that pits a sniper bot against a synthetic
human with log-normal reaction time (mean ~250 ms, σ ~150 ms) (`:72`).

### Two combat problems are open and must not be papered over

Group combat: N attackers means N independent oscillations, so the chance of a head-death scales
linearly and gets absurd. Ranged weapons: a 2.5× backstab multiplier at 20 tiles is not obviously
sane. Both are recorded as blocking questions before any PvP test
(`docs/02-design/combate-zonas-oscilantes.md:104@793c7279`). Do not invent a resolution — flag it.

Also unresolved, and explicitly marked so: the concrete mean, amplitude and frequency per zone, the
commit window in ticks, and the diminishing-returns term for group fights (`:121`).

### Equipment is the class, and the API does not help

Build is equipment, so another player must be able to *read* what you are wearing — that is a
gameplay requirement, which is what forced the `low top-down` perspective
(`docs/adr/0005-low-top-down-8-direcoes.md:13@0f447499`).

> "**A API do PixelLab não resolve isso.**" — there is no cross-character equipment primitive
> (`docs/03-arquitetura/paper-doll-e-equipamento.md:5@a2c44714`)

A wardrobe piece is only valid within the **same silhouette**; the tooling refuses a cross-silhouette
application before spending (`:55`). The recommended order is few silhouettes first, full baked
variants second, runtime layers only for the one slot that genuinely needs reordering.

### Stack and shape

TypeScript on both sides, PixiJS 8 + Vite in the browser, with a shared package for protocol and
rules — so damage rules are shared *literally*, which is what makes prediction correct rather than
approximate (`docs/adr/0001-pixijs-em-vez-de-cocos.md:15@a1022690`). PixiJS is only a renderer: scene,
tilemap, collision, camera and UI are all ours.

The server is sharded by zone **from the first commit**, so the phase-1 single VM and a later GKE +
Agones deployment run the same code (`docs/adr/0007-fase1-vm-unica.md:15@385b9c10`). Static assets
come from a CDN, never from the game VM.

## References

- `docs/02-design/combate-zonas-oscilantes.md` — the full combat design and its open risks
- `docs/03-arquitetura/paper-doll-e-equipamento.md` — the three approaches real games use
- Machine-wide skill `ferro-engine` — broader netcode and anti-dupe rationale, not restated here
