# F0-10 — Âncora medida a partir dos pixels

**Onda:** W3 · **Worktree:** G-pipeline

## Arquivos produzidos / alterados

- `tools/pixellab-pipeline/src/atlas.ts` — `measureAnchor()`, `Sidecar.anchorSource`, `Sidecar.anchorCanvas`, lógica de medição em `packGrid`
- `tools/pixellab-pipeline/src/atlas.test.ts` — 7 novos testes cobrindo medição, fallback, tiles e transparência

## API pública

### `measureAnchor(frames: readonly FrameInput[]): Promise<{ anchor: {x,y}; canvasW; canvasH } | null>`

Recebe os frames de uma família, localiza o frame de repouso (direção `S`, índice `00`), lê a caixa delimitadora opaca via `sharp.raw()`, e devolve a âncora como fração do canvas:

- `anchor.x` = centro horizontal da caixa / largura do canvas
- `anchor.y` = base da caixa (`maxY + 1`) / altura do canvas
- `canvasW`, `canvasH` = dimensões reais observadas do frame (para o sidecar)

Devolve `null` quando não há frame `S_00` ou o frame é 100% transparente.

### `Sidecar` estendido

```ts
export interface Sidecar {
  // ... existentes mantidos
  readonly anchorSource: 'medida' | 'padrao';
  readonly anchorCanvas?: { w: number; h: number }; // só quando 'medida'
}
```

### `packGrid` — nova precedência de âncora

1. `opts.anchor` explícito (caller, ex.: tiles passam `{0,0}`) → usado como está, `anchorSource: 'padrao'`
2. Senão, tenta `measureAnchor(frames)`:
   - Sucesso → âncora medida, `anchorSource: 'medida'`, canvas registrado
   - Falha → fallback `{x:0.5, y:0.875}`, `anchorSource: 'padrao'`, `console.warn`

## Decisões de design

### Frame de repouso = `S_00`, não `idle`

O frame de repouso é identificado por direção `S` (south) + índice `00` (primeiro frame), independentemente da ação. Isso cobre famílias que não têm idle (ex.: só walk), e famílias onde idle não é o primeiro frame listado. O `S_00` é a pose "em pé virado para sul" — é o que interessa para a âncora dos pés.

### Regex para parsing: `_(S|SW|W|NW|N|NE|E|SE)_(\d{2})$`

Usa o padrão exato do `frameName()` (direções curtas, índice zero-padded a 2 dígitos). Não usa `DIRECTIONS_8` porque `shortDir` mapeia nomes longos para curtos — a regex opera sobre o nome já curto.

### `opts.anchor` vence a medição

Tiles chamam `packGrid` com `{anchor: {x:0, y:0}}`. Se a medição tivesse precedência sobre `opts.anchor`, um tile com direção sul acidental teria a âncora errada. O contrato é: caller explícito sempre ganha.

### Canvas real registrado, não o `image_size` do request

O sidecar grava `anchorCanvas: {w, h}` com as dimensões reais do frame de repouso (ex.: ~90×90 para um request de 64×64 com `canvasInflation: 1.4`). Isso permite que o cliente confira se a âncora medida é consistente com o canvas esperado, sem depender do parâmetro original da API.

### Aviso, não erro

Frame 100% transparente ou sem `S_00` produz `console.warn` + fallback, não exceção. Um atlas parcialmente gerado (ex.: só direções norte e leste) ainda deve empacotar — a âncora será menos precisa, mas o atlas é usável.

## Limitações conhecidas

- **A medição é por família, não por frame.** O `ultrathink` do cartão está correto: medir frame a frame faria o sprite "pular" entre poses. A âncora do frame de repouso é propagada para todos os frames da família.
- **O pixel opaco "mais baixo" é a base, não o centróide.** Um personagem com cauda longa tocando o chão teria `minY` na cauda, mas `maxY` nos pés — o que importa para a âncora é o `maxY` (base), e o `minX`/`maxX` definem o centro. Isso é correto: a cauda está à esquerda, os pés estão embaixo.
- **`sharp.raw()` lê o PNG decodificado.** Não há reamostragem. O frame é lido como está no disco, sem `resize`, sem `extract`.

## Tamanho de canvas real para `image_size: 64×64`

Não medido neste card — depende de geração real contra a API. A estimativa do ADR é ~90 px (64 × 1.4 = 89.6), mas a `canvasInflation: 1.4` no spec é um aviso, não uma fórmula exata. A medição real só acontece quando `measureAnchor` processa um PNG gerado pela API com `image_size: 64`.

## Destinatários nomeados

- **F0-08** (testes de custo): a assinatura do `Sidecar` mudou; `anchorSource` e `anchorCanvas` são campos novos que o serializador do sidecar já emite.
- **F1-06** (renderização): o cliente deve ler `sidecar.anchor`, não assumir `{0.5, 0.875}`. O campo `anchorSource: 'medida'` é o sinal de que a âncora é confiável; `'padrao'` é o sinal de que o atlas foi gerado sem frame de repouso e a âncora é aproximada.
- **F0-09** (catálogo): `catalog.ts` e `endpoints.ts` não foram tocados (restrição do cartão).
