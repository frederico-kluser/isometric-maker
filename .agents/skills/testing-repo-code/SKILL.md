---
name: testing-repo-code
description: Runs and writes tests with the built-in Node test runner, and states exactly which modules currently have no coverage - which matters because a test result is the external signal that authorises persisting anything to memory here. Use whenever writing a test, running the suite, changing a money-critical module, or needing an objective pass/fail before claiming work is done - including Portuguese phrasings like "rodar os testes", "escrever um teste", "isso tem cobertura", "o teste passou", "testar essa funcao", "validar a mudanca". Triggers on node --test, test.ts, assert, cobertura, regressao, idempotencia, verification signal.
metadata:
  type: task
  verification_signal: cd tools/pixellab-pipeline && npm test
---

# Testing repo code

## When to use

Before claiming any change works. Before persisting anything to a skill. Whenever touching a module
that decides whether money is spent.

## Injected knowledge

### The runner

Node's built-in test runner, executed directly on `.ts` files — no jest, no vitest, no config:

```bash
cd tools/pixellab-pipeline
npm test                                   # node --test src/*.test.ts
node --test src/atlas.test.ts              # one file
node --test --test-name-pattern="extrusion" src/*.test.ts   # one test
```

Tests are co-located as `src/<module>.test.ts` and import from `node:test` and
`node:assert/strict` (`tools/pixellab-pipeline/src/atlas.test.ts:13@d28e4f8a`).

`tools/sprite-studio` has **no test script at all** (`tools/sprite-studio/package.json:8@ecf4958f`).
Its only automated signal is `npm run typecheck`.

### What is covered, and what is not

Six tests pass. They cover `atlas.ts`, `util.ts` and `endpoints.ts` — including a genuinely good
property, byte-identical determinism of the packed sheet
(`tools/pixellab-pipeline/src/atlas.test.ts:35@d28e4f8a`).

**Nothing covers the modules that decide whether money is spent:**

| Module | What is untested |
|---|---|
| `src/catalog.ts` | the three hashes, `decide()`, plan construction — i.e. idempotency itself |
| `src/cost.ts` | every branch of the budget guard |
| `src/generate.ts` | submit/poll/ledger, and the never-resubmit rule |
| `src/queue.ts` | state transitions, expiry deadlines, the limiter |

This matters beyond coverage hygiene. `AGENTS.md:37@e451cfee` states the idempotency guarantee as
though a test enforced it:

> "Se você mexer em `src/catalog.ts` ou na função de hash, o teste de idempotência tem que continuar
> passando — saldo idêntico antes e depois."

That test does not exist. Until it does, a change to those modules produces **no external signal**,
which under this repo's memory rules means nothing learned there can be persisted on a test result —
only on an explicit user confirmation. Say so rather than implying a green suite covered it.

### What a good test looks like here

The existing suite fixes *properties*, not outputs: determinism, ordering, and the validations that
would otherwise fail after the money is spent. Follow that. A test asserting a specific pixel colour
is brittle; a test asserting that packing the same frames twice yields identical bytes is the one
that catches a real regression.

For the untested modules, the highest-value cases are:

- same catalog + same lockfile ⇒ every item resolves to `skip`, `toGenerate` is empty, estimate zero
- changing `prompt` invalidates; reformatting the file, renaming a variable or reordering object
  keys does not
- re-encoding an input PNG leaves `inputHash` unchanged
- changing the snapshot sha leaves every item `skip` (drift must not invalidate)
- each guard branch: `allow`, `confirm`, `refuse` by asset, by run, by monthly cap
- an unpinned seed is refused before submit

None of these need the network.

### There is no CI

No `.github/`, no pipeline definition anywhere in the repo. Every gate runs locally, which means the
signal only exists if someone runs it. Do not describe CI as existing, and do not add a workflow as a
side effect of another task.

## Procedure

1. Run the suite before changing anything, so a pre-existing failure is not misread as yours.
2. Write the test first when the change is to a money-critical module — the test is the only thing
   that will authorise recording what you learn.
3. Run `npm test` and `npm run typecheck` in the tool you touched.
4. Report the actual output. If a test fails, say so with the output; a green claim without a green
   run is worse than no claim.

## References

- Sibling skill `guarding-generation-cost` — what the untested modules actually guarantee
- Sibling skill `writing-repo-typescript` — why `typecheck` is a separate signal from `test`

## <evolution>

On task completion, run the memory pipeline. The external signal for this skill is `npm test` in
`tools/pixellab-pipeline`.

Record a change here only when the *testing contract* moved: a new test file, a new runner flag that
matters, a module that gained or lost coverage, or a discovered constraint of the runner. The
coverage table above is the passage most likely to need updating — when a module gains real
coverage, **replace** its row rather than appending a note beside it, and update the paragraph that
says money-critical changes cannot produce a test signal. Leaving both the old claim and the new one
in place is how a skill starts contradicting itself.

Do not record individual test results. "The suite passed today" is a fact about a moment.
