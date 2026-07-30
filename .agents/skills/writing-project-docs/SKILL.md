---
name: writing-project-docs
description: Applies this repo's twelve documentation conventions - four that a script already checks and eight that nothing checks - plus the three semantic passes the checker adds and the rules for recording an architecture decision or superseding one. Use whenever creating or editing anything under docs/, the README, or an ADR, and whenever a decision needs to be written down - including Portuguese phrasings like "escrever a doc", "documentar isso", "criar um ADR", "registrar a decisao", "atualizar o README", "revisar a documentacao", "adicionar no indice". Triggers on docs/, ADR, Substitui, Quick Start, Referencias, Ultima atualizacao, check-docs, indice, convencoes, proveniencia.
metadata:
  type: task
  verification_signal: bash scripts/check-docs.sh
---

# Writing project docs

## When to use

Before creating or editing any markdown under `docs/`, before touching the README, and any time a
decision gets recorded or revised.

## Injected knowledge

### Four conventions are checked; eight are not

Run the checker — do not re-derive the format from prose:

```bash
bash scripts/check-docs.sh
```

It enforces four format rules (`scripts/check-docs.sh:14-17@075079fb`): a single `# H1`; a
`> **Quick Start (TL;DR)**` blockquote; a `## Referências` heading; a final
`**Última atualização:** YYYY-MM-DD` line. The scope is every `.md` under `docs/` plus the root
`README.md` and `tools/*/README.md`; `AGENTS.md` is left out on purpose, because it is an
instruction file and not a document (`scripts/check-docs.sh:19-20@075079fb`).

Those four are conventions 1, 2, 6 and 7 of the twelve listed in `AGENTS.md:55@eb529ae5`. The other
eight are the ones an agent silently breaks:

- 3. absolute paths always, never relative
- 4. dates in ISO form
- 5. a syntax hint on every code block
- 8. never copy upstream documentation literally — write what was done and **why**
- 9. traps and limitations in their own honest section; do not sell the tool
- 10. mark explicitly what is an estimate, what is derived, and what was **not verified**
- 11. **update the table in `docs/README.md` whenever a doc is added — always**
- 12. no speculative documentation

Number eleven is the one that breaks most often, because adding a file feels finished. It is not:
the index is the map, and a doc missing from it is a doc nobody finds.

### Three more passes, which are not conventions at all

Beyond the format rules the checker runs three semantic passes, and any of them fails the build:

1. **Every backticked endpoint path cited anywhere in `docs/` must exist in the vendored OpenAPI
   spec** (`scripts/check-docs.sh:39-45@075079fb`). Paths beginning `/home/` and a short deliberate
   v1 list are exempt. This is what stops the documentation from rotting the way the previous guide
   did.
2. **A term from the previous product fails the build if it reappears** in `docs/` — the term list
   and its exemptions are in `scripts/check-docs.sh:67-68@075079fb`. Exempt: `docs/adr/`, because a
   frozen decision legitimately names the scope it removed and editing it is forbidden;
   `docs/00-produto/visao.md`, the document whose job *is* to name what the product is not; and
   `docs/README.md`, the index, which has to name the deleted ADRs. The match is case-insensitive
   and by substring, so a listed term inside a longer word still trips it — but only as written: the
   old product *name* is on the list as prose, and since ADR 0017 the folder is named after the
   current product too, so no mandatory absolute path can trip the check by accident.
3. **Every relative markdown link must resolve** (`scripts/check-docs.sh:87-100@075079fb`), over the
   same set of files as the format rules. `docs/adr/` is exempt here too, for the same reason: an ADR
   still pointing at a file that has since been deleted is the record working, and repairing it
   would mean editing a frozen decision. Do not "fix" it.

### Honesty is a hard rule, not a tone preference

> "Se algo não foi verificado, escreva que não foi verificado. Documentação que finge certeza é pior
> que documentação ausente, porque ninguém vai checar depois." — `AGENTS.md:75@eb529ae5`

The existing docs do this and the pattern is worth copying:
`docs/01-pixellab/custos-e-limites.md:237@fe52f3d5` closes with an explicit **Não verificado:** line
naming what is still unknown. Preserve those hedges when quoting; stripping a hedge is the most
common way a correct document becomes a wrong one.

### No speculative documentation

> "Doc de infra escrita antes de existir infra é ficção." — `AGENTS.md:73@eb529ae5`

The index applies this literally. It lists only files that exist on disk
(`docs/README.md:11@62ab10c3`), and a numbered folder with no file yet is declared **reserved**
rather than promised (`docs/README.md:42@62ab10c3`). An earlier version of that index promised
dozens of entries it did not have, and the repair was to withdraw the promise, not to rush the
writing. Never add a row for a file you have not written.

### Language, by axis

Documentation, everything the editor's user reads, and the text of the exported game: **pt-BR**. Code
identifiers, code folder names and commit messages: **English**
(`docs/adr/0008-idioma-docs-ptbr-codigo-en.md:20@fff4be23`). Doc
*filenames* stay Portuguese because they are documentation.

And a rule that overrides the machine-wide default:

> "**Nunca assine `Co-authored-by Claude` automaticamente** — o usuário decide caso a caso."
> — `AGENTS.md:18@eb529ae5`

### ADRs: the part that is irreversible

An accepted ADR is **never edited**. A revised decision becomes a **new** ADR that supersedes the
old one, and the old one stays exactly as written (`AGENTS.md:77@eb529ae5`). This is the guard: the
value of the record is that it shows what was believed at the time, and editing destroys precisely
that.

The supersession mechanism is one-directional, and that is the whole point:

- the **new** ADR declares `**Substitui:** ADR NNNN` on a line immediately below its `**Status:**`
  line — the shape to copy is `docs/adr/0014-pixijs-para-o-editor.md:12@c4bf785c`;
- the `Situação` column of the ADR table registers it for whoever reads the index, and that column
  is the only place supersession is visible from outside the new file (`docs/README.md:61@62ab10c3`);
- the **old file is never touched** — not its status line, not a note at the top, nothing.

A deleted ADR is a different thing from a superseded one. When a decision's whole subject stopped
existing, the file goes away and its row stays in the index, marked `apagada` with the reason
(`docs/README.md:71@62ab10c3`) — so the number stays taken and the sequence never rewinds.

Structure, from the thirteen that exist: `# ADR NNNN — <decision in one line>`, the Quick Start
blockquote, a `**Status:** aceita · **Data:** YYYY-MM-DD` line, then `## Contexto`, `## Decisão`,
optionally `## Alternativas consideradas`, `## Consequências`, `## Referências`. Number sequentially
with four digits; the filename is the number plus a kebab-case pt-BR slug.

Two things the existing ADRs do that are worth imitating: they record **rejected** alternatives with
the reason, and they name the **cost** of the decision explicitly under Consequências. An ADR that
lists only benefits is not a decision record.

### Editing a doc that skills cite: keep the line count

Skill provenance is `path:line@blob8`. `lib.mjs` grades a **missing file or an out-of-range line as
an error**, and a **changed hash as a warning that still exits 0**. So the expensive failure is not
the loud one: it is a doc that shrank past a cited line, or a line whose text was replaced under a
citation that now vouches for something else while the linter stays green.

Two habits follow, both measured on the pivot rewrite:

- **Rewrite a section to the same line count as the one it replaces** when anything below it is
  cited. Doing that to `AGENTS.md` lines 1–75 kept seven citations valid and took three skills out
  of the repair list; doing it to the budget section of `custos-e-limites.md` kept `:237` — the
  `**Não verificado:**` example — exactly where `writing-project-docs` cites it.
- **Sweep by line number, not by linter output**, for every line whose *text* you replaced. Grep the
  library for `<file>:<line>@` before editing and read what each citation claims. The linter will
  not tell you; a stale hash is only a warning.

Before deleting a doc at all, run `grep -rn "<path>" .agents/skills/*/SKILL.md`. Docs and the skills
that cite them move in the same commit — never "delete now, repair later".

## Procedure

1. Write or edit the file.
2. If it is new, add its row to that section's table in `docs/README.md`. The doc tables carry
   `Arquivo` and `Descrição` only — there is no status column to hedge in
   (`docs/README.md:17@62ab10c3`). If it is the first file of a folder still listed under **Pastas
   reservadas**, move that folder out of the reserved table and give it a section
   (`docs/README.md:44-49@62ab10c3`).
3. If it is an ADR that revises another, add the `**Substitui:** ADR NNNN` line under the Status
   line and set the older row's `Situação` to `substituída por NNNN`. Do not open the older file.
4. Update the `**Última atualização:**` line of every file touched.
5. Run `bash scripts/check-docs.sh`. All four passes have to be clean: conventions, endpoints,
   forbidden terms, links.
6. A dangling link the checker reports is yours to fix now. A dangling link it does **not** report
   because it lives under `docs/adr/` is to be left alone.

## References

- `AGENTS.md` — the twelve conventions in full
- `docs/README.md` — the index that must be kept current
- Sibling skill `querying-pixellab-api` before citing any endpoint in prose

## <evolution>

On task completion, run the memory pipeline. The external signal is `bash scripts/check-docs.sh`
returning clean.

Record something here only when a **convention** changed — a new rule, a rule that became
automated, a checker that gained a pass. If a convention moves from prose to enforcement, do not add
a line saying so: **delete** it from the unchecked list and add it to the checked one, then update
the counts in the heading. Keeping the same rule described in two places is how the two descriptions
start disagreeing.

Never record the content of a document you wrote. That lives in the document.
