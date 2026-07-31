# Handoff: F0-12 — ADR 0018, o artefato de exportação

**Card:** F0-12 · **Onda:** W3 · **Data:** 2026-07-30

## Arquivos produzidos

| Arquivo | Propósito |
| --- | --- |
| `docs/adr/0018-artefato-de-exportacao.md` | ADR que formaliza o formato `project.json` v1 |
| `docs/README.md` | Linha 0018 adicionada à tabela de ADRs; contagem atualizada (22→23) |

## API pública (conceitos, não código)

A ADR 0018 formaliza 7 decisões de design do formato de projecto v1 (D1–D7):

| Decisão | Sumário |
| --- | --- |
| D1 | JSON, UTF-8, indentação de 2 espaços |
| D2 | `schemaVersion: 1` como descriminador de versão (inteiro, não string) |
| D3 | Geometria como dado no ficheiro (não como constante importada) |
| D4 | Atlas como caminhos relativos a sidecars `.pixellab.json` |
| D5 | Escrita atómica via ficheiro temporário + `rename` no mesmo filesystem |
| D6 | Campo `mapa` reservado como `Record<string, never>` para F2-02 |
| D7 | Validação de carga é mínima (`schemaVersion` apenas); o sistema de tipos é a verdade |

## Decisões de design

1. **A ADR cobre apenas o que foi implementado na F0-11.** Nenhum campo foi especulado. O `ProjectV1` de `packages/iso-core/src/project.ts` é a fonte única de verdade — a ADR descreve, não inventa.

2. **O que NÃO está decidido tem uma tabela de donos.** Mapa (F2-02), entidades, animações, descoberta do ficheiro — cada omissão tem um responsável explícito, com a razão escrita. Isto impede que uma task futura assuma que "não foi mencionado, logo posso decidir".

3. **Guarda executável é `cd packages/iso-core && npm test`.** Os 6 testes da F0-11 verificam o contrato: round-trip, rejeição de versão, atomicidade, geometria padrão. Se alguém violar o formato, os testes falham.

4. **D7 é a decisão mais controversa e a mais documentada.** A validação mínima (só `schemaVersion`) tem três camadas de justificação escritas. Não é preguiça — é uma escolha consciente com alternativas rejeitadas registadas.

5. **Status é "aceita", não "proposto".** A guarda executável existe e passa.

## Limitações conhecidas

- **O typecheck do `iso-core` não passa nesta worktree** por falta de `node_modules` (o `@types/node` não está instalado). O `npm test` passa porque `node --test` não precisa de declarações de tipo. Na worktree principal o typecheck também passa — foi verificado na F0-11.
- **A ADR referencia `Record<string, never>` como "objecto vazio".** O TypeScript 5.7 trata `Record<string, never>` de forma estrita; versões futuras podem relaxar essa semântica e exigir ajuste na ADR (não no código — o tipo está correto).

## O que as tasks descendentes precisam saber

- **F2-02 (mapa):** o campo `mapa` existe como `Record<string, never>` opcional. Para preenchê-lo, será necessário substituir esta definição no tipo `ProjectV1` e registar a decisão noutra ADR.
- **Qualquer card que crie o editor:** `loadProject`/`saveProject` são a porta de entrada e saída. O ficheiro de projecto é a raiz da árvore de estado do editor.
- **ADR futura que crie a v2 do formato:** deve declarar `**Substitui:** ADR 0018` e seguir o mecanismo de supersessão. A ADR 0018 não será editada.

## Verificação

```bash
bash scripts/check-docs.sh && test -f docs/adr/0018-artefato-de-exportacao.md
# 4 passes: convenções, endpoints, termos proibidos, links

grep -q "^\*\*Última atualização:\*\* 20" docs/adr/0018-artefato-de-exportacao.md  # ok
grep -q "0018" docs/README.md                                                       # ok
grep -q "Guarda executável" docs/adr/0018-artefato-de-exportacao.md                 # ok

cd packages/iso-core && npm test
# 6 pass, 0 fail
```
