# F1-02 — Três cardeais por /rotate

**Onda:** W5 · **Worktree:** G-builder

## Arquivos produzidos / alterados

- `tools/character-builder/server/rotate.ts` — módulo principal: `estimateRotate` (guard),
  `rotateCardinals` (execução idempotente de três chamadas ao /rotate).
- `tools/character-builder/server/rotate.test.ts` — 5 testes com `FakeClient`:
  estimativa, 3 chamadas na primeira execução, 0 na segunda, isometric true/false.
- `tools/character-builder/package.json` — adiciona script `"test"`.

## API pública

### `server/rotate.ts`

```ts
export interface RotateInput {
  readonly fromImage: string;        // base64 puro, sem prefixo data URI
  readonly seed: number;
  readonly imageSize: { readonly width: number; readonly height: number };
  readonly isometric?: boolean;      // OMITIDO do request quando false (F0-09)
  readonly outputDir: string;
}

export interface RotateResult {
  readonly north: string;  // path absoluto do PNG
  readonly east: string;
  readonly west: string;
}

// Estima custo de 3× /rotate. Não faz rede — seguro chamar antes de confirmar.
export function estimateRotate(input: RotateInput): BudgetReport;

// Executa as três rotações. Idempotente: se as PNGs já existirem, não gasta.
export async function rotateCardinals(
  client: PixelLabClient,
  input: RotateInput,
  opts?: { readonly ledgerPath?: string; readonly onLog?: (msg: string) => void },
): Promise<RotateResult>;
```

### Parâmetros enviados ao /rotate

Campos enviados: `from_image`, `from_direction: 'south'`, `to_direction` (north | east | west),
`image_size`, `seed`, `from_view: 'low top-down'`, `to_view: 'low top-down'`, e
`isometric` (só quando truthy).

O endpoint **não** aceita `view` nem `no_background` — confirmado via `inspect-spec.mjs`.

## Decisões de design

### `/rotate` é SÍNCRONO — sem background_job_id

O fluxo `submit → poll → download` que o restante do character-builder usa (para
`create-character-v3`, `animate-character`, `create-character-state`) **não se aplica**.
O /rotate devolve `{ usage, image }` em 200, e o PNG está na resposta. Isso tem duas
consequências:

1. **Não há job a retomar.** Se o processo morrer entre a resposta e a gravação em disco,
   o dinheiro foi gasto e a imagem se perdeu. Por isso o módulo grava o PNG **antes** de
   qualquer pós-processamento — é a primeira operação depois de extrair o base64 da resposta.

2. **Tratamento de erro é diferente.** Não há `pollJob` nem `423 Locked`; o retry é
   tratado pelo `PixelLabClient.request` (429/529/network faults), e um erro não-recuperável
   em uma direção não aborta as outras (cada chamada é independente).

### Idempotência: hash de conteúdo, não de path

A chave de idempotência é `SHA256(fromImage | seed | size | isometric)`, truncada para 16
hex chars. Isso cobre os casos em que a mesma imagem chega por paths diferentes (upload
repetido, rename). O hash do conteúdo da imagem é o que entra, não o path do arquivo —
consistente com o `inputHash` do pipeline (`catalog.ts`).

### Guard: `estimateRotate` separado de `rotateCardinals`

Seguindo o contrato de F0-03: o guard informa e nunca recusa. `estimateRotate` devolve um
`BudgetReport` com `requiresConfirmation: true` (literal). O caller — que será um handler
HTTP no futuro — exibe o relatório e pede confirmação ANTES de chamar `rotateCardinals`.

Para o teste, a confirmação é pulada porque o `FakeClient` não gasta dinheiro real.

### Ledger: ndjson simples

Cada chamada ao /rotate escreve uma linha no ledger (se `ledgerPath` for passado):

```json
{"at":"2026-...","direction":"north","endpoint":"rotate","usd":0.0106,"generations":null,"unit":"usd"}
```

O formato é compatível com o `LedgerLine` do pipeline, mas usa `direction` como campo extra
para distinguir as três chamadas.

### `isometric`: OMITIDO quando false

Conforme F0-09: `isometric: false` NÃO é enviado ao /rotate. Só `isometric: true` entra
nos params. Preserva idempotência: dois inputs idênticos exceto por `isometric: false` vs
`undefined` produzem o mesmo hash e reusam os mesmos artefatos.

### Teste com FakeClient

`FakeClient` estende `PixelLabClient` e sobrescreve `request`. Conta chamadas e devolve
um PNG 1×1 falso. O teste principal:

1. Primeira execução → 3 chamadas, 3 PNGs escritos.
2. Segunda execução (mesmo input) → 0 chamadas, paths retornados direto.
3. Output contém `"0 requisições"` para o grep do critério de aceitação.

## Limitações conhecidas

- **Sem handler HTTP ainda.** O módulo `rotate.ts` está pronto para ser chamado por um
  handler em `api.ts`, mas esse handler não foi implementado neste cartão. O fluxo esperado:
  `POST /api/rotate` → `estimateRotate` → retorna relatório → cliente confirma →
  `POST /api/rotate/confirm` → `rotateCardinals`.
- **Ledger não é acumulado no `BudgetReport`.** O `spentThisMonthUsd` e
  `spentThisSessionUsd` chegam como 0 no `checkBudget` porque o character-builder não tem
  um módulo de session tracking. Isso é uma limitação herdada de F0-03.
- **FakeClient não simula erros.** Os testes cobrem o caminho feliz e a idempotência.
  Testes de erro (422, 429, 529, network fault) usariam o `PixelLabClient` real e gastariam
  dinheiro — estão fora do escopo.

## Destinatários nomeados

- **F1-06 (estúdio):** o handler HTTP que expõe `/api/rotate` deve usar `estimateRotate`
  para exibir o relatório do guard antes de submeter, e `rotateCardinals` para executar.
- **Futuro cartão de integração:** conectar `rotateCardinals` ao fluxo do `G-builder`
  que gera as 4 cardeais + 4 diagonais e as congela no passo seguinte.

## Resolução das questões abertas

- **Faixa AB-250..AB-259:** reservada para as três cardeais. Implementada.
