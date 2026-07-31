# Handoff: F0-11 — iso-core e o formato de projeto v1

**Card:** F0-11 · **Onda:** W2 · **Data:** 2026-07-30

## Arquivos produzidos

| Arquivo | Propósito |
| --- | --- |
| `packages/iso-core/package.json` | `@isometric-maker/iso-core`, private, type module, engines node >= 24, zero runtime deps |
| `packages/iso-core/tsconfig.json` | Mesmas opções estritas de `tools/pixellab-pipeline/tsconfig.json` |
| `packages/iso-core/src/project.ts` | Tipos do project v1, `criarProject`, `saveProject` (atómica), `loadProject` (rejeita schemaVersion != 1) |
| `packages/iso-core/src/project.test.ts` | 6 testes: round-trip, rejeição (sem schemaVersion, v0, v2), escrita atómica, geometria padrão |

## API pública

```ts
// types
export interface ProjectGeometry { tileWidth, tileHeight, zStep }
export interface ProjectV1 { schemaVersion: 1, nome, data, geometria, atlas, mapa? }
export type Project = ProjectV1;

// factory
export function criarProject(nome: string, atlas: readonly string[]): ProjectV1

// persistence
export function saveProject(project: ProjectV1, filePath: string): Promise<void>
export function loadProject(filePath: string): Promise<ProjectV1>
```

## Decisões de design

1. **Geometria como dado, não como constante importada.** O project JSON armazena `tileWidth`, `tileHeight`, `zStep` como números. A fábrica `criarProject` injeta os valores da ADR 0013 (64/32/16), mas o loader confia no que está no ficheiro — mudar a geometria depois de criado o projecto não é suportado (e nem deveria ser, porque invalida todas as coordenadas).

2. **`loadProject` valida APENAS o descriminador `schemaVersion`.** O schema completo pertence à ADR do formato (F0-12). Aqui implementa-se o mínimo que já serializa e rejeita versões desconhecidas. O type-assertion `parsed as ProjectV1` após o guard `schemaVersion === 1` é a mesma técnica usada em todo o código de `tools/pixellab-pipeline/src/` após `JSON.parse`.

3. **Escrita atómica no mesmo filesystem.** `saveProject` escreve para `.project-<uuid>.tmp` no mesmo directório que o destino e renomeia. No Linux, `rename(2)` no mesmo filesystem é atómico. Evitou-se o `tmpdir()` do SO porque `rename` entre filesystems diferentes não é atómico (cai em EXDEV).

4. **`mapa` é `Record<string, never>` opcional.** F2-02 é o dono deste campo; o `iso-core` apenas o declara para o formato ser serializável desde o dia 1. O tipo `Record<string, never>` significa "objeto vazio" — não se pode atribuir propriedades sem conversão explícita.

5. **Zero dependências runtime.** Apenas `devDependencies` para `typescript` e `@types/node`. O critério de aceitação verifica `dependencies`, não `devDependencies`.

6. **`as const` para constantes literais.** `SCHEMA_VERSION = 1 as const` produz o tipo literal `1`, não `number`. Isto permite que `parsed.schemaVersion !== SCHEMA_VERSION` funcione como type guard sem narrowing adicional.

## Limitações conhecidas

- **Não há validação de schema completo.** Um JSON com `schemaVersion: 1` e campos em falta ou com tipos errados é aceite e pode causar erros em runtime noutro ponto do sistema. A ADR F0-12 deve especificar o contrato completo e idealmente gerar um JSON Schema.
- **`mapa` é `Record<string, never>`** — o que significa que após F2-02 definir o formato real, este tipo terá de ser substituído. Não é possível fazer merge parcial; o campo será re-declarado.
- **A geometria carregada do ficheiro não é validada contra a ADR 0013.** Se alguém editar o JSON à mão e puser `tileWidth: 128`, o loader aceita. Isto é intencional: a geometria é um dado do projecto, não uma constante global. Mas o editor provavelmente deve avisar se os valores diferirem dos esperados.

## O que as tasks descendentes precisam saber

- **F0-12 (ADR do formato):** deve partir dos tipos em `src/project.ts` e formalizar o contrato. O `schemaVersion` como descriminador é o mecanismo de evolução.
- **F2-02 (mapa):** o campo `mapa` existe como `Record<string, never>` opcional. Para preenchê-lo, será necessário substituir esta definição.
- **Qualquer card que crie o editor:** o projecto é o artefato raiz do editor. `loadProject`/`saveProject` são a porta de entrada e saída.
- **O package `iso-core` está em `packages/`, não em `tools/`.** A fronteira é: `packages/` = bibliotecas reutilizáveis (runtime do editor), `tools/` = ferramentas de build-time (pipeline, character-builder). `iso-core` NUNCA importa de `tools/`.

## Verificação

```bash
cd packages/iso-core && npm run typecheck && npm test
# typecheck: 0 erros
# test: 6 pass, 0 fail

# Critérios:
! grep -rn "from '.*tools/" packages/iso-core/src/   # zero ocorrências
! grep -rn "pixi" packages/iso-core/src/               # zero ocorrências
node -e "console.log(Object.keys(require('./packages/iso-core/package.json').dependencies||{}).length)"  # 0
```
