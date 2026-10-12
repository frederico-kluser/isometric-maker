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
`node:assert/strict` (`tools/pixellab-pipeline/src/atlas.test.ts:13@10c1307a`).

`tools/character-builder` has a test script (`tools/character-builder/package.json:10@47c81737`).
It runs `npm test` over `server/*.test.ts` and `src/**/*.test.ts` — 274 tests, 13 files in `server/`
(api, frame-fit, frames, mannequin, mannequin-io, mannequin-prompt, model, png, rotate, rotate-lab,
sprite-bundle, sprite-lab, world-block) plus `src/` (import, strings, and screen suites for wizard,
laboratório, poses and itens). The Sprite Studio modules are covered — `sprite-lab.test.ts` (24
tests) and `sprite-bundle.test.ts` (17) run against fakes, never the network
(`tools/character-builder/server/sprite-lab.test.ts:1@f64ccfc2`,
`tools/character-builder/server/sprite-bundle.test.ts:1@cb00a165`).

**Do not run this suite with a `vite dev` of the same tool alive.** `api.test.ts` binds a port; with
a dev server up, one run came back 271/270 and the next three came back 274/274. A count that moves
between runs is the tell — the failure is the port, not the code.

### What is covered, and what is not

76 tests pass. They cover `atlas.ts`, `catalog.ts`, `cost.ts`, `generate.ts`, and `queue.ts` —
including the idempotency contract (`catalog.test.ts`: same catalog + lockfile ⇒ skip, zero
actions, zero cost) and a falsification test (`specHash changes when prompt changes`).

The pipeline has real test coverage, including the money-critical modules:

| Module | Test file | Key cases |
| --- | --- | --- |
| `src/catalog.ts` | `catalog.test.ts` (16 tests) | idempotency, plan construction, `decide()` |
| `src/cost.ts` | `cost.test.ts` (21 tests) | guard branches, thresholds, confirmation |
| `src/generate.ts` | `generate.test.ts` (13 tests) | submit, poll, resubmit guard, ledger |
| `src/queue.ts` | `queue.test.ts` (14 tests) | state transitions, expiry, concurrency |
| `src/atlas.ts` | `atlas.test.ts` (12 tests) | packing determinism, extrusion |

Known gaps that tests do not yet cover:

- `runResume` losing `remote` and `postHash` in the lockfile entry
- POST retry on 5xx for paid endpoints (idempotency key not provided by the API)
- `WeightedSemaphore.release` interleaving with concurrent `acquire`

These are live issues, not speculative ones.

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

## registo de aprendizado (memória CoALA local)

On task completion, run the memory pipeline. The external signal for this skill is `npm test` in
`tools/pixellab-pipeline`.

Record a change here only when the *testing contract* moved: a new test file, a new runner flag that
matters, a module that gained or lost coverage, or a discovered constraint of the runner. The
coverage table above is the passage most likely to need updating — when a module gains real
coverage, **replace** its row rather than appending a note beside it, and update the paragraph that
says money-critical changes cannot produce a test signal. Leaving both the old claim and the new one
in place is how a skill starts contradicting itself.

Do not record individual test results. "The suite passed today" is a fact about a moment.
