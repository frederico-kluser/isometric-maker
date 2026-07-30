---
name: writing-project-docs
description: Applies this repo's twelve documentation conventions - five that a script already checks and seven that nothing checks - plus the rules for recording an architecture decision or superseding one. Use whenever creating or editing anything under docs/, the README, or an ADR, and whenever a decision needs to be written down - including Portuguese phrasings like "escrever a doc", "documentar isso", "criar um ADR", "registrar a decisao", "atualizar o README", "revisar a documentacao", "adicionar no indice". Triggers on docs/, ADR, Quick Start, Referencias, Ultima atualizacao, check-docs, indice, convencoes, proveniencia.
metadata:
  type: task
  verification_signal: bash scripts/check-docs.sh
---

# Writing project docs

## When to use

Before creating or editing any markdown under `docs/`, before touching the README, and any time a
decision gets recorded or revised.

## Injected knowledge

### Five conventions are checked; seven are not

Run the checker — do not re-derive the format from prose:

```bash
bash scripts/check-docs.sh
```

It enforces exactly four format rules plus one semantic rule
(`scripts/check-docs.sh:14@45c21969`): a single `# H1`; a
`> **Quick Start (TL;DR)**` blockquote; a `## Referências` heading; a final
`**Última atualização:** YYYY-MM-DD` line; and that **every backticked endpoint path cited anywhere
in `docs/` exists in the vendored OpenAPI spec** (`:28`). That last one is the interesting one — it
is what stops the documentation from rotting the way the previous guide did.

The seven the checker cannot see are the ones an agent silently breaks
(`AGENTS.md:55@4a84b2d0`):

1. absolute paths always, never relative
2. dates in ISO form
3. a syntax hint on every code block
4. never copy upstream documentation literally — write what was done and **why**
5. traps and limitations in their own honest section; do not sell the tool
6. mark explicitly what is an estimate, what is derived, and what was **not verified**
7. **update the table in `docs/README.md` whenever a doc is added — always**

Number seven is the one that breaks most often, because adding a file feels finished. It is not: the
index is the map, and a doc missing from it is a doc nobody finds.

### Honesty is a hard rule, not a tone preference

> "Se algo não foi verificado, escreva que não foi verificado. Documentação que finge certeza é pior
> que documentação ausente, porque ninguém vai checar depois." — `AGENTS.md:76@4a84b2d0`

The existing docs do this well and the pattern is worth copying: `docs/01-pixellab/custos-e-limites.md:237@86c1d244`
lists what remains unverified, and `docs/adr/0007-fase1-vm-unica.md:24@385b9c10` marks its central
cost finding as not yet confirmed. Preserve those hedges when quoting; stripping a hedge is the most
common way a correct document becomes a wrong one.

### No speculative documentation

> "Doc de infra escrita antes de existir infra é ficção." — `AGENTS.md:73@4a84b2d0`

`docs/README.md` lists 57 entries and 42 of them are still `pendente`. Adding prose to a pending
entry is only worth doing when the thing it describes exists.

### Language, by axis

Documentation and everything a player reads: **pt-BR**. Code identifiers, code folder names and
commit messages: **English** (`docs/adr/0008-idioma-docs-ptbr-codigo-en.md:20@abdd2ed9`). Doc
*filenames* stay Portuguese because they are documentation.

And a rule that overrides the machine-wide default:

> "**Nunca assine `Co-authored-by Claude` automaticamente** — o usuário decide caso a caso."
> — `AGENTS.md:18@4a84b2d0`

### ADRs: the part that is irreversible

An accepted ADR is **never edited**. A revised decision becomes a **new** ADR that supersedes the old
one, and the old one stays exactly as written (`docs/README.md:116@a34506f4`). This is the guard: the
value of the record is that it shows what was believed at the time, and editing destroys precisely
that.

Structure, from the eight that exist: `# ADR NNNN — <decision in one line>`, the Quick Start
blockquote, a `**Status:** aceita · **Data:** YYYY-MM-DD` line, then `## Contexto`, `## Decisão`,
optionally `## Alternativas consideradas`, `## Consequências`, `## Referências`. Number sequentially
with four digits; the filename is the number plus a kebab-case pt-BR slug.

Two things the existing ADRs do that are worth imitating: they record **rejected** alternatives with
the reason, and they name the **cost** of the decision explicitly under Consequências. An ADR that
lists only benefits is not a decision record.

## Procedure

1. Write or edit the file.
2. If it is new, add its row to the table in `docs/README.md` — same section, with an honest state.
3. Update the `**Última atualização:**` line of every file touched.
4. Run `bash scripts/check-docs.sh`.
5. If a broken link is introduced, fix it now; the checker does not look at links, so nothing else
   will catch it. Fifteen are already broken repo-wide.

## References

- `AGENTS.md` — the twelve conventions in full
- `docs/README.md` — the index that must be kept current
- Sibling skill `querying-pixellab-api` before citing any endpoint in prose

## <evolution>

On task completion, run the memory pipeline. The external signal is `bash scripts/check-docs.sh`
returning clean.

Record something here only when a **convention** changed — a new rule, a rule that became
automated, a checker that gained a test. If a convention moves from prose to enforcement, do not add
a line saying so: **delete** it from the unchecked list and add it to the checked one, then update
the count in the heading. Keeping the same rule described in two places is how the two descriptions
start disagreeing.

Never record the content of a document you wrote. That lives in the document.
