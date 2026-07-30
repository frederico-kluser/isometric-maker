# ADR 0002 — Cliente REST do OpenAPI vendorizado, não o SDK oficial

> **Quick Start (TL;DR)**
>
> O SDK `@pixellab-code/pixellab@1.0.2` tem `api.pixellab.ai/v1` **hardcoded** e expõe 8 operações. A API v2 tem 56 endpoints POST. Falamos REST direto contra o spec vendorizado.

**Status:** aceita · **Data:** 2026-07-29

## Contexto

Inspeção do pacote publicado (`npm pack @pixellab-code/pixellab@1.0.2`, feita em 2026-07-29):

| | SDK oficial de JS | Cliente do OpenAPI v2 |
|---|---|---|
| Base URL | `api.pixellab.ai/v1`, hardcoded no bundle | `api.pixellab.ai/v2` |
| Operações expostas | **8** (`generateImagePixflux`, `generateImageBitforge`, `rotate`, `inpaint`, `animateWithSkeleton`, `animateWithText`, `estimateSkeleton`, `getBalance`) | **56 POST** + 23 GET/DELETE/PATCH |
| Último release | **2025-06-15** (só 2 versões publicadas) | spec ao vivo |
| Jobs em background | ausente | necessário para 23 endpoints |

O SDK não alcança nada de que precisamos: personagem em 8 direções, tilesets, `create-character-state`, `map-objects`, os modelos v3.

## Decisão

Chamar a REST v2 diretamente sobre o `fetch` nativo do Node 24. O spec (`openapi 3.1.0`, 79 paths, 235 schemas, 387 KB) é **vendorizado** em `/home/ondokai/Projects/ferro-e-cinzas/tools/pixellab-pipeline/openapi/openapi-v2.json`, com data de captura e sha256 em `PROVENIENCIA.txt`.

## Consequências

- Cobertura total por construção.
- Controle do transporte, que é onde mora o dinheiro: retry, `Retry-After`, os códigos 429/**529**/423/410, e a captura da resposta crua para o lockfile.
- O snapshot vendorizado **é** o detector de drift: o `info.version` do spec é literalmente `"dev"`, ou seja, eles publicam mudança sem versionar. Atualizar o snapshot transforma quebra de contrato em erro de compilação em vez de bug em produção.
- **Custo:** reimplementamos o pouco que o SDK dava. Mantê-lo em `devDependencies` como oráculo de comparação é opcional.

## Referências

- `openapi/PROVENIENCIA.txt` — data e hash do snapshot
- [`https://api.pixellab.ai/v2/llms.txt`](https://api.pixellab.ai/v2/llms.txt)

**Última atualização:** 2026-07-29
