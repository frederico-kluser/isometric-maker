# AGENTS.md — Ferro e Cinzas

Instruções para agentes de código que trabalham neste repositório. `CLAUDE.md` é symlink para este arquivo.

## Idioma — não confunda os dois eixos

| O que | Idioma |
|---|---|
| Documentação (`docs/`), README, ADRs, comentários explicativos longos | **português do Brasil** |
| Todo texto que o jogador lê (UI, itens, diálogo, mensagens de erro do jogo) | **português do Brasil** |
| Código: identificadores, tipos, funções, arquivos de código, chaves de JSON de dados | **inglês** |
| Mensagens de commit, branches, PRs | **inglês** |

Nomes de pasta de **documentação** são em português (`docs/05-economia/`). Nomes de pasta de **código** são em inglês (`tools/`, `src/`, `packages/`) — em 40 projetos seus, nenhum diretório de código tem nome em português, e essa regra segue o padrão.

**Divergência registrada:** `/home/ondokai/Projects/config/CLAUDE.md` manda commit em PT-BR imperativo. Aqui o commit é em inglês, porque este é repositório de código e segue `/home/ondokai/Projects/leet-code-rpg/README.md`. Está em [ADR 0008](docs/adr/0008-idioma-docs-ptbr-codigo-en.md).

**Nunca assine `Co-authored-by Claude` automaticamente** — o usuário decide caso a caso (regra dele, em `/home/ondokai/Projects/config/CLAUDE.md`).

## Regra dura: nunca escreva sobre a API do PixelLab de memória

A API do PixelLab **muda sem versionar** — o `info.version` do spec é literalmente `"dev"`. Já existe um guia defasado em `~/Projects/tech-docs/games/5.md` que documenta endpoints v1 que não existem mais e erra o custo por uma ordem de magnitude. Não repita o erro.

A fonte da verdade neste repositório é o spec vendorizado:

```
/home/ondokai/Projects/ferro-e-cinzas/tools/pixellab-pipeline/openapi/openapi-v2.json
(+ PROVENIENCIA.txt com data de captura e sha256)
```

Antes de afirmar que um endpoint, parâmetro, enum ou limite existe, **consulte o spec vendorizado**. Se for necessário atualizar, baixe de `https://api.pixellab.ai/v2/openapi.json`, regrave o `PROVENIENCIA.txt` com a nova data e hash, rode `npm run codegen` e trate os erros de compilação como a lista de mudanças.

Ao citar preço, escreva **"preço estimado"**. A própria PixelLab rotula a coluna como `Estimated Price* (USD)` com a nota "will vary because of variation in the GPU processing time".

## Regra dura: nada de custo surpresa

Todo asset gerado gasta dinheiro real. O pipeline é idempotente por design: gerar de novo com o mesmo spec **não deve gastar nada**. Se você mexer em `src/catalog.ts` ou na função de hash, o teste de idempotência tem que continuar passando — saldo idêntico antes e depois.

**Sempre rode `pixellab plan` e `pixellab estimate` antes de qualquer geração.** Nunca use `--force` sem `--reason`. `generate` gasta dinheiro real.

Duas decisões de hash que parecem detalhe e não são:
- O `inputHash` é dos **pixels decodificados**, não dos bytes do arquivo. Reencodar um PNG muda os bytes e não muda a imagem; hashear bytes cobraria de novo por nada.
- O hash do schema OpenAPI **não entra** no `specHash`. Se a PixelLab mexer num campo que nem usamos, incluí-lo invalidaria o catálogo inteiro e geraria uma fatura por zero benefício. Drift de schema é **aviso** do `doctor`, nunca invalidação de cache.

Nunca use `mode='pro'` em animação sem uma decisão explícita registrada: custa 20–40 gerações **por direção** (160–320 para as 8). O default do projeto é `mode='template'`, que custa 1 geração por direção.

## Servidor autoritativo não é negociável

O jogo tem permadeath, full loot e nenhum GM. Isso significa que uma falha de autoridade não é um bug de balanceamento, é a destruição do progresso de alguém sem recurso.

- Nenhuma decisão de dano, acerto, morte, loot ou transação de item pode originar no cliente.
- Toda transferência de item passa por transação e ledger idempotente. Ver `docs/03-arquitetura/`.
- O cliente é código público. Trate tudo que vem dele como hostil.

## Estilo de documentação — as 8 convenções obrigatórias

Herdadas de `/home/ondokai/Projects/config/CLAUDE.md`, que é o padrão do usuário:

1. **Um único `# H1`** no topo, descritivo, em PT-BR.
2. **Quick Start (TL;DR) logo após o H1, em blockquote** (`> **Quick Start (TL;DR)**`), com 1–3 linhas de contexto e os comandos essenciais.
3. **Caminhos absolutos** sempre (`/home/ondokai/Projects/...`), nunca relativos.
4. **Datas em ISO** (`2026-07-29`).
5. **Todo code block com syntax hint** (` ```bash `, ` ```json `, ` ```ts `).
6. **Seção `## Referências` no final.**
7. **Linha final `**Última atualização:** YYYY-MM-DD`.**
8. **Não copiar doc upstream literalmente** — documentar o que foi feito e o **porquê**, com as armadilhas encontradas.

Além disso, específico deste repo:

9. Armadilhas e limitações em seção própria, honestas. Não venda a ferramenta.
10. Marcar explicitamente o que é estimativa, o que é derivado e o que **não foi verificado**.
11. **Atualizar a tabela de `docs/README.md` ao adicionar uma doc nova — sempre.**
12. Não criar doc especulativa. Doc de infra escrita antes de existir infra é ficção.

Se algo não foi verificado, escreva que não foi verificado. Documentação que finge certeza é pior que documentação ausente, porque ninguém vai checar depois.

## Comandos

Não existe workspace nem `package.json` na raiz. Todo comando roda de dentro da sua ferramenta.

```bash
cd tools/pixellab-pipeline && npm test         # node --test src/*.test.ts
cd tools/pixellab-pipeline && npm run typecheck
cd tools/sprite-studio     && npm run typecheck
bash scripts/check-docs.sh                     # convenções de doc + endpoints citados
node .agents/skills/scripts/lint-skills.mjs    # formato das skills
node .agents/skills/scripts/run-skill-evals.mjs
```

Não há linter, formatter nem CI neste repositório. O compilador e esses scripts são as únicas opiniões automatizadas que existem.

## Skills

Toda tarefa passa por [`.agents/skills/project-router`](.agents/skills/project-router/SKILL.md), que pergunta antes de agir, escreve um `TASK_PLAN.md` descartável e escolhe as skills. O índice fica em [`.agents/skills/catalog.md`](.agents/skills/catalog.md).

`.claude/skills` é symlink para `.agents/skills` — a fonte da verdade é a pasta `.agents/`, e o symlink existe para que qualquer agente que leia `.claude/skills` veja os mesmos arquivos.

Três hooks em `.claude/settings.json` tornam determinístico o que prosa não garante: escrita em `SKILL.md` existente exige token de validação fresco; `.env` e `secrets/` são ilegíveis; padrões destrutivos de shell são bloqueados. Hooks são lidos no início da sessão — editar `settings.json` só vale na próxima.

**As skills são em inglês, por decisão do sistema que as gerou** — divergem da regra de idioma acima, que continua valendo para `docs/`, README e texto de jogo. As perguntas do router ao usuário e o `TASK_PLAN.md` são em português, por requisito funcional.

## Referências

- [`README.md`](README.md) — visão geral do projeto
- [`docs/README.md`](docs/README.md) — índice da documentação
- [`docs/adr/`](docs/adr/) — decisões e seus motivos
- [`.agents/skills/catalog.md`](.agents/skills/catalog.md) — índice das skills
- [`.agents/skills/project-analysis.md`](.agents/skills/project-analysis.md) — o levantamento que originou as skills
