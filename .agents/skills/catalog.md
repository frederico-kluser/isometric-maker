# Skill catalog

Index the router reads before selecting. One line per skill: what it owns, when it fires, and what
signal authorises changing it.

Source of truth: `.agents/skills/`. `.claude/skills` is a symlink to it, so any agent that reads
`.claude/skills` sees the same files. Frontmatter carries only `name`, `description` and `metadata`,
which keeps the skills portable to Cursor, Codex and others.

## Entry point

| Skill | Type | Fires on |
|---|---|---|
| [`project-router`](project-router/SKILL.md) | router | **every** request that touches this repo — it asks clarifying questions in pt-BR, writes `TASK_PLAN.md`, selects the chain, and deletes the plan at the end |

Nothing else should be planned or edited before the router runs.

## Knowledge — what the model does not already know

| Skill | Owns | Verification signal |
|---|---|---|
| [`querying-pixellab-api`](querying-pixellab-api/SKILL.md) | the vendored OpenAPI spec as the only source of API truth: how to query it, the two structural traps, the three direction orderings, what the spec cannot tell you | `node .agents/skills/scripts/check-spec-claims.mjs` |
| [`writing-repo-typescript`](writing-repo-typescript/SKILL.md) | Node 24 running `.ts` with no build step; why `.ts` extensions and `node:` prefixes are load-bearing; what the tsconfigs already enforce | `npm run typecheck` in both tools |
| [`enforcing-server-authority`](enforcing-server-authority/SKILL.md) | the non-negotiables for game code that does not exist yet: client decides nothing, failure favours the player, nothing is ever restored, the combat and anti-cheat design | explicit user confirmation — **the weakest signal in the library, and labelled as such** |

## Task — procedures with a pass/fail signal

| Skill | Owns | Verification signal |
|---|---|---|
| [`guarding-generation-cost`](guarding-generation-cost/SKILL.md) | the hash contract, the four guard branches, plan→estimate→generate ordering, and the traps that cost real money | `npm test && node src/cli.ts plan` in `tools/pixellab-pipeline` |
| [`testing-repo-code`](testing-repo-code/SKILL.md) | the Node test runner, what good tests look like here, and exactly which money-critical modules have **no** coverage | `npm test` in `tools/pixellab-pipeline` |
| [`writing-project-docs`](writing-project-docs/SKILL.md) | the twelve doc conventions — five checked, seven not — plus ADR authoring and the never-edit-an-accepted-ADR rule | `bash scripts/check-docs.sh` |

Every task skill ends with an `<evolution>` section. It runs at task completion and usually writes
nothing; that is the intended outcome.

## Meta — how the library changes

| Skill | Owns | Verification signal |
|---|---|---|
| [`meta-skill-evolution`](meta-skill-evolution/SKILL.md) | the five-step memory pipeline: importance → external verification → conflict detection → regression gating → git commit. Decides update / propose draft / discard | `lint-skills.mjs && run-skill-evals.mjs` |
| [`meta-skill-consolidate`](meta-skill-consolidate/SKILL.md) | periodic GC: dedupe, contradiction resolution, provenance staleness, token budget. Deletions need a second opinion and human approval | same, plus a diff for review |

## Tooling

| Command | Does |
|---|---|
| `node .agents/skills/scripts/lint-skills.mjs [name]` | frontmatter, naming, description triggers, body budget, provenance, `<evolution>` presence |
| `node .agents/skills/scripts/run-skill-evals.mjs [--skill N] [--write-token]` | routing evals, body invariants, citation resolution — and the **only** way to mint the token the write gate requires |
| `node .agents/skills/scripts/check-spec-claims.mjs` | every endpoint and enum a skill asserts exists in the vendored spec |
| `node .agents/skills/scripts/validate-bootstrap.mjs [--phase N]` | the phase gates |
| `node .agents/skills/querying-pixellab-api/scripts/inspect-spec.mjs <cmd>` | query the spec without loading it |

## Enforcement, not advice

Three hooks in `.claude/settings.json` make the rules that matter deterministic:

- **write gate** — modifying an existing `SKILL.md` is blocked without a fresh validation token.
  Creating a new one is allowed, because a new file is a reviewable draft.
- **stop gate** — the bootstrap cannot be abandoned with a phase still open.
- **security guard** — `.env` and secrets are unreadable; destructive shell patterns are blocked.

Hooks are captured at session start, so edits to `settings.json` take effect on the next session.

## Scope against the machine-wide skills

`/home/ondokai/Projects/ferro-e-cinzas-skills/` installs `pixellab-assets` and `ferro-engine` into
every agent profile. Those carry general PixelLab lore and general engine design. The skills here
carry what is true of **this repository** — this snapshot, this CLI, these tsconfigs, these ADRs —
and defer to the global pair rather than restating them.
