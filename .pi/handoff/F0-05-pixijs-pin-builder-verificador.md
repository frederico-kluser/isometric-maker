# Handoff: F0-05 — PixiJS 8.19.0 no builder com verificador de pino

**Card:** F0-05 · **Onda:** W2 · **Data:** 2026-07-30

## Arquivos produzidos

| Arquivo | Propósito |
|---|---|
| `scripts/check-pixi-pin.mjs` | Verificador de pino: lê três fontes e falha se qualquer par divergir |
| `tools/character-builder/package.json` | Adicionada dependência exata `"pixi.js": "8.19.0"` |
| `tools/character-builder/package-lock.json` | Gerado por `npm install` |
| `scripts/gate.sh` | Nova etapa `check-pixi-pin` (header "PixiJS pin") |

## API pública

### `node scripts/check-pixi-pin.mjs`

Lê três fontes e compara todas entre si (3 pares: AB, AC, BC):
- **(A)** `tools/pixi-reference/package.json` → `dependencies["pixi.js"]`
- **(B)** `tools/pixi-reference/vendor/manifest.json` → `pixiVersion`
- **(C)** `tools/character-builder/package.json` → `dependencies["pixi.js"]`

**Exit 0:** os três valores batem e são versão exata (`X.Y.Z` sem prefixo).
**Exit 1:** qualquer divergência ou versão não-exata (caret, tilde, range).

O verificador rejeita qualquer formato que não seja `\d+\.\d+\.\d+` — isso cobre caret,
tilde, `>=`, `*`, e ranges compostos.

## Decisões de design

1. **Nenhuma fonte é autoridade sobre as outras.** O verificador compara todos os pares
   (AB, AC, BC), não elege uma fonte canônica e verifica as outras contra ela. Isso
   captura o caso em que duas divergem da terceira sem saber qual está certa.

2. **Versão não-exata é erro de parsing, não divergência.** Se qualquer fonte contém
   `^8.19.0` ou `~8.19.0`, o script falha com "versão não é exata" antes de comparar.
   Isso evita que um caret no builder passe batido por coincidir com a versão do vendor.

3. **`dependencies`, não `devDependencies`.** O builder vai importar `pixi.js` em código
   de produção (renderer do editor), não só em build.

4. **Nenhum import de `pixi.js` foi adicionado.** O card proíbe: "PROIBIDO importar
   pixi.js em qualquer arquivo ainda". A dependência está declarada e instalada, mas
   nenhum arquivo `.ts` a referencia.

## Limitações conhecidas

- O verificador compara strings, não semver. `8.19.0` e `v8.19.0` divergiriam, mas
  nenhum dos três lugares usa prefixo `v`.
- Se um package.json não tiver o campo `dependencies` (ausente, não vazio), o script
  falha com "chave não encontrada". Isso é intencional: dependência ausente é erro.

## O que as tasks descendentes precisam saber

- **Qualquer card que adicione imports de pixi.js no builder:** a dependência já está
  instalada e o pin está travado. Não use `npm install pixi.js` — edite o que for
  necessário e o pin permanece.
- **Qualquer card que mude a versão do PixiJS:** precisa atualizar os três lugares
  (pixi-reference/package.json, vendor/manifest.json via regen, builder/package.json)
  e o verificador acusará qualquer inconsistência.
- **Gate.sh:** a etapa `check-pixi-pin` roda como `stage` (FALHA se divergir), não como
  `nao_exercitado_stage`.

## Verificação

```
$ node scripts/check-pixi-pin.mjs
ok pixi.js 8.19.0 bate nos três lugares

$ node tools/pixi-reference/scripts/vendor-types.mjs --check
ok vendor íntegro · pixi.js 8.19.0 · 66 arquivo(s)

$ cd tools/character-builder && npm ls pixi.js
@isometric-maker/character-builder@0.1.0
└── pixi.js@8.19.0

$ bash scripts/gate.sh | grep check-pixi-pin
  check-pixi-pin                                     PASS
```
