# Handoff: F2-02 — Modelo do mapa XYZ

**Card:** F2-02 · **Onda:** W6 · **Data:** 2026-07-30

## Arquivos produzidos

| Arquivo | Propósito |
| --- | --- |
| `packages/iso-core/src/map.ts` | Tipos do modelo de mapa (`BlockStore`, `EdgeStore`, `MapObject`, `MapData`, RLE) |
| `packages/iso-core/src/map.test.ts` | 44 testes (BlockStore, EdgeStore, validateMapObject) |
| `packages/iso-core/src/project.ts` | Campo `mapa` substituído de `Record<string, never>` para `MapData`; validação multi-célula em `loadProject` |
| `packages/iso-core/src/project.test.ts` | +5 testes de integração (retrocompatibilidade, mapa válido, rejeição multi-célula) |
| `packages/iso-core/package.json` | Script `typecheck` estendido com confirmação de validação |

## API pública

```ts
// map.ts

// Tipos
export type EdgeSide = 'N' | 'L' | 'S' | 'O';  // Norte, Leste, Sul, Oeste
export const EDGE_SIDES: readonly EdgeSide[];

export interface BlockRleRun { readonly block: string; readonly count: number; }
export interface MapObject { readonly tipo: string; readonly x: number; readonly y: number; readonly z: number; }
export interface EdgeEntry { readonly x: number; readonly y: number; readonly z: number; readonly lado: EdgeSide; readonly tipo: string; }
export interface MapData {
  readonly blocks: Record<string, readonly BlockRleRun[]>;   // "x:y" → RLE runs
  readonly edges: readonly EdgeEntry[];
  readonly objects?: readonly MapObject[];
}

// BlockStore — arranjo denso em memória
export class BlockStore {
  getBlock(x, y, z): string | undefined
  setBlock(x, y, z, blockType): void
  removeBlock(x, y, z): void
  heightAt(x, y): number                    // DERIVADA: maxZ + 1
  forEach(fn): void
  toRle(): Record<string, readonly BlockRleRun[]>
  static fromRle(rle): BlockStore
  static encodeRle(column): BlockRleRun[]
  static decodeRle(runs): string[]
}

// EdgeStore — esparso em memória
export class EdgeStore {
  getEdge(x, y, z, lado): string | undefined
  setEdge(x, y, z, lado, tipo): void
  removeEdge(x, y, z, lado): void
  forEach(fn): void
  toEntries(): EdgeEntry[]
  static fromEntries(entries): EdgeStore
}

// Validação
export function validateMapObject(obj): obj is MapObject
export const MULTI_CELL_ERROR: string
```

## Decisões de design

### 1. Blocos: denso em memória, RLE na serialização

Cada coluna `(x, y)` é um array indexado por `z` (`string[]`). O array é denso
do nível 0 até ao topo ocupado — não há buracos (blocos são empilhados).
O invariante `trimTop` garante que não há ar (string vazia) no fim da coluna.

Na serialização, o array é comprimido com RLE: runs consecutivos do mesmo tipo
são colapsados em `{ block, count }`. Colunas vazias são omitidas do registo.

**Justificação:** o array denso dá O(1) para `getBlock(x,y,z)` — indexação
directa — e a RLE evita armazenar centenas de entradas iguais no JSON quando
uma coluna tem 50 níveis de "grass".

### 2. Arestas: esparso, `Map<"x:y:z:lado", tipo>`

Paredes são raras (ordens de magnitude menos frequentes que blocos), por isso
usamos um mapa plano em vez de uma estrutura densa. Na serialização é um array
de `EdgeEntry`.

**Justificação:** a ADR 0013 estabelece que parede é de aresta e bloco é de
célula. Modelar parede como bloco está PROIBIDO — o depth-sorting depende
desta distinção (arestas ficam a meia-célula).

### 3. `heightAt(x, y)` é DERIVADA, nunca persistida

A altura de uma coluna é `col.length` — o primeiro nível de z vazio. Não há
campo `heightMap`, `mapaDeAltura` ou `heights` em lado nenhum do formato
serializado.

**Justificação:** guardar mapa de altura *e* mapa de blocos é criar duas
verdades sobre o mesmo terreno. A ADR 0013 estabelece que a altura é derivada.

### 4. Proibição de sprite multi-célula

Cada `MapObject` declara exactamente uma célula `(x, y, z)`. O tipo TypeScript
não admite campos como `cells`, `width`, `height`, `area`, `size` (que
indicariam ocupação de mais do que uma célula). A validação `validateMapObject`
rejeita objectos com estes campos. `loadProject` aplica esta validação a todos
os objectos do mapa.

A mensagem de erro (`MULTI_CELL_ERROR`) contém "multi-célula" e "exactamente
uma célula".

**Justificação:** a ADR 0013 estabelece que objectos multi-célula produzem
oclusão cíclica, para a qual não existe ordem linear correcta. A mitigação é
de modelo, não de renderer: o formato proíbe, e o editor recusa na carga.

### 5. Retrocompatibilidade: projectos sem `mapa`

O campo `mapa` é opcional (`mapa?: MapData`). Projectos criados antes de F2-02
não têm o campo e são carregados normalmente — `loadProject` só valida objectos
se `project.mapa?.objects` existir.

### 6. RLE com ar explícito

O ar (string vazia) é incluído na RLE porque pode haver blocos acima de ar
(ex.: bloco flutuante). O `BlockStore` suporta isto (setBlock em z saltado
preenche níveis intermédios com ar). `trimTop` remove apenas ar no topo.

## Limitações conhecidas

- **`BlockStore` não valida IDs de bloco.** Qualquer string é aceite. A
  validação contra o atlas é responsabilidade de uma camada superior.
- **`EdgeStore` não valida que a aresta pertence a uma célula com bloco.**
  Uma parede pode existir numa aresta de uma célula vazia. A validação
  pertence ao editor, não ao modelo de dados.
- **`fromRle` ignora chaves mal-formadas** (sem `:` ou com NaN). Isto é
  tolerância para forward-compatibility, não validação estrita.
- **A RLE usa o índice z implícito.** O primeiro run começa em z=0, e a
  posição de cada run subsequente é `sum(count)` dos runs anteriores. Isto
  é compacto mas fragile: se um run for removido sem ajustar os seguintes,
  a coluna dessincroniza. O `BlockStore` mantém o invariante internamente;
  código externo que manipule `BlockRleRun[]` directamente precisa de saber
  isto.
- **Objectos não têm ID.** São anónimos no array `objects`. Se o editor
  precisar de referenciar objectos individuais (para selecção, propriedades),
  será necessário adicionar um campo `id`.

## O que as tasks descendentes precisam saber

- **Para renderização:** `BlockStore.forEach` e `EdgeStore.forEach` iteram
  na ordem de inserção das colunas. Para depth-sorting correcto, o renderer
  deve ordenar por `x + y + z` (blocos) e `2*(x+y+z) + bias` (arestas).

- **Para picking:** `BlockStore.getBlock(x, y, z)` dá O(1). O algoritmo de
  picking percorre z do topo para baixo para cada `(x, y)` candidato. Usar
  `screenToCell` de `geometry.ts` para determinar a célula sob o cursor.

- **Para as questões abertas AB-350..AB-359:** o modelo de mapa está
  implementado com a semântica descrita. As questões devem ser respondidas
  antes de construir o editor sobre este modelo.

- **O `MapData` é o formato serializado**, não o modelo em memória. O editor
  deve usar `BlockStore`/`EdgeStore` para manipulação e converter para
  `MapData` apenas na serialização.

- **`heightAt` é barata** (O(1)) — é `col.length`. Pode ser chamada por
  frame sem custo significativo.

## Verificação

```bash
cd packages/iso-core && npm test && npm run typecheck | grep -q "multi-célula"
# 118 testes passam, 0 falham
# typecheck: 0 erros, output contém "multi-célula"

# Critérios:
! grep -rniE "heightMap|mapaDeAltura|heights:" packages/iso-core/src/map.ts  # zero ocorrências
! grep -rn "from '.*tools/" packages/iso-core/src/                            # zero ocorrências
! grep -rn "pixi" packages/iso-core/src/                                      # zero ocorrências
```
