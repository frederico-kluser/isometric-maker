# F1-01 — Importar arte-base e altura com validação local

**Onda:** W5 · **Worktree:** G-builder

## Arquivos produzidos / alterados

- `tools/character-builder/src/import.ts` — novo módulo de validação local de PNG
- `tools/character-builder/src/import.test.ts` — 14 testes, incluindo o caso 65×64 (ausência de quadrado)
- `tools/character-builder/src/strings.ts` — 5 novas strings de erro em `S.erro`
- `tools/character-builder/package.json` — adicionado script `test`

## API pública

### `validateImport(buffer: ArrayBuffer, charHeight: number): ImportResult`

Valida um PNG de arte-base (virado para o sul) contra as restrições locais:

```ts
export type ImportResult =
  | { readonly ok: true; readonly width: number; readonly height: number; readonly charHeight: number }
  | { readonly ok: false; readonly error: string };
```

Regras de validação, na ordem:
1. Arquivo precisa ser PNG (8 bytes de assinatura + chunk IHDR legível)
2. Nenhum lado pode passar de 256 px
3. A imagem precisa ser quadrada (largura = altura) — **o caso de ausência**
4. Os lados precisam estar na faixa 16–128 px — validado via `validateSize('create-character-with-4-directions', ...)` do pipeline
5. `charHeight` não pode exceder a altura da imagem

NENHUMA chamada de rede. NENHUM `fetch()`.

### Novas strings em `S.erro`

| Chave | Mensagem |
|---|---|
| `formatoInvalido` | `formato de arquivo inválido — só aceito PNG` |
| `ladoAcimaDe256` | `imagem muito grande — máximo 256×256 pixels` |
| `ladoForaDaFaixa` | `dimensão fora da faixa permitida (16–128 pixels)` |
| `alturaMaiorQueImagem` | `altura informada é maior que a altura da imagem` |
| `imagemNaoQuadrada` | `a imagem de referência precisa ser quadrada (largura = altura)` |

### Script `test`

```bash
npm test   # roda strings.test.ts && import.test.ts
```

## Decisões de design

### Reutilização de `validateSize`, não reimplementação

O módulo importa `validateSize` de `../../pixellab-pipeline/src/endpoints.ts` e valida contra
`create-character-with-4-directions` (min 16, max 128). As mensagens de erro do usuário vêm de
`strings.ts`, não da saída de `validateSize` — esta é usada apenas como detector booleano de
violação de constraints.

### Leitura de dimensões via parsing binário do IHDR

As dimensões são lidas diretamente do chunk IHDR do PNG (bytes 16-23 do arquivo), sem
dependência de sharp, canvas ou Image(). Isso funciona em Node e browser sem polyfills.
A assinatura PNG (8 bytes) é conferida antes, e o chunk type é verificado como 'IHDR'.

### Imagem quadrada é exigida

A validação `width !== height` rejeita imagens não quadradas. Isso cobre o caso "65×64"
exigido pelo cartão e é justificado pelo fato de que os endpoints de criação de personagem
(`create-character-v3`, `create-character-with-4-directions`, etc.) recebem `image_size`
como quadrado. Uma referência não quadrada seria redimensionada pela API com resultados
imprevisíveis — melhor recusar localmente.

### `charHeight` é retornado, não armazenado

A altura em pixels é validada e devolvida no `ImportOk`. O armazenamento efetivo no modelo
do personagem (`Character`) é responsabilidade de F1-03, que pode tocar em `server/api.ts`.
Este módulo é só o validador de entrada.

### Testes com PNGs sintéticos

Os testes geram PNGs válidos em memória com `node:zlib.deflateSync` + CRC32 manual. Nenhum
arquivo `.png` é versionado. Isso cobre todas as 5 regras de rejeição + 4 caminhos felizes,
incluindo bordas (16×16, 128×128, altura zero).

## Limitações conhecidas

- **Apenas RGB 8bpc é suportado para leitura de IHDR.** PNGs com color type diferente de 2
  (ex.: RGBA, grayscale) ainda têm IHDR lido corretamente porque a estrutura é a mesma, mas
  a validação não distingue — qualquer PNG com dimensões válidas passa.
- **`charHeight` não tem limite inferior explícito.** Zero é aceito (personagem "no chão").
  Valores negativos passariam na checagem `charHeight > height` (pois seriam falsy para a
  comparação), mas não há validação de `charHeight < 0`.
- **O módulo ainda não é integrado a `main.ts` nem a `server/api.ts`.** A tarefa F1-03 fará
  essa integração. Até lá, `validateImport` está disponível mas não é chamado em produção.

## Destinatários nomeados

- **F1-03** (integração no servidor): `validateImport` está pronto para ser chamado antes
  de qualquer submissão. O `ImportOk` devolve `width`, `height` e `charHeight` — o servidor
  deve persistir `charHeight` no modelo do personagem.
- **Qualquer card que edite `main.ts`**: para usar a validação antes do upload de referência,
  chame `validateImport` com o `ArrayBuffer` do arquivo e a altura informada pelo usuário.
