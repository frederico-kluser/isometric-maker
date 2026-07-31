# F0-09 — Isometric e directions na identidade do asset

**Onda:** W3 · **Worktree:** G-pipeline

## Arquivos produzidos / alterados

- `tools/pixellab-pipeline/src/endpoints.ts` — adiciona `DIRECTION_KEYS`, `DirectionKey`,
  `QUADRUPED_TEMPLATES`, e comentário resolvendo `generate-8-rotations-v2` × v3.
- `tools/pixellab-pipeline/src/catalog.ts` — `character8dir` aceita `isometric` e `directions`;
  validação local de dimensions e south/east em `buildPlan`.

## API pública

### Novas exportações em endpoints.ts

```ts
export const DIRECTION_KEYS = [
  'south', 'south-east', 'east', 'north-east',
  'north', 'north-west', 'west', 'south-west',
] as const;
export type DirectionKey = (typeof DIRECTION_KEYS)[number];

export const QUADRUPED_TEMPLATES = ['bear', 'cat', 'dog', 'horse', 'lion'] as const;
```

### Nova assinatura de `character8dir`

```ts
export function character8dir(args: {
  id: AssetId; out: string; description: string; size: number; seed: number;
  budgetGroup?: string; inputs?: readonly string[];
  isometric?: boolean;
  directions?: Partial<Record<DirectionKey, string>>;
}): AssetSpec;
```

- `isometric` só entra em `params` quando truthy — omitido caso contrário. Preserva specHash
  dos assets existentes.
- `directions` é `Partial<Record<DirectionKey, string>>` — chaves das 8 direções permitidas,
  valores são paths locais. Os paths entram em `inputs` e participam do `specHash`.
  A codificação base64 para submissão é responsabilidade de `generate.ts` (futuro).

### Validação local em `buildPlan`

Quando `endpoint === 'create-character-with-8-directions'` e `params.directions` é um objeto:

1. **Chaves inválidas** → validationError listando as permitidas.
2. **Dimensões** → cada imagem é lida com sharp; se `width !== image_size.width` ou
   `height !== image_size.height`, validationError.
3. **Imagem ilegível** → validationError.
4. **South ausente em bípede** → validationError. Template padrão (`mannequin`) é bípede.
5. **South ou east ausentes em quadrúpede** → validationError. Quadrúpedes são
   `bear`, `cat`, `dog`, `horse`, `lion` — lista extraída do spec.

Todas as validações rodam ANTES do `computeSpecHash` — nenhuma submissão acontece com erro de
validação.

## Decisões de design

### `isometric`: OMITIDO, não emitido como false

O spec declara `default: false`. Emitir explicitamente `isometric: false` mudaria o `specHash`
de todos os assets existentes no catálogo, forçando regeneração paga de 6 assets sem necessidade.
Omitir preserva o comportamento atual: a API recebe o campo ausente e aplica o default `false`.

Quando o catálogo quiser isométrico, passa `isometric: true` explicitamente. O campo entra em
`params` e portanto no `specHash` — virar esse booleano depois de gerar custa dinheiro, como
a ADR 0015 antecipa.

### `directions` em params: paths, não base64

Os valores do mapa `directions` em `params` são **caminhos de arquivo**, não strings base64.
A conversão para base64 é responsabilidade do `generate.ts` no momento da submissão — não deste
card. O `specHash` cobre a identidade via duas vias: o path entra em `params` (mapeamento
direção→arquivo) e o conteúdo decodificado do pixel entra via `inputs` (hash do arquivo).

Isso significa que trocar qual arquivo serve qual direção, ou editar o arquivo, ambos mudam o
`specHash` e disparam regeneração — que é exatamente o contrato de idempotência.

### `generate-8-rotations-v2` × v3: modelamos só v3

Ambos os paths existem no spec (`/generate-8-rotations-v2` e `/generate-8-rotations-v3`).
v2 tem `method` enum (rotate_character | create_with_style | create_from_concept) e pode
criar personagens do zero; v3 é estritamente um rotator (só `first_frame`). Usamos v3.

Adicionar v2 a `ENDPOINT_IDS` exigiria entrada em `COST_TABLE` (cost.ts), que está fora do
escopo (F0-03 já mergeado). O comentário em `ENDPOINT_IDS` documenta a existência de v2,
seu range de tamanho (32–168), e o fato de que `DIRECTIONS_8` codifica a ordem de retorno
documentada de v2.

### Validação de dimensões usa sharp

A validação lê `metadata()` via sharp — mesma biblioteca já usada por `inputHash` para
decodificar pixels. Não é uma dependência nova. A leitura é só de metadados (barata), não
decodifica a imagem inteira. Em caso de erro de leitura (arquivo ausente, formato inválido),
o erro é coletado como `validationError` e não interrompe o plano — consistente com o
comportamento de `validateSize`.

### `directionCount` não mudou

Para o mapa `directions` (objeto), `Array.isArray` retorna false e cai no default:
`billsPerDirection ? 8 : 1`. Para `create-character-with-8-directions`, `billsPerDirection`
não existe → retorna 1. Correto: `mode='standard'` custa 1 geração independentemente de
quantas direções têm referência.

## Limitações conhecidas

- **Base64 encoding não implementado.** `generate.ts` ainda não converte os paths de
  `params.directions` em base64 para submissão. Até lá, assets com `directions` vão falhar
  na submissão com 422. A validação local (dimensões, south) já funciona e impede o gasto
  com request inválido.
- **`directions` não é validado para `animate-character`.** O campo `directions` no endpoint
  de animação é um array de strings (nomes de direção), não um mapa de imagens. A validação
  deste card cobre apenas o mapa do endpoint de criação.
- **A validação de dimensões só dispara se `image_size` estiver presente.** Se `size` for
  undefined (não deve acontecer para `create-character-with-8-directions`, onde `image_size`
  é required), a verificação de dimensões é pulada silenciosamente.

## Destinatários nomeados

- **F0-08 (testes):** `DIRECTION_KEYS`, `DirectionKey`, `QUADRUPED_TEMPLATES` são exportados
  e testáveis. `validateSize` ganhou companhia — a validação de directions acontece em
  `buildPlan` e produz `validationErrors` no `RunPlan`. Testar com um spec que tenha
  `directions` com chave inválida, dimensão errada, e south ausente.
- **Tarefa futura de submissão:** `generate.ts` precisa ler `params.directions`, converter
  cada path em base64 (usando sharp para re-encoded PNG consistente), e montar o corpo da
  request com o mapa `directions` preenchido.
- **F1-06 (estúdio):** `isometric` e `directions` agora fazem parte da identidade do asset.
  O estúdio que construir specs de personagem deve usar `character8dir` com esses campos.

## Resolução das questões abertas

- **v2 × v3:** modelamos só v3; v2 documentado em comentário. (Ver "Decisões de design".)
- **`isometric` omitido ou false:** OMITIDO. Preserva specHash dos assets existentes.
  (Ver "Decisões de design".)
