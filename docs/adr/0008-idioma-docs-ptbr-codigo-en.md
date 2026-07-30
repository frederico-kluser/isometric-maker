# ADR 0008 — Docs e texto de jogo em pt-BR; código e commits em inglês

> **Quick Start (TL;DR)**
>
> Documentação e tudo que o jogador lê: **português do Brasil**. Código, identificadores, pastas de código e mensagens de commit: **inglês**.

**Status:** aceita · **Data:** 2026-07-29

## Contexto

O usuário tem duas convenções conflitantes na própria máquina:

- `/home/ondokai/Projects/config/CLAUDE.md` (repositório de documentação) manda **commit em PT-BR imperativo**.
- `/home/ondokai/Projects/leet-code-rpg/README.md` (repositório de código) declara texto de jogo em PT-BR e **código e commits em inglês**.

Além disso, em 40 projetos na árvore, **nenhum diretório de código tem nome em português** — `huu` usa `pipelines/`, `scripts/`, `docker/`; `GitCraque` usa `server/`, `web/`. Português aparece apenas em `config`, que é um repo de documentação.

## Decisão

Power Abuse é repositório de código, então segue o padrão de `leet-code-rpg`: commits e nomes de pasta de código em inglês, `tools/` em vez de `ferramentas/`. Documentação e texto de jogo em pt-BR.

Duas regras herdadas que valem aqui:

- As **8 convenções obrigatórias de doc** de `config/CLAUDE.md` (H1 único, Quick Start em blockquote, caminhos absolutos, datas ISO, syntax hint em code block, `## Referências`, linha `**Última atualização:**`, não copiar upstream literalmente).
- **Nunca assinar `Co-authored-by Claude` automaticamente** — o usuário decide caso a caso.

## Consequências

- Divergência explícita e registrada em relação a `config/CLAUDE.md` quanto ao idioma de commit. Se o usuário preferir PT-BR aqui também, é um ADR novo que substitui este.
- Nomes de arquivo de documentação continuam em português (`combate-zonas-oscilantes.md`), porque são documentação.

## Referências

- `/home/ondokai/Projects/config/CLAUDE.md`
- `/home/ondokai/Projects/leet-code-rpg/README.md`

**Última atualização:** 2026-07-29
