# ADR 0011 — Repositório `isometric-maker`, pasta local `power-abuse`

> **Quick Start (TL;DR)**
>
> O repositório no GitHub passa a se chamar `isometric-maker`. A pasta local **continua** `/home/ondokai/Projects/isometric-maker/`, e todo caminho absoluto na documentação continua apontando para ela. Isso não é inconsistência a corrigir — é decisão.
>
> ```bash
> git -C /home/ondokai/Projects/isometric-maker remote -v
> git worktree list
> ```

**Status:** aceita · **Data:** 2026-07-30

## Contexto

A [ADR 0010](0010-pivo-para-editor-isometrico.md) trocou o produto. O nome "Power Abuse" descrevia um MMORPG hardcore e não descreve mais nada do que este repositório faz.

Renomear no GitHub é barato: `gh repo rename` mantém um redirecionamento do nome antigo, então nenhum clone quebra no instante da troca.

Renomear a pasta local não é barato. Três coisas dependem do nome do diretório:

1. **Quatro worktrees ativas** penduradas em `/home/ondokai/Projects/isometric-maker/.git`, listadas por `git worktree list`. Elas guardam o caminho do repositório principal em arquivos internos do git.
2. **Toda a documentação**, que pela convenção 3 usa caminho absoluto e nunca relativo. Uma varredura contaria dezenas de ocorrências em `docs/`, no `AGENTS.md` e em cerca de quarenta arquivos de `.agents/skills/`.
3. **O estágio de verificação de `/home/ondokai/Projects/isometric-maker/scripts/check-docs.sh`**, que ignora tokens começando em `/home/` justamente para distinguir caminho de sistema de arquivos de rota de API. O prefixo é literal.

O ganho de alinhar o nome da pasta é estético. O custo é uma varredura em três árvores mais o conserto das worktrees, com risco de quebrar o caminho do spec vendorizado — que é a fonte de verdade mais importante do projeto.

## Decisão

O repositório remoto passa a ser `isometric-maker`. A pasta local permanece `/home/ondokai/Projects/isometric-maker/`.

```bash
gh repo rename isometric-maker
git remote set-url origin git@github.com:frederico-kluser/isometric-maker.git
```

O `git remote set-url` é executado uma vez a partir do repositório principal: as worktrees compartilham um único diretório `.git`, então a atualização vale para todas.

**Todo caminho absoluto em documentação, skill ou comentário continua escrito como `/home/ondokai/Projects/isometric-maker/…`.** Isso está correto e não deve ser "consertado".

O `AGENTS.md` ganha uma seção curta dizendo exatamente isso, porque a divergência entre nome de repositório e nome de pasta é o tipo de coisa que um agente futuro corrige por reflexo, achando que ajuda.

## Consequências

- **Um agente que faça varredura de consistência trocando `power-abuse` por `isometric-maker` nos caminhos quebra tudo de uma vez:** o caminho do spec vendorizado, os comandos das ferramentas, o `--check` do vendor do PixiJS e a regra de skip do `check-docs.sh`. A redundância entre esta ADR, a seção nova do `AGENTS.md` e `docs/00-produto/visao.md` é deliberada.
- Os escopos npm passam de `@isometric-maker/*` para `@isometric-maker/*`. Os pacotes são privados e não publicados, então o rename não afeta ninguém fora do disco.
- Quem clonar o repositório novo verá a pasta `isometric-maker/` e caminhos apontando para `power-abuse/`. Os comandos de doc não vão funcionar sem ajuste na máquina do clone — o que já era verdade antes, porque a convenção 3 fixa o caminho da máquina do usuário.
- O redirecionamento do GitHub cobre o nome antigo por tempo indeterminado, mas some se alguém criar um repositório novo chamado `power-abuse` na mesma conta.

## Referências

- `/home/ondokai/Projects/isometric-maker/AGENTS.md` — a seção "Nome do repositório e caminhos"
- [`ADR 0008`](0008-idioma-docs-ptbr-codigo-en.md) — a convenção de caminho absoluto que torna isto uma decisão e não um detalhe
- [`ADR 0010`](0010-pivo-para-editor-isometrico.md) — o pivô que motivou o nome novo

**Última atualização:** 2026-07-30
