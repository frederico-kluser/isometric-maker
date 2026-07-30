# Validation Report

Phase 5 artifact. Everything below was executed, not described. Command output is quoted as it came.

---

## 1. Routing evals

Nine suites in `.agents/skills/evals/`, 58 routing cases total. The check is deterministic:
vocabulary overlap between a realistic Portuguese query and the skill's `description`, which is the
only signal a selector sees at dispatch time. A must-trigger case that does not overlap means the
description lacks the words a real request would use; a must-NOT-trigger case that does overlap means
the description is broad enough to steal a sibling's traffic.

```text
PASS enforcing-server-authority
  · verification_signal é manual e não pode ser checado por script
PASS guarding-generation-cost
PASS meta-skill-consolidate
PASS meta-skill-evolution
PASS project-router
  · nenhum verification_signal declarado
PASS querying-pixellab-api
PASS testing-repo-code
PASS writing-project-docs
PASS writing-repo-typescript

9 skill(s) · 0 com falha
```

The two warnings are correct and deliberate: `enforcing-server-authority` has no code to test against,
and a router is validated by its routing cases rather than by content.

**`project-router` uses `min_overlap: 1`, the others use 2.** A domain skill needs two matches so it
does not steal traffic from a sibling; the router is the universal entry point and needs one so it
never misses. That asymmetry is recorded in the eval file itself.

### What the routing evals caught on their first run

Three real description defects, all fixed:

| Skill | Query | Problem |
|---|---|---|
| `project-router` | "implementa o sistema de loot" | threshold of 2 was wrong for a catch-all router |
| `writing-project-docs` | "escrever a doc de economia" | `doc` is three characters and falls under the minimum word length |
| `writing-repo-typescript` | "por que o tsc reclama desse enum" | the description never said `enum`, which is exactly the word a user hits |

They also exposed a property of the checker worth writing down: **an invariant string must fit on one
line**. Three invariants failed not because the knowledge was missing but because the substring
crossed a line wrap in the body.

---

## 2. Evolution — the ACCEPTED case

A real fact, put through all five steps.

**The fact.** `pixellab verify` compares file existence and byte size only; the `sha256` recorded at
generation is never re-read. A green `verify` therefore means the artifacts are present and the right
length, not that they are the right images.

**Step 1 — importance.** Non-obvious (the command is named `verify`), not inferable without reading
the source, non-volatile, and it changes how a future agent should report a green `verify`. Passes.

**Step 2 — external verification by entailment.** Read `tools/pixellab-pipeline/src/cli.ts:168-186`.
The loop calls `exists(p)` and compares `size !== a.bytes`. It never opens the file and never touches
`a.sha256`. The source entails the claim — this was not accepted on confidence.

**Step 3 — conflict.** Nothing in `guarding-generation-cost` previously described `verify`. No
passage replaced.

**Step 4 — gating.** Token minted by an actual eval run, then the hook consulted:

```text
$ node .agents/skills/scripts/run-skill-evals.mjs --skill guarding-generation-cost --write-token
1 skill(s) · 0 com falha
token gravado em .agents/skills/.validation/guarding-generation-cost.json (TTL 30 min)

$ echo '{"tool_name":"Edit","tool_input":{"file_path":".../guarding-generation-cost/SKILL.md"}}' \
    | node .claude/hooks/guard-skill-write.mjs
exit=0 (autorizado)
```

Edit applied as trap #6, with its scope and provenance. Post-edit gate:

```text
$ node .agents/skills/scripts/run-skill-evals.mjs --skill guarding-generation-cost
1 skill(s) · 0 com falha
$ cd tools/pixellab-pipeline && npm test && node src/cli.ts plan
ℹ pass 6 · fail 0
Nada foi gerado. `plan` nunca gasta.
```

**Step 5 — commit.** Included in the phase-5 commit.

---

## 3. Evolution — the BLOCKED case

An invented fact appended to `querying-pixellab-api`:

> Use `/create-character-with-16-directions` when eight is not enough.

It is plausible — the API really does have 4- and 8-direction endpoints — and it is exactly the shape
of memory that would be retrieved and followed on every later task about directions.

```text
$ node .agents/skills/scripts/run-skill-evals.mjs --skill querying-pixellab-api --write-token
  · verification_signal falhou: `node .agents/skills/scripts/check-spec-claims.mjs`
      1 afirmação(ões) sem respaldo no spec:
        · endpoint `/create-character-with-16-directions` não existe no spec vendorizado

1 skill(s) · 1 com falha
token NÃO autoriza escrita — evals vermelhos
```

Discarded. Re-running after the revert returns green.

**This case found a hole in the system and closed it.** On the first attempt the runner minted a
`"ok": true` token *while `check-spec-claims` was failing*, because it only ran routing, invariants
and provenance — it never executed the skill's own declared `verification_signal`. A token asserting
"verified" about something nothing had verified is precisely the clean-but-wrong failure this
architecture exists to prevent.

`run-skill-evals.mjs` now runs the declared signal and folds its exit code in, with two guards: an
`SKILL_EVAL_NESTED` flag, because the meta-skills declare this very script as their signal and would
otherwise recurse forever; and detection of non-executable signals, so `enforcing-server-authority`'s
"explicit user confirmation" is reported as manual instead of silently counted as passed. The token
carries `manual_signal: true` in that case and the write hook says so.

Proof the signal really executes (a deliberately broken one):

```text
verification_signal: cd tools/pixellab-pipeline && npm run typecheck && false
  · verification_signal falhou
      > tsc -p tsconfig.json --noEmit
1 skill(s) · 1 com falha
```

---

## 4. Regression — the DISCARDED case

A change that looks like harmless consolidation. `inputHash` hashes **decoded pixels**, not file
bytes — the distinction is the reason re-encoding a PNG does not re-bill. Shortening the sentence to
"hashes the image content" reads fine and destroys the fact.

```text
$ sed -i 's/hashes \*\*decoded pixels\*\*, not file bytes:/hashes the image content:/' …
$ node .agents/skills/scripts/run-skill-evals.mjs --skill guarding-generation-cost
FAIL guarding-generation-cost
  · invariante perdida: "decoded pixels" — hashing bytes instead of pixels would re-bill on any
    re-encode; this is the load-bearing hash decision

$ # promote-or-discard: reverted
PASS guarding-generation-cost
```

This is the regression gate doing the job it exists for: catching an edit that improves prose and
deletes the reason.

---

## 5. Hook enforcement

Hooks are captured at session start, so `settings.json` written during a session does not arm it.
`test-hooks.mjs` fires the real payload shape at each hook and asserts the exit code, which tests the
logic directly rather than testing whether the host reloaded. **19 cases, 0 failures.**

| Hook | Proven behaviours |
|---|---|
| write gate | blocks editing an existing SKILL.md with no token · allows creating a new one (a draft is reviewable in git) · ignores non-skill files · allows once a fresh green token exists · blocks again when the token ages past 30 min · allows a repair on a fresh RED token, saying so on stderr |
| security | blocks reading `.env`, `secrets/**` · allows `.env.example` · blocks `rm -rf`, `git reset --hard`, `cat .env`, `curl \| sh` · allows `npm test` and `--force-with-lease` |
| stop gate | blocks termination while a phase is open · releases on `stop_hook_active` (no infinite loop) · releases with a report after 3 forced continuations (stuck-gate valve) · allows termination once every gate is green |

### A deadlock the harness found

The write gate originally required a **green** token to modify a SKILL.md. But a failing skill cannot
produce a green token, so a broken skill was **unrepairable**. Forbidding repair is strictly worse
than allowing it, so a fresh RED token now permits the write as an explicit repair.

The residual loophole is real and is documented in the hook rather than hidden: someone could weaken
a skill's eval file — which is not itself gated — to mint a red token and then edit freely. What
closes it is not the hook but git, where a weakened eval file is visible in the diff, plus the fact
that the post-edit gate still has to go green before anything is promoted.

---

## 6. Router lifecycle

```text
$ cat > TASK_PLAN.md <<'EOF'  … (plano em português) … EOF
$ git status --porcelain TASK_PLAN.md      → (vazio)
$ git check-ignore -v TASK_PLAN.md         → .gitignore:20:TASK_PLAN.md
$ rm TASK_PLAN.md                          → apagado
$ ls .agents/skills/*.md .agents/skills/.bootstrap-state.json
    .bootstrap-state.json · catalog.md · project-analysis.md · skill-map.md
```

The disposable plan is gitignored, created and deleted; the bootstrap artifacts survive. The router
carries **8 clarifying questions, all in Brazilian Portuguese**, two of which are mandatory for
anything touching the pipeline: whether the task may spend, and what the acceptance command is.

---

## 7. Provenance staleness, observed live

Adding the `## Skills` section to `AGENTS.md` changed its blob hash and the linter immediately
flagged every citation pointing at it:

```text
· proveniência stale: AGENTS.md changed since citation (4a84b2d0 -> b5b22e84)
```

Handled by the consolidation procedure — the cited lines were re-read before any hash was touched,
which surfaced three defects that had been there since Phase 1:

1. **Two off-by-one citations.** The `inputHash` rule was cited at line 41; it is at 42. The honesty
   rule was cited at 76; it is at 75.
2. **Range citations were invisible to the checker.** `AGENTS.md:55-74@hash` matched nothing at all,
   so eight citations were silently unverified — worse than an obviously broken citation, because
   they looked checked. The regex now accepts a range and validates the start line.
3. Confirming the honest limit: **the checker verifies that a cited line exists and that the file has
   not changed. It does not verify that the line says what the skill claims.** That is Step 2 of the
   memory pipeline and it requires reading. Nothing automates it.

---

## 8. Gaps and honest limits

- **Hooks do not protect this session.** They arm on the next one. Everything above was proven by
  direct invocation, which is a stronger test of the logic but not a test of the host wiring.
- **`enforcing-server-authority` cannot be automatically validated.** No server code exists. Its
  `verification_signal` is a human, the runner reports that as a warning, and the token records
  `manual_signal: true`. This is stated rather than papered over.
- **Entailment is not automated.** See §7.3.
- **The eval-file loophole.** See §5.
- **Routing evals approximate the selector.** Vocabulary overlap is not what a model does at dispatch
  time. It catches the failures that matter — missing trigger words, over-broad descriptions — but a
  green routing suite is not proof the right skill will be chosen.
- **No CI.** Every gate is local, so the signal exists only when someone runs it. Wiring
  `lint-skills`, `run-skill-evals` and `check-docs.sh` to CI is the highest-value next step for this
  system, and is deliberately not done here: `AGENTS.md` forbids documenting infrastructure that does
  not exist, and the same rule applies to building it as a side effect.
- **Nothing was fixed in the repo itself.** Phase 1 recorded 14 defects in the pipeline and docs,
  several of which lose money. They are reported in `project-analysis.md` and encoded as traps in
  `guarding-generation-cost`; fixing them is separate, reviewable work.

---

## 9. Success criteria

| # | Criterion | Status |
|---|---|---|
| 1 | lean skills, valid frontmatter, gerund names, third-person descriptions | met — 9/9 lint clean, median ~1,270 tokens, max 152 lines |
| 2 | exactly one router | met |
| 3 | every task skill ends in `<evolution>`, updates its own SKILL.md, no learnings files | met — gate 4 asserts it |
| 4 | evolution + consolidation meta-skills with safeguards as checks | met — §2, §3, §4, §5 |
| 5 | the seven design rules a–g | met — provenance, scope conditions, no dates in bodies, external verification, gating, conflict handling |
| 6 | knowledge is a reviewable draft, no unexplained imperatives | met |
| 7 | portable structure, documented symlinks, name+description+metadata only | met — lint rejects any other frontmatter key |
| 8 | an artifact per phase, committed | met — five commits |
| 9 | router asks many pt-BR questions, creates and deletes `TASK_PLAN.md` | met — §6 |
| 10 | first action was repository-doc discovery | met — Phase 1 |
| 11 | deterministic enforcement where possible | met — linter, three hooks, spec-claims checker, gate runner, hook harness |
| 12 | five phases complete; a clean-but-wrong update demonstrably blocked | met — §3 |
