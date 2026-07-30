---
name: meta-skill-consolidate
description: Periodic garbage collection over the skill library - deduplicates overlapping passages, resolves contradictions between skills, revalidates or retires citations whose source file changed, and enforces the per-skill token budget. Use when a skill grows past its budget, when the linter reports stale provenance, when two skills seem to disagree, or on a scheduled sweep - including Portuguese phrasings like "limpar as skills", "as skills estao inchadas", "isso esta duplicado", "a citacao mudou", "consolidar o conhecimento", "revisar a biblioteca". Deletions always require human confirmation. Triggers on consolidacao, deduplicacao, staleness, garbage collection, contradicao, budget.
metadata:
  type: meta
  verification_signal: node .agents/skills/scripts/lint-skills.mjs && node .agents/skills/scripts/run-skill-evals.mjs
---

# Meta-skill: consolidate

## When to use

On a scheduled sweep, or when the linter starts warning about size or stale provenance, or when two
skills appear to contradict each other.

## Injected knowledge

### Why subtraction is a separate skill

Adding is cheap and feels productive; removing is where the risk is. Unrestricted growth measurably
degrades a memory system — retrieval gets noisier and stale passages keep getting followed — but a
wrong deletion silently removes a rule that was preventing an expensive mistake, and nothing fails
when it goes.

So this skill is separated from `meta-skill-evolution` deliberately: deletion never sits on the hot
path of a normal task, and it never happens without a human agreeing.

### The sweep

```bash
node .agents/skills/scripts/lint-skills.mjs        # size, format, stale citations
node .agents/skills/scripts/run-skill-evals.mjs    # routing + invariants + provenance
node .agents/skills/scripts/check-spec-claims.mjs  # API assertions still hold
```

Then, in order:

**1. Deduplicate.** Find passages saying the same thing in two skills. The rule is ownership: each
fact has exactly one home skill, and the others reference it by name. Overlap between
`guarding-generation-cost` and `querying-pixellab-api` is the likeliest — cost lives with the
pipeline, API surface lives with the spec.

**2. Detect contradictions.** Two skills asserting different values for the same thing, or one skill
contradicting itself after several evolutions. Resolve by finding which is current in the code, then
**replace** the wrong passage rather than annotating it.

**3. Check staleness by provenance.** A citation is `path:line@blob8`. When the file's current blob
hash differs, the linter warns rather than fails — a changed source does not make a passage wrong, it
makes it **unverified**. Re-read the cited lines and then either update the hash, rewrite the passage,
or retire it. Never bump the hash without reading the file: that converts an honest warning into a
false assurance, which is worse than the stale citation was.

```bash
git hash-object -- tools/pixellab-pipeline/src/catalog.ts | cut -c1-8
```

**4. Enforce the budget.** Body under 500 lines, target median around 1,400 tokens. Over budget, move
material to `references/*.md` (one level deep, with a table of contents past 100 lines) rather than
deleting it — progressive disclosure first, deletion last.

**5. Retire genuinely obsolete content.** A rule about a file that no longer exists, a workaround for
a bug that was fixed, a trap in code that was rewritten.

### Rules for deletion

- **Never delete on your own judgement.** Get a second opinion from a subagent with fresh context,
  asked specifically whether removing this passage could allow a mistake the passage was preventing.
  Ask it to flag only what affects correctness — an open-ended "find problems" reviewer over-reports
  and pushes needless complexity.
- **Emit a diff and ask.** Deletion is the irreversible half of this system. Present what would be
  removed and why, and wait.
- **Gate before promoting.** Run the eval suite after the edit. If an invariant disappears, the
  deletion removed something a test was protecting — discard it.
- **One commit per consolidation**, describing what was removed and what verified the removal. Git is
  the rollback path, so the commit has to be legible enough to revert on purpose.

### What never gets consolidated away

The bootstrap artifacts — `project-analysis.md`, `skill-map.md`, `catalog.md`,
`validation-report.md`, `.bootstrap-state.json`. They are the audit trail of how the library came to
exist, and they are not skills competing for context.

Explicit hedges also survive consolidation. A passage that says something was **not verified** is
carrying real information; compressing it into a confident claim is the exact failure mode this
project's documentation rules exist to prevent.

## Procedure

1. Run the three scripts above; collect warnings.
2. Group findings: duplicate · contradiction · stale · oversized · obsolete.
3. Fix duplicates and contradictions first — they are corrections, not deletions, and need no
   approval beyond the normal gate.
4. Revalidate stale citations by reading the source.
5. For anything that would be **removed**, get the second opinion, then present the diff and wait.
6. Re-run linter and evals; commit.

## References

- Sibling `meta-skill-evolution` — the additive counterpart and the five-step pipeline
- `.agents/skills/skill-map.md` — which skill owns which knowledge area
