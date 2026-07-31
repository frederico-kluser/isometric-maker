# F1-03 — Endpoint de 8 direções com mapa directions

**Onda:** W6 · **Worktree:** G-builder

## Arquivos produzidos / alterados

- `tools/character-builder/server/api.ts` — `generateBase` reescrita para usar
  `/create-character-with-8-directions` com guard, ledger, idempotência e prova de
  congelamento.
- `tools/character-builder/server/model.ts` — adicionado campo `isometric?: boolean` ao
  tipo `Character` (F0-09).

## API pública (alterações)

### `generateBase(character: Character): Promise<void>`

**Antes:** submetia `create-character-v3` direto, sem guard, sem ledger, sem validação
de dimensões da referência.

**Agora:**

1. **Idempotência:** se `cells[key].status === 'pronto'`, retorna imediatamente.
2. **Validação local:** a imagem de referência é validada via `validateImport` (F1-01)
   e suas dimensões são conferidas contra `character.size`. Imagem não quadrada ou com
   dimensões diferentes de `image_size` é rejeitada ANTES de qualquer chamada de rede.
3. **Cardeais via /rotate:** a south é a referência; north/east/west são obtidas via
   `rotateCardinals` (F1-02). O guard `estimateRotate` é executado antes; o ledger é
   escrito em `assets/ledger.ndjson`.
4. **Criação com 8 direções:** o mapa `directions` com as 4 cardeais é submetido ao
   endpoint `/create-character-with-8-directions` com `mode: 'standard'`. O guard
   `checkBudget` é executado antes; o ledger é atualizado.
5. **`character_id`:** persistido imediatamente após a submissão (o dinheiro já saiu).
6. **Prova de congelamento:** após o poll, `verifyFreezing` decodifica os pixels de
   cada cardeal devolvida (south/north/east/west) e compara com os pixels enviados.
   Usa decodificador PNG built-in (node:zlib) — sem dependência de sharp. Loga o
   resultado de cada direção como CONGELADA ou REPROCESSADA.
7. **Frames:** extraídos e salvos via `writeFrames` (inalterado).

### `Character.isometric?: boolean` (novo)

Campo opcional no modelo. Quando `true`, o parâmetro `isometric` é enviado ao /rotate
e ao /create-character-with-8-directions. Quando `false` ou `undefined`, é OMITIDO
do request — preserva specHash (F0-09).

### Funções auxiliares (privadas, em `api.ts`)

- `sanitize(s)` — substitui caracteres não alfanuméricos por `_`.
- `appendLedger(path, line)` — escreve uma linha ndjson no ledger.
- `logBudgetReport(label, report)` — loga o BudgetReport do guard no console.
  O guard informa e nunca recusa (F0-03).
- `decodePNGPixels(b64)` — decodificador PNG minimalista usando `node:zlib`.
  Suporta 8 bpc RGB (color type 2) e RGBA (color type 6), com desfiltro
  None/Sub/Up/Average/Paeth. Retorna `{ width, height, pixels }` ou null.
- `pixelsIdenticos(sentB64, returnedB64)` — compara duas imagens PNG.
  Primeiro tenta igualdade byte-a-byte; se falhar, decodifica pixels e compara.
  Retorna `true`/`false`/`null` (null = formato não suportado).
- `verifyFreezing(sent, response, imageSize)` — para cada cardinal
  (south/north/east/west), compara os pixels enviados com os devolvidos e loga
  o resultado.

## Decisões de design

### `isometric` é campo do Character, não do request de geração

F0-09 estabeleceu que `isometric` faz parte da identidade do asset — muda o specHash
e dispara regeneração. Faz sentido que pertença ao modelo do personagem (como `size`
e `seed`), não ao request de geração.

O campo é opcional com default `undefined` (OMITIDO do request). Com
`exactOptionalPropertyTypes: true`, o spread `...(ch.isometric !== undefined ? { isometric: ch.isometric } : {})` garante que `undefined` nunca chega ao `RotateInput`.

### Guard integrado de forma informativa

Seguindo F0-03: `checkBudget` e `estimateRotate` são chamados antes de cada
submissão, mas seus relatórios são apenas logados no console. O guard nunca
recusa — a decisão de prosseguir é humana.

### Ledger ndjson em `assets/ledger.ndjson`

Mesmo formato do `rotate.ts`: uma linha JSON por chamada de rede paga.
Inclui `at`, `endpoint`, `usd`, `generations`, `unit`. No caso do rotate,
inclui também `direction`.

### Prova de congelamento com decodificador PNG built-in

A função `decodePNGPixels` implementa um subconjunto do formato PNG suficiente
para comparar pixels de imagens 8 bpc RGB/RGBA. Não depende de sharp — evita
adicionar uma dependência nativa pesada ao character-builder.

Se a comparação byte-a-byte dos buffers base64 for igual, o congelamento é
confirmado sem decodificar pixels (atalho). Se diferir (possível recompressão),
os pixels são decodificados e comparados.

### `no_background` removido

O endpoint `/create-character-with-8-directions` não aceita o parâmetro
`no_background` — confirmado via spec. O campo foi removido do corpo da request.

### `charHeight` não foi adicionado ao modelo

F1-01 menciona que F1-03 deveria persistir `charHeight`, mas o escopo deste
cartão é a troca de endpoint e a integração do guard. `charHeight` não é
necessário para a geração base (a altura do personagem é a altura da imagem
de referência, que já é validada como quadrada e igual a `image_size`).

Se um cartão futuro precisar de `charHeight` (ex.: para posicionar o sprite
no chão), o campo pode ser adicionado ao modelo sem impacto neste código.

## Limitações conhecidas

- **Session tracking não implementado.** `spentThisSessionUsd` e `spentThisMonthUsd`
  chegam como 0 no `checkBudget`. Implementar session tracking requer decidir o
  que define uma sessão e está fora do escopo (herdado de F0-03).
- **Balance não é consultado.** `balanceUsd` chega como `undefined` no `checkBudget`
  porque a chamada a `client.balance()` não é feita antes de cada geração.
  A rota `GET /api/balance` existe e pode ser chamada pelo frontend.
- **Decodificador PNG não suporta todos os formatos.** Apenas 8 bpc RGB e RGBA.
  Paletas (color type 3), grayscale, e 16 bpc retornam null e a prova de
  congelamento reporta "verificação inconclusiva". Isso é seguro: um null não
  é tratado como "congelada" nem como "reprocessada".
- **O ledger do rotate e da criação são escritos no mesmo arquivo** sem lock.
  Como o Node é single-threaded e as operações são sequenciais (await), não há
  condição de corrida na prática.
- **A prova de congelamento assume que o `last_response` do job contém um**
  **dicionário keyeado por direção.** Se a API devolver as imagens em outro
  formato (ex.: array plano como o v3), `verifyFreezing` reporta "resposta
  não contém string base64 para esta direção" para cada cardinal — a geração
  não é abortada, mas a prova fica inconclusiva.

## Destinatários nomeados

- **F1-06 (estúdio):** a rota `POST /api/generate` com `poseId === '__base__'`
  agora dispara o novo fluxo. O frontend deve exibir o relatório do guard
  (logado no console do servidor) antes de confirmar. O campo `isometric` no
  modelo do personagem deve ser editável na UI.
- **Onda W7 (testes de idempotência):** `generateBase` agora verifica
  `cells[key].status === 'pronto'` antes de submeter. Um teste com
  `FakeClient` similar ao de rotate.ts pode verificar que a segunda chamada
  com os mesmos parâmetros não gera requisições.
