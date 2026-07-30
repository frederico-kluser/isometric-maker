# ADR 0012 — O guard de orçamento informa e nunca recusa

> **Quick Start (TL;DR)**
>
> O guard deixa de recusar geração acima de um teto. Passa a estimar, mostrar o gasto da sessão e do mês, e exigir confirmação explícita a cada geração. A idempotência **não** é flexibilizada: o guard é conselho, o cache é lei.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline
> node src/cli.ts estimate    # sai 0 mesmo acima do limiar; imprime AVISO, nunca RECUSADO
> ```

**Status:** aceita · **Data:** 2026-07-30

## Contexto

O guard atual, em `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/src/cost.ts`, tem quatro limiares e **recusa** acima de três deles: US$ 0,30 por asset, US$ 15 por execução, US$ 60 por mês, e confirmação acima de US$ 5. A recusa devolve exit code 2.

Esses números foram calibrados para um catálogo de MMORPG: sessenta criaturas, quatrocentos itens, cerca de 2.700 jobs, tudo planejado de antemão e gerado em lote. Nesse mundo, um teto é proteção contra um `mode='pro'` acidental multiplicando a fatura por cem.

A [ADR 0010](0010-pivo-para-editor-isometrico.md) mudou o produto. Num editor, quem decide gerar é uma pessoa olhando a tela, uma peça de cada vez, e o catálogo não existe de antemão — ele é o que o usuário desenhou. O usuário desta ferramenta declarou o requisito diretamente: **não há teto; ele para de gerar quando quiser.**

Um teto que recusa, nesse contexto, não protege ninguém: vira um obstáculo que o usuário contorna subindo o número, e o hábito de contornar é pior que a ausência do limite.

## Decisão

O guard passa a **informar e nunca recusar**.

Em `src/cost.ts`:

- `GuardVerdict` perde a variante `refuse`. No lugar entra um relatório:

  ```ts
  interface BudgetReport {
    readonly estimate: CostEstimate;
    readonly sessionSpentUsd: number;
    readonly monthSpentUsd: number;
    readonly balanceUsd: number | undefined;
    readonly warnings: readonly { code: WarningCode; text: string }[];
    readonly requiresConfirmation: true;
  }
  ```

  `requiresConfirmation` é **tipo literal `true`, não `boolean`**. É isso que faz o compilador impedir que alguém, mais tarde, crie um caminho que gera sem perguntar.

- `RefusalCode` vira `WarningCode` com os mesmos quatro valores. `DEFAULT_LIMITS` vira `DEFAULT_THRESHOLDS` e **mantém os mesmos números** — muda o significado, de "recuso acima" para "aviso acima".
- A confirmação é **por geração** e mostra três eixos: o custo estimado da ação, o acumulado da sessão e o acumulado do mês. O eixo de sessão é novo; sai do ledger, que já grava `at` e `usd`.

**O que não muda:** a função `decide()` em `src/catalog.ts` não perde uma linha. Gerar de novo com o mesmo spec continua custando zero, `blocked-rejected` continua sendo bloqueio duro, `--force` continua exigindo `--reason` — porque `--force` fura a *idempotência*, não o orçamento, e essa distinção é o que mantém a regra coerente depois da flexibilização.

## Alternativas consideradas

**Manter a recusa com tetos editáveis pelo usuário na tela.** Rejeitada porque preserva o pior dos dois mundos: o usuário ainda esbarra no limite, e a resposta natural é subir o número sem ler — o que treina a ignorar o aviso.

**Remover o guard inteiro.** Rejeitada porque `plan` e `estimate` são justamente o que evita descobrir o gasto na fatura. Sem estimativa antes da submissão, o custo vira surpresa por construção.

## Consequências

- **Quebra de contrato documentada:** o exit code 2 deixa de significar "recusado pelo orçamento" e passa a significar **"o usuário não confirmou"**. Qualquer script que só verifica `!= 0` continua funcionando, e a semântica "não gerou por decisão humana" se preserva.
- **A única trava mecânica que restava sai.** A proteção passa a ser uma pessoa lendo um número. Duas coisas seguram isso: a idempotência continua dura, então a falha mais comum — regerar o que já existe — continua custando zero; e a confirmação mostra o **acumulado**, porque uma estimativa de US$ 0,02 exibida trezentas vezes é como um guard informativo vira uma surpresa de US$ 6.
- **Risco aberto e declarado:** o teste de idempotência que o `AGENTS.md` afirma existir **não existe**. Os seis testes que passam cobrem atlas, util e endpoints; `catalog.ts`, `cost.ts`, `generate.ts` e `queue.ts` não têm cobertura nenhuma. Flexibilizar o guard enquanto a rede de idempotência ainda é hipótese é o risco real desta decisão, e escrever esses testes é item de entrada da primeira onda de trabalho.
- O estúdio passa a consultar o guard antes de submeter. Hoje ele submete direto, sem estimar e sem escrever no ledger — o que torna o gasto dele invisível para o acumulado mensal.

## Referências

- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/src/cost.ts` — os limiares e a ordem de avaliação
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/src/catalog.ts` — `decide()`, que esta ADR deliberadamente não toca
- [`ADR 0006`](0006-animacao-em-template-mode.md) — `mode='pro'` continua exigindo decisão registrada, independentemente do guard

**Não verificado:** se a PixelLab expõe algum limite de gasto do lado dela. O `GET /balance` devolve saldo, não teto.

**Última atualização:** 2026-07-30
