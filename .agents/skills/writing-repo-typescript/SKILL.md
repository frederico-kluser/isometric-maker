---
name: writing-repo-typescript
description: Explains how TypeScript actually runs in this repo - Node 24 strips types and executes .ts directly, with no build step and no workspace - and the few conventions that are load-bearing rather than cosmetic. Use whenever writing, editing or reviewing any .ts file under tools/, adding an import, adding a dependency, or wondering why the compiler rejected something - including Portuguese phrasings like "criar um arquivo ts", "adicionar um import", "por que o compilador reclama", "o tsc esta reclamando", "instalar um pacote", "rodar o typecheck", "erro de tipo". Triggers on tsconfig, typecheck, import, ESM, node:, enum, namespace, decorator, .ts extension, erasableSyntaxOnly, verbatimModuleSyntax, noUncheckedIndexedAccess.
metadata:
  type: knowledge
  verification_signal: cd tools/pixellab-pipeline && npm run typecheck && cd ../character-builder && npm run typecheck
---

# Writing TypeScript in this repo

## When to use

Before adding or editing any `.ts` file under `tools/`, and whenever the compiler rejects something
that would be legal in a normal TypeScript project.

## Injected knowledge

### There is no build step

Node 24 runs `.ts` files directly by stripping types. The `build` script says so literally:
`echo "Node 24 executa .ts direto; use typecheck"`
(`tools/pixellab-pipeline/package.json:11@4db3c05c`). `engines.node` is `>=24` in both tools. The CLI
is executed as `node src/cli.ts`, and `bin.pixellab` points straight at the `.ts` source.

Two consequences that look like style and are not:

- **Every relative import carries the `.ts` extension** — `import { PixelLabClient } from './api.ts'`.
  Without it Node cannot resolve the file, because nothing rewrites specifiers.
- **Every Node builtin uses the `node:` prefix** — `import { readFile } from 'node:fs/promises'`.

### Why those two are load-bearing

`tools/character-builder/server/api.ts:15@8fb78ce5` imports the pipeline's client **across package
boundaries by relative path**: `'../../pixellab-pipeline/src/api.ts'`. There is no dependency
declared for it in `tools/character-builder/package.json@47dd51fc` — the coupling is a filesystem path,
which is why `server.fs.allow` is widened in `tools/character-builder/vite.config.ts:12@6a436967`.

So the same file has to resolve under **two different module resolutions at once**: `NodeNext` for
the pipeline and `bundler` for Vite. Explicit `.ts` extensions and `node:` prefixes are what make
that work. Dropping either breaks one consumer and not the other, which is the worst failure shape.

It also means anything added to `tools/pixellab-pipeline/src/api.ts` or its transitive imports must
satisfy the **stricter** of the two configs: the pipeline additionally sets `noImplicitOverride` and
`noFallthroughCasesInSwitch` (`tools/pixellab-pipeline/tsconfig.json:13@e8e110a2`), which
character-builder does not.

### What the compiler already enforces — do not restate it as a rule

Run `npm run typecheck` in each tool. The flags below are on in both
(`tools/pixellab-pipeline/tsconfig.json@e8e110a2`, `tools/character-builder/tsconfig.json@0e018a20`), so
the compiler is the convention document:

| Flag | What it makes illegal |
|---|---|
| `erasableSyntaxOnly` | `enum`, `namespace`, constructor parameter properties |
| `verbatimModuleSyntax` | a type-only import without `import type` |
| `noUncheckedIndexedAccess` | treating `arr[i]` or `obj[k]` as defined |
| `exactOptionalPropertyTypes` | assigning `undefined` to an optional property |
| `strict` | the usual set |

The idioms you will see in existing code are consequences of these, not preferences:

```ts
// erasableSyntaxOnly: no parameter properties, so fields are assigned by hand
// and native #private is used instead of the `private` modifier
readonly #secret: string;

// noUncheckedIndexedAccess: env reads are string | undefined, hence bracket
// access plus an explicit default or throw
const tier = process.env['PIXELLAB_TIER'] ?? 't1';

// exactOptionalPropertyTypes: you cannot pass `undefined` through, so an
// optional field is spread in conditionally
...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
```

That last idiom is at `tools/pixellab-pipeline/src/cli.ts:240@8d21d33a` if you need the full shape.

### There is no workspace

No root `package.json`, no root `tsconfig.json`. Each tool is installed and run independently, from
inside its own directory. `npm install` at the repo root does nothing useful, and a command that
works has a `cd tools/<tool>` in front of it.

Available scripts, exactly:

```bash
cd tools/pixellab-pipeline
npm run typecheck      # tsc -p tsconfig.json --noEmit
npm test               # node --test src/*.test.ts
npm run cli -- plan    # node src/cli.ts

cd tools/character-builder
npm run typecheck      # tsc -p tsconfig.json   (no --noEmit; noEmit is in the config)
npm run dev            # vite, port 5174
```

`npm run refresh-openapi` in the pipeline points at a script that does not exist, and
`npm run codegen` produces a `schema.d.ts` that nothing imports. Neither is part of a working flow
today.

### There is no linter and no formatter

No ESLint, no Prettier, no Biome, no editorconfig. "Matching the code style" here means matching what
the surrounding file does, because the compiler is the only automated opinion in the repo. Do not
introduce a formatter as a side effect of another task.

### Language split inside code

Identifiers, types, functions, file names and commit messages are English; comments that explain
*why* may be either, and the existing code mixes them deliberately — English for mechanical notes,
Portuguese for user-facing strings and for reasoning aimed at the project owner
(`docs/adr/0008-idioma-docs-ptbr-codigo-en.md:20@fff4be23`). Anything the player or the CLI user
reads is pt-BR.

## References

- `docs/adr/0002-cliente-rest-gerado-do-openapi.md` — why the API client is hand-written
- Sibling skill `testing-repo-code` for the runner and the coverage gap
