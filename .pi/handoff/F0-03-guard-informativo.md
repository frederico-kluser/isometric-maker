# F0-03 — Guard informativo e CLI honesto

**Onda:** W2 · **Worktree:** G-pipeline

## Arquivos produzidos / alterados

- `tools/pixellab-pipeline/src/cost.ts` — troca `GuardVerdict` por `BudgetReport`, `RefusalCode` por
  `WarningCode`, `DEFAULT_LIMITS` por `DEFAULT_THRESHOLDS`. `checkBudget` agora coleta avisos em vez
  de recusar e devolve `requiresConfirmation: true` (literal).
- `tools/pixellab-pipeline/src/cli.ts` — `cmdEstimate` sai 0 sempre, imprime avisos; `cmdGenerate`
  troca "RECUSADO" por "Confirmação necessária"; cabeçalho de exit codes atualizado; `ATLAS_OUT`
  movido para dentro do repositório; `PixelLabClient.fromEnv()` guardado com try/catch.
- `tools/pixellab-pipeline/src/catalog.ts` — remove menção à flag fantasma `--allow-unpinned` na
  validação de seed.

## API pública (assinatura final do relatório do guard)

Contrato para **F0-08** (testes) e **F1-06** (renderização no estúdio):

```ts
export type WarningCode = 'asset-cap' | 'run-cap' | 'monthly-cap' | 'balance';

export interface Aviso {
  readonly code: WarningCode;
  readonly measured: number;
  readonly threshold: number;
  readonly text: string;
}

export type BudgetReport =
  & {
      readonly estimate: CostEstimate;
      readonly sessionSpentUsd: number;
      readonly monthSpentUsd: number;
      readonly balanceUsd: number | undefined;
    }
  & (
    | { readonly avisos: readonly Aviso[]; readonly requiresConfirmation: true }
    | { readonly avisos: readonly Aviso[]; readonly requiresConfirmation: false }
  );

export function checkBudget(input: GuardInput, thresholds?: BudgetThresholds): BudgetReport;
```

`GuardInput` ganhou `spentThisSessionUsd: number`. Hoje chega 0 do CLI — session tracking não está
implementado.

`DEFAULT_THRESHOLDS` mantém os mesmos quatro números (0.30, 15, 5, 60) com significado alterado:
de "recuso acima" para "aviso acima".

## Decisões de design

### `requiresConfirmation` como literal

A intenção da ADR 0012 é que `requiresConfirmation: true` seja tipo literal, não `boolean`, para
impedir que um caminho novo que gere sem perguntar compile. A união `{ requiresConfirmation: true } |
{ requiresConfirmation: false }` atinge isso parcialmente:

- O produtor (`checkBudget`) retorna `true as const` — o literal é fixo.
- O consumidor (`cmdGenerate`) checa `if (report.requiresConfirmation)` e o type-narrowing funciona.
- **Limitação conhecida:** como `true | false` cobre o domínio inteiro de `boolean`, TypeScript
  colapsa os dois membros da união quando eles são estruturalmente idênticos. Um `BudgetReport`
  construído com uma variável `boolean` compila. Isso é uma limitação do type system, não da
  intenção de design. Se houver apetite para uma garantia mais forte, uma abordagem com `unique
  symbol` ou um campo `_brand` resolve, mas adiciona complexidade que este card julgou
  desproporcional.

### ATLAS_OUT

Movido de `../../packages/game-assets/atlas` (fora do repo, invisível ao git) para `./atlas`
(dentro de `tools/pixellab-pipeline/`). Justificativa: a saída do atlas deve ser versionada junto
com o código que a produziu. O caminho antigo apontava para um diretório que não existe em clone
nenhum; `atlas` escrevia num lugar que só existia na máquina de quem gerou.

### Flags fantasmas

- `--allow-unpinned`: removida a menção em `catalog.ts`. A flag nunca existiu no CLI.
- `--filter` e `--max-usd`: removidas as menções em `cost.ts`. Eram mencionadas nas mensagens de
  erro do guard antigo. O card pedia "implementar ou tirar a menção" — a menção foi tirada porque
  implementar `--filter` mexe em identidade (specHash), e implementar `--max-usd` é redundante com
  o fato de que o guard não recusa mais.

### Session tracking

O campo `sessionSpentUsd` existe no `BudgetReport` e `GuardInput`, mas chega como 0 de todos os
call sites. Implementar session tracking requer decidir o que define uma sessão (pid? data? arquivo
de marker?) e está fora do escopo deste card.

## Limitações conhecidas

- TypeScript colapsa a união discriminada quando ambos os membros são estruturalmente idênticos
  (ver seção acima). A proteção é social (code review) mais que mecânica (compilador).
- `sessionSpentUsd` é sempre 0 — session tracking não foi implementado.
- O `promptAboveUsd` threshold (US$ 5) permanece em `DEFAULT_THRESHOLDS` mas não gera aviso
  próprio — não há `WarningCode` correspondente. A informação de custo já está visível no resumo
  da estimativa.

## Destinatários nomeados

- **F0-08** (testes): a assinatura acima é o contrato. Testar que `checkBudget` devolve avisos para
  cada threshold excedido, que `requiresConfirmation` é sempre `true`, e que o relatório inclui
  `estimate`, `sessionSpentUsd`, `monthSpentUsd` e `balanceUsd`.
- **F1-06** (renderização no estúdio): o `BudgetReport` é o que o estúdio deve consultar antes de
  submeter. Os campos `sessionSpentUsd` e `monthSpentUsd` são os acumulados que a tela deve exibir
  junto com o pedido de confirmação.
