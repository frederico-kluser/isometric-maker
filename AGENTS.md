# AGENTS.md — isometric-maker

Instruções para agentes de código que trabalham neste repositório. `CLAUDE.md` é symlink para este arquivo. Leia também **Nome do repositório e caminhos**, mais abaixo: o nome da pasta diverge do nome do repositório de propósito.

## Idioma — não confunda os dois eixos

| O que | Idioma |
| --- | --- |
| Documentação (`docs/`), README, ADRs, comentários explicativos longos | **português do Brasil** |
| Todo texto que o usuário do editor lê (UI, mensagens de erro) e o texto do jogo exportado | **português do Brasil** |
| Código: identificadores, tipos, funções, arquivos de código, chaves de JSON de dados | **inglês** |
| Mensagens de commit, branches, PRs | **inglês** |

Nomes de pasta de **documentação** são em português (`docs/03-mapa/`). Nomes de pasta de **código** são em inglês (`tools/`, `src/`, `packages/`) — em 40 projetos seus, nenhum diretório de código tem nome em português, e essa regra segue o padrão.

**Divergência registrada:** `/home/ondokai/Projects/config/CLAUDE.md` manda commit em PT-BR imperativo. Aqui o commit é em inglês, porque este é repositório de código e segue `/home/ondokai/Projects/leet-code-rpg/README.md`. Está em [ADR 0008](docs/adr/0008-idioma-docs-ptbr-codigo-en.md).

**Nunca assine `Co-authored-by Claude` automaticamente** — o usuário decide caso a caso (regra dele, em `/home/ondokai/Projects/config/CLAUDE.md`).

## Regra dura: nunca escreva sobre a API do PixelLab de memória

A API do PixelLab **muda sem versionar** — o `info.version` do spec é literalmente `"dev"`. Já existe um guia defasado em `~/Projects/tech-docs/games/5.md` que documenta endpoints v1 que não existem mais e erra o custo por uma ordem de magnitude. Não repita o erro.

A fonte da verdade neste repositório é o spec vendorizado:

```
/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json
(+ PROVENIENCIA.txt com data de captura e sha256)
```

Antes de afirmar que um endpoint, parâmetro, enum ou limite existe, **consulte o spec vendorizado**. Para atualizar, rode `npm run refresh-openapi` dentro de `tools/pixellab-pipeline` — ele baixa o spec, regrava o `PROVENIENCIA.txt` com data e sha256 novos, e deixa o diff visível no git. Depois rode `npm run typecheck` e `npm test`, e trate os erros como a lista de mudanças do fornecedor.

Revendorizar **não invalida o catálogo**: `computeSpecHash` hasheia `{endpoint, params, inputs, parents, pipelineVersion, salt}` e o schema não entra. Drift de schema é aviso do `doctor`, nunca cobrança nova. E a checagem tem que ser por conteúdo: em 2026-08-01 o spec mudou de sha256 mantendo os mesmos 79 paths e 235 schemas — contagem de paths teria reportado "sem mudança".

Ao citar preço, escreva **"preço estimado"**. A própria PixelLab rotula a coluna como `Estimated Price* (USD)` com a nota "will vary because of variation in the GPU processing time".

## Regra dura: nada de custo surpresa

Todo asset gerado gasta dinheiro real. O pipeline é idempotente por design: gerar de novo com o mesmo spec **não deve gastar nada**. Se você mexer em `src/catalog.ts` ou na função de hash, isso tem que continuar verdadeiro — saldo idêntico antes e depois. O teste de idempotência existe e passa (`catalog.test.ts`), mas não cobre todos os caminhos de regressão (reencode de PNG, drift de schema, `runResume`).

**Sempre rode `pixellab plan` e `pixellab estimate` antes de qualquer geração.** O guard **informa e nunca recusa** ([ADR 0012](docs/adr/0012-guard-de-orcamento-informativo.md)) — ele estima, mostra o gasto da sessão e do mês, e pede confirmação. Nunca use `--force` sem `--reason`: `--force` fura a **idempotência**, não o orçamento.

Duas decisões de hash que parecem detalhe e não são:

- O `inputHash` é dos **pixels decodificados**, não dos bytes do arquivo. Reencodar um PNG muda os bytes e não muda a imagem; hashear bytes cobraria de novo por nada.
- O hash do schema OpenAPI **não entra** no `specHash`. Se a PixelLab mexer num campo que nem usamos, incluí-lo invalidaria o catálogo inteiro e geraria uma fatura por zero benefício. Drift de schema é **aviso** do `doctor`, nunca invalidação de cache.

Nunca use `mode='pro'` em animação sem uma decisão explícita registrada: custa 20–40 gerações **por direção** (160–320 para as 8). O default do projeto é `mode='template'`, que custa 1 geração por direção.

## O que este projeto não é

Este é um **editor de jogos isométricos**, local e de usuário único ([ADR 0010](docs/adr/0010-pivo-para-editor-isometrico.md)). Não há jogadores — há um usuário, na própria máquina.

- Sem servidor autoritativo, sem multiplayer, sem netcode, sem protocolo de rede, sem sharding.
- Sem permadeath, full loot, economia entre jogadores, anti-cheat ou moderação. Não existe GM porque não existe partida.
- Reintroduzir qualquer um desses itens exige ADR nova. `scripts/check-docs.sh` falha se um desses termos reaparecer em `docs/`.

## Estilo de documentação — as 12 convenções obrigatórias

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

1. Armadilhas e limitações em seção própria, honestas. Não venda a ferramenta.
2. Marcar explicitamente o que é estimativa, o que é derivado e o que **não foi verificado**.
3. **Atualizar a tabela de `docs/README.md` ao adicionar uma doc nova — sempre.**
4. Não criar doc especulativa. Doc de infra escrita antes de existir infra é ficção.

Se algo não foi verificado, escreva que não foi verificado. Documentação que finge certeza é pior que documentação ausente, porque ninguém vai checar depois.

**ADR não se edita.** Uma decisão revista gera ADR nova, que declara `**Substitui:** ADR NNNN` numa linha logo abaixo do Status; a tabela de `docs/README.md` marca a antiga na coluna `Situação`. O mecanismo é unidirecional: o arquivo novo ganha um campo, o antigo nunca é tocado.

## Comandos

Não existe workspace nem `package.json` na raiz. Todo comando roda de dentro da sua ferramenta.

```bash
# Pipeline e assets
cd tools/pixellab-pipeline && npm test              # node --test src/*.test.ts (76 testes)
cd tools/pixellab-pipeline && npm run typecheck
# Estúdio de personagem
cd tools/character-builder && npm run typecheck
cd tools/character-builder && npm test              # 18 arquivos de teste (197 testes)
# Mapa e geometria
cd packages/iso-core && npm run typecheck
cd packages/iso-core && npm test                    # 290 testes
cd tools/map-builder && npm run typecheck
cd tools/map-builder && npm test                    # autotile, export, picking
# Runtime
cd tools/runtime && npm run typecheck
# Verificadores e docs
bash scripts/gate.sh                                # portão de merge completo
bash scripts/check-docs.sh                          # convenções de doc + endpoints + termos proibidos + links
node .agents/skills/scripts/lint-skills.mjs         # formato das skills
node .agents/skills/scripts/run-skill-evals.mjs
node tools/pixi-reference/scripts/vendor-types.mjs --check  # integridade do vendor do PixiJS
```

Não há linter, formatter nem CI neste repositório. O compilador e os scripts em `scripts/` são as únicas opiniões automatizadas que existem.

| Script | O que verifica |
| --- | --- |
| `scripts/gate.sh` | Portão de merge: typecheck + testes de `pixellab-pipeline`, `iso-core`, `map-builder`, `runtime`; `check-docs.sh`; pin do PixiJS; fronteira do runtime; validadores de plano e ledger |
| `scripts/check-docs.sh` | Convenções de documentação, termos proibidos, links |
| `scripts/check-pixi-pin.mjs` | Versão do PixiJS está congelada |
| `scripts/check-runtime-boundary.sh` | Fronteira entre `iso-core` e `runtime` não foi violada |
| `scripts/validate-plan.mjs` | Integridade do `plan.json` |
| `scripts/validate-ledger.mjs` | Integridade do ledger de incerteza |
| `scripts/check-acceptance.mjs` | Forma dos critérios de aceitação (são falsificáveis, não se foram atendidos) |
| `scripts/new-task-worktree.sh` | Cria worktree para nova task |

## Skills

Toda tarefa passa por [`.agents/skills/project-router`](.agents/skills/project-router/SKILL.md), que pergunta antes de agir, escreve um `TASK_PLAN.md` descartável e escolhe as skills. O índice fica em [`.agents/skills/catalog.md`](.agents/skills/catalog.md).

`.claude/skills` é symlink para `.agents/skills` — a fonte da verdade é a pasta `.agents/`, e o symlink existe para que qualquer agente que leia `.claude/skills` veja os mesmos arquivos.

Três hooks em `.claude/settings.json` tornam determinístico o que prosa não garante: escrita em `SKILL.md` existente exige token de validação fresco; `.env` e `secrets/` são ilegíveis; padrões destrutivos de shell são bloqueados. Hooks são lidos no início da sessão — editar `settings.json` só vale na próxima.

**As skills são em inglês, por decisão do sistema que as gerou** — divergem da regra de idioma acima, que continua valendo para `docs/`, README e texto do editor. As perguntas do router ao usuário e o `TASK_PLAN.md` são em português, por requisito funcional.

A skill `enforcing-server-authority` foi **retirada com o pivô e não tem sucessora**: o assunto dela deixou de existir. A ausência é decisão, não acidente.

## Nome do repositório e caminhos

Repositório, pasta local e escopo npm são o mesmo nome: **`isometric-maker`**. Todo caminho absoluto aponta para `/home/ondokai/Projects/isometric-maker/`, e os pacotes são `@isometric-maker/*`.

A [ADR 0011](docs/adr/0011-repo-isometric-maker-pasta-power-abuse.md) tinha mantido a pasta com o nome antigo para não quebrar worktrees; a [ADR 0017](docs/adr/0017-nome-unico-isometric-maker.md) reverteu isso e purgou o nome anterior. O nome `power-abuse` só sobrevive no **arquivo** da 0011, que nomeia a decisão desfeita — e deve continuar lá.

## Referências

- [`README.md`](README.md) — visão geral do projeto
- [`docs/README.md`](docs/README.md) — índice da documentação
- [`docs/00-produto/visao.md`](docs/00-produto/visao.md) — o que o editor é e o que ele não é
- [`docs/adr/`](docs/adr/) — decisões e seus motivos
- [`.agents/skills/catalog.md`](.agents/skills/catalog.md) — índice das skills
