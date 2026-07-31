# Handoff: F2-01 — Geometria isométrica pura

**Card:** F2-01 · **Onda:** W5 · **Data:** 2026-07-30

## Arquivos produzidos

| Arquivo | Propósito |
| --- | --- |
| `packages/iso-core/src/geometry.ts` | `worldToScreen`, `screenToWorld`, `screenToCell`, validação de geometria |
| `packages/iso-core/src/geometry.test.ts` | 63 testes (total com project.test.ts) |

## API pública

```ts
import type { ProjectGeometry } from './project.ts';

// Tipos
export interface ScreenPoint { readonly sx: number; readonly sy: number; }
export interface WorldPoint  { readonly x: number; readonly y: number; }
export interface CellPoint   { readonly x: number; readonly y: number; }

// Conversões
export function worldToScreen(x, y, z, geom: ProjectGeometry): ScreenPoint
export function screenToWorld(sx, sy, z, geom: ProjectGeometry): WorldPoint
export function screenToCell(sx, sy, z, geom: ProjectGeometry): CellPoint
```

## Decisões de design

### 1. A regra de arredondamento: `Math.floor`

`screenToWorld` devolve coordenadas **fraccionárias** — a posição exacta no grid contínuo.
`screenToCell` aplica `Math.floor` a ambas as componentes.

**A fronteira pertence à célula de menores coordenadas.** Um ponto exactamente na aresta
partilhada entre (0,0) e (1,0) — por exemplo, `worldToScreen(1, 0, 0) = (32, 16)` — pertence
a (1,0) na componente x e a (0,0) na componente y? Não: `screenToWorld(32, 16, 0) = (1, 0)`,
e `Math.floor(1, 0) = (1, 0)`. A aresta direita do diamante (0,0) pertence a (0,0) em todos
os pontos interiores; o vértice extremo pertence à célula seguinte.

**Justificação:** `Math.floor` é a única função de arredondamento que preserva a propriedade
da diagonal e garante que cada ponto do ecrã pertence a exactamente uma célula.

### 2. Fórmulas paramétricas

```
worldToScreen(x, y, z, geom):
  halfW = geom.tileWidth / 2
  halfH = geom.tileHeight / 2
  sx = (x - y) * halfW
  sy = (x + y) * halfH - z * geom.zStep

screenToWorld(sx, sy, z, geom):
  a = sx / halfW
  b = (sy + z * geom.zStep) / halfH
  x = (b + a) / 2
  y = (b - a) / 2
```

Nenhum literal 64, 32 ou 16 aparece no corpo das funções. Tudo é derivado de `geom`.

### 3. Validação da geometria

As três funções validam `geom` e rejeitam com `Error` descritivo se:
- `tileWidth <= 0`, `tileHeight <= 0`, ou `zStep <= 0` (valores não-positivos)
- `tileHeight !== tileWidth / 2` (projecção não-dimétrica 2:1)

A validação ocorre em `halfAxes()`, que é chamada por todas as funções públicas.
Isto significa que `worldToScreen`, `screenToWorld` e `screenToCell` **lançam** para
geometrias inválidas — o chamador não precisa validar separadamente.

### 4. A propriedade da diagonal (corrigida face à ADR 0013)

A ADR 0013 afirma:

> `screenToWorld(sx, sy, z+1) === screenToWorld(sx, sy, z) + (1, 1)`

Isto **não é verdade** para a geometria padrão (tileWidth=64, tileHeight=32, zStep=16).
A fórmula correcta, demonstrada algebricamente e verificada nos testes, é:

```
screenToWorld(sx, sy, z+1, geom)
  ≡ screenToWorld(sx, sy, z, geom) + (zStep/tileHeight, zStep/tileHeight)
```

Com a geometria padrão, `zStep/tileHeight = 16/32 = 0.5`. O deslocamento é `+(0.5, 0.5)`
por nível de Z — **dois níveis para atravessar uma célula completa.**

Quando `zStep == tileHeight`, o deslocamento é `+(1, 1)`, conforme a ADR previa.
Mas a ADR fixou `zStep = 16` e `tileHeight = 32`, que são inconsistentes com a
identidade `+(1, 1)`.

**Impacto no picking:** o raio da câmara em espaço de grid avança `(0.5, 0.5)` por
nível. O algoritmo de picking continua válido — para cada z do topo para baixo,
calcula-se `screenToCell(sx, sy, z, geom)` e verifica-se se a célula está ocupada.
A mesma célula pode aparecer em dois níveis consecutivos, o que é inócuo.

### 5. `screenToCell` como conveniência, não como função essencial

A função `screenToCell` existe como atalho documentado para `Math.floor(screenToWorld(...))`.
As tasks descendentes que precisarem da célula discreta podem usar `screenToCell`
directamente, sem repetir a regra de arredondamento.

## Limitações conhecidas

- **A ADR 0013 contém uma imprecisão.** A identidade `+(1,1)` só vale quando
  `zStep == tileHeight`. Com a geometria padrão é `+(0.5, 0.5)`. A ADR 0013 deve
  ser corrigida ou clarificada.

- **`screenToWorld` não arredonda.** Devolve coordenadas fraccionárias. Se uma
  task precisar apenas da célula discreta, deve usar `screenToCell`. Se precisar
  da posição fraccionária (ex.: interpolação para movimento suave), deve usar
  `screenToWorld`.

- **Não há suporte para geometrias não-dimétricas.** A validação rejeita qualquer
  `tileHeight != tileWidth/2`. Se o projecto evoluir para suportar outras projecções
  (ex.: isométrica verdadeira 2:√3), a validação terá de ser relaxada e as fórmulas
  revistas.

## O que as tasks descendentes precisam saber

- **F2-02 (mapa):** use `screenToCell` para picking de células. A regra de
  arredondamento está encapsulada — não reimplemente `Math.floor(screenToWorld(...))`.

- **Qualquer task de renderização:** `worldToScreen` dá a posição no ecrã de uma
  coordenada de mundo. Use-a para posicionar sprites. `screenToWorld` dá a posição
  fraccionária para interpolação.

- **O campo `zStep` da geometria controla o deslocamento vertical por nível.**
  Alterá-lo muda a propriedade da diagonal e a altura visual dos blocos.

- **A geometria é validada na entrada de cada função.** Não é necessário validar
  antes de chamar — o erro é lançado com mensagem descritiva.

## Verificação

```bash
cd packages/iso-core && npm test && npm run typecheck
# 63 testes passam, 0 falham
# typecheck: 0 erros

# Critérios:
! grep -nE "\b(64|32|16)\b" packages/iso-core/src/geometry.ts  # zero ocorrências
! grep -rn "pixi\|tools/" packages/iso-core/src/geometry.ts     # zero ocorrências
```
