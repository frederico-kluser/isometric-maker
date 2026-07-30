---
name: project-router
description: Routes every implementation task in this codebase to the right skills before any work starts, asking the developer several clarifying questions in Brazilian Portuguese first and writing a disposable TASK_PLAN.md. Use whenever the user asks for any change, fix, feature, refactor, analysis, investigation or documentation in this repo, even when they do not mention skills at all - including Portuguese phrasings like "implementa", "corrige", "adiciona", "refatora", "analisa", "cria", "muda", "gera", "documenta", "investiga", "faz". This is the single entry point; nothing else should be planned or edited before it runs.
metadata:
  type: router
---

# Project Router

**Every question this skill asks the developer is written in Brazilian Portuguese.** So is
`TASK_PLAN.md`. That is a functional requirement — the person answering works in Portuguese — not a
style preference. The reasoning and the skill bodies stay in English.

## When to use

First, always, for any request that will touch this repository.

## Procedure

### 1. Ask a lot, in Portuguese, before anything

Do not start work on an underspecified task. Ask several questions covering scope, inputs and
outputs, constraints, edge cases, acceptance criteria, and what explicitly must **not** change. Keep
asking until the ambiguity is gone.

Question bank — pick what fits and add task-specific ones:

- "Qual é exatamente o resultado esperado quando isso estiver pronto?"
- "O que **não** pode mudar? Que arquivos ou comportamentos estão fora do escopo?"
- "Isso pode gastar dinheiro na API do PixelLab? Se sim, qual o teto aceitável?"
- "Como eu confirmo que funcionou — que comando devo rodar e o que ele tem que imprimir?"
- "Existe algum caso de borda que você já sabe que costuma quebrar aqui?"
- "Prefere que eu implemente direto ou que eu apresente o plano antes?"
- "Isso é decisão de arquitetura? Se for, gera um ADR novo?"
- "Tem alguma coisa que você já tentou e não funcionou?"

Two questions are mandatory for anything touching `tools/pixellab-pipeline` or the studio: whether
the task may spend, and what the acceptance command is.

### 2. Write the plan, in Portuguese

Create `TASK_PLAN.md` at the repo root with the agreed scope, the steps, the acceptance criteria, and
the explicit non-goals. It is gitignored and disposable. It exists so the plan is a document both
sides can point at, not a memory.

### 3. Classify

Domains touched · type (bug / feature / refactor / analysis / docs) · complexity · whether any step
is irreversible or spends money.

### 4. Select skills

Read `.agents/skills/catalog.md` and pick. On ambiguity prefer the most domain-specific skill.

For PixelLab work the pattern is **hub plus family**: `querying-pixellab-api` carries the rules that
hold everywhere — the spec is the only source, the size schemas are per-endpoint, the status code
does not tell you whether a call is asynchronous — and one domain skill carries the family's own
traps. Loading the family without the hub is how a per-endpoint limit gets quoted as a global one.

The usual mappings:

| The task involves | Load |
|---|---|
| anything about the PixelLab API surface | `querying-pixellab-api` — the **hub**, then the family below |
| creating a character, its lifecycle, ZIP, tags, states | `generating-pixellab-characters` |
| turning a sprite to face another way, frame ordering | `rotating-pixellab-sprites` |
| animation, frame counts, animation modes, skeletons | `animating-pixellab-sprites` |
| props, map objects, the review/select-frames flow | `composing-pixellab-objects` |
| terrain, Wang tilesets, isometric tiles, tiles-pro | `generating-pixellab-tilesets` |
| text-to-image, model choice, prompt enhancement | `creating-pixellab-images` |
| inpaint, edit, resize, remove background, to-pixelart | `editing-pixellab-images` |
| portraits, visemes, lip-sync, talking heads | `generating-pixellab-portraits` |
| UI panels, HUD elements, pixel fonts | `designing-pixellab-interfaces` |
| polling, retries, error codes, balance, job lifecycle | `orchestrating-pixellab-jobs` |
| generating assets, the pipeline CLI, catalog or cost code | `guarding-generation-cost` |
| writing or editing any `.ts` under `tools/` | `writing-repo-typescript` |
| needing a pass/fail signal, or touching money-critical modules | `testing-repo-code` |
| anything under `docs/`, the README, or a decision record | `writing-project-docs` |
| **anything drawn on screen** — renderer, scene, camera, sprite, atlas, tilemap, editor chrome, input, frame rate | `routing-pixijs-work`, a **sub-router**; hand off, do not enumerate |
| no existing skill fits | `meta-skill-evolution`, to propose one as a draft |

`routing-pixijs-work` owns ten skills of its own plus the 26 official PixiJS skills vendored in
`tools/pixi-reference/vendor/skills/`. Delegate the renderer half of a task to it rather than picking
from that set here — it exists so this table does not have to grow by thirty-six rows.

**There is no server, and no skill claims otherwise.** This repository is a local single-user
isometric editor (`docs/adr/0010-pivo-para-editor-isometrico.md`); `enforcing-server-authority` was
retired with the pivot and has no successor. A task about combat, loot, netcode or anti-cheat is out
of scope — say so and ask, rather than routing it somewhere.

### 5. Assemble the chain

Decide the order and what can run in parallel. Read-mostly skills can be loaded by isolated-context
subagents concurrently. Never parallelise two chains that could both submit generation jobs — the
ledger is appended at submit and concurrent runs would race it.

### 6. Load before implementing

Read the selected skills' knowledge **before** writing code, not while debugging.

### 7. Execute against the plan

Follow `TASK_PLAN.md`. If the plan turns out to be wrong, say so and revise it with the user rather
than silently drifting.

### 8. On completion

1. Run each involved **task** skill's `<evolution>` section. Usually this writes nothing, and that is
   the healthy outcome.
2. Report what was actually verified, with the command output. If a test failed, say so.
3. **Delete `TASK_PLAN.md`.**

## Rules

- **Never leave `TASK_PLAN.md` behind.** It is disposable by design.
- **Never delete the bootstrap artifacts**: `project-analysis.md`, `skill-map.md`, `catalog.md`,
  `validation-report.md`, `.bootstrap-state.json`. Those are the audit trail.
- Skills with broad side effects are not auto-invocable. `generate` spends real money and
  `meta-skill-consolidate` deletes knowledge; both need explicit confirmation with the numbers in
  hand.
- If no skill covers the task, do not improvise a permanent rule. Invoke `meta-skill-evolution` to
  propose a new skill as a **draft for review**.
- Never skip the evolution step. Skipping it is how the system stops learning; running it and writing
  nothing is normal.

## References

- `.agents/skills/catalog.md` — the index this router reads
- `.agents/skills/skill-map.md` — why the catalog is shaped this way
