# Handoff: F0-04 — Higiene de dependências e codegen

**Card:** F0-04 · **Onda:** W2 · **Data:** 2026-07-30

## Arquivos produzidos

| Arquivo | Propósito |
| --- | --- |
| `tools/pixellab-pipeline/scripts/refresh-openapi.mjs` | Baixa o spec vivo, recalcula sha256, regrava PROVENIENCIA.txt |

## Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `tools/pixellab-pipeline/package.json` | Remove `zod` (dependencies), `codegen` (scripts), `openapi-typescript` (devDependencies) |

## Decisões de design

### 1. zod → REMOVIDO

`zod` era listado como dependência mas nenhum arquivo em `src/**` o importava. Zero ocorrências
de `zod` em qualquer `.ts` do pipeline. Removido de `dependencies`. A remoção está registrada
na mensagem de commit.

### 2. codegen / schema.d.ts → REMOVIDO

O script `codegen` invocava `openapi-typescript` para gerar `openapi/schema.d.ts`, mas:
- O arquivo `schema.d.ts` não existia em disco (nunca foi commitado).
- Nenhum arquivo do projeto importa `schema.d.ts`.
- A skill `querying-pixellab-api` explicitamente documenta que a promessa de "schema drift vira
  erro de compilação" do ADR 0002 não se sustenta porque nada importa o arquivo gerado.

Removido o script `codegen` e a devDependency `openapi-typescript` (órfã sem o script).

### 3. refresh-openapi → CRIADO

`scripts/refresh-openapi.mjs`:
- Baixa de `https://api.pixellab.ai/v2/openapi.json`
- Grava `openapi/openapi-v2.json`
- Extrai metadados do spec (openapi version, info.version, contagem de paths/POST/schemas)
- Calcula sha256
- Regrava `PROVENIENCIA.txt` no formato que `openapiFingerprint()` em `cli.ts` já parseia
  (regex `/^[0-9a-f]{64}$/m` para sha256, `/\d{4}-\d{2}-\d{2}/` para data)

O script NÃO foi executado neste card (proibido pela restrição). Ele existe e é invocável
via `npm run refresh-openapi`, mas só deve ser rodado manualmente.

## API pública

Nenhuma alteração na API do pipeline. O `openapiFingerprint()` em `cli.ts` continua parseando
o mesmo formato de `PROVENIENCIA.txt`.

## Limitações conhecidas

- O script `refresh-openapi.mjs` não foi testado com um download real (proibido pela restrição).
  Testá-lo gasta banda mas não dinheiro — a primeira execução real validará o caminho.
- `npm run doctor` reporta 1 ERRO (PIXELLAB_SECRET não definido) — é ambiental, pré-existente,
  e fora do escopo deste card.

## O que as tasks descendentes precisam saber

- `package.json` agora tem 1 dependência (`sharp`) e 2 devDependencies (`@types/node`, `typescript`).
- O script `refresh-openapi` existe e é o procedimento canônico para atualizar o spec. A skill
  `querying-pixellab-api` documenta o fluxo completo.
- Nenhum `import` de `zod` ou `openapi-typescript` sobreviveu — tasks que precisarem de
  validação de schema devem usar o spec vendorizado via `inspect-spec.mjs`, não gerar types.
