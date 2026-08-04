/**
 * Colisão sólida AABB — a caixa do personagem contra os cubos do mapa.
 *
 * ## O que isto substitui
 *
 * A colisão histórica (`collision.ts`) testa o CENTRO do personagem contra a
 * célula (`Math.floor(pos)` contra `hasBlock`). O corpo é um ponto: a quina de
 * um bloco só pára o personagem quando o centro cruza a fronteira da célula, e
 * um personagem encostado numa parede ainda "flutua" a meio corpo de distância.
 * Este módulo dá corpo ao personagem: uma caixa alinhada aos eixos de meia
 * largura `half`, varrida por eixo, estilo Minecraft.
 *
 * ## A caixa e o `half`
 *
 * `PLAYER_HALF = 0.325` → caixa total de ~0,65 célula. O personagem é mais
 * estreito que a célula (0,65 < 1): cabe no corredor de uma célula e encosta na
 * parede quando a face da caixa chega à fronteira — 0,325 célula antes de o
 * centro a cruzar. É por isso que o degrau passou a ser proposto pela face
 * pressionada, e não pela travessia do centro (ver `simulate.ts`).
 *
 * ## Varrimento por eixo (swept AABB)
 *
 * `resolveMovement` move X primeiro, actualiza a caixa, e move Y em cima do
 * resultado. Cada eixo varre as células que a face dianteira atravessaria e
 * clampa na primeira sólida. Bloquear num eixo não bloqueia o outro: encostar
 * numa parede em diagonal desliza ao longo dela. Esta é a decisão de
 * "sliding natural" — por eixo, nunca diagonal.
 *
 * ## Garantia de contacto: a face pára na face do cubo
 *
 * A varredura clampa a face DIANTEIRA da caixa na fronteira da primeira célula
 * sólida do percurso — a face da caixa pára na face do cubo, nunca deixa o
 * centro cruzar. Duas propriedades fazem o contacto ser estável:
 *
 *   - a célula terminal da varredura é `floor(face + deslocamento)`, SEM
 *     tolerância — é onde a face termina, e se não for varrida a caixa aterra
 *     embutida por ε na célula que devia tê-la parado na face;
 *   - as funções de span (`rowSpan`/`colSpan`) toleram `EPS` dos dois lados da
 *     fronteira: a face colada ao muro (mesmo a 1 ulp, o pior caso do
 *     arredondamento do clamp) não faz a varredura perpendicular ver o muro —
 *     deslizar ao longo da parede nunca trava.
 *
 * Resultado: em movimento contínuo a caixa nunca fica embutida além de `EPS`, e
 * encostada numa parede ela assenta na face e fica — não vibra.
 *
 * ## Z é discreto e fora do varrimento
 *
 * A caixa tem um nível `z` inteiro (o piso). O varrimento é só em X/Y; o Z
 * continua resolvido por degrau, pulo e gravidade (`step-up.ts`, `jump.ts`,
 * `gravity.ts`). Em Z a caixa é [z, z+1) — meio-aberta em cima, como `aabbOf`
 * —, e o que a varredura consulta é `solidAt(x, y, z)`.
 *
 * ## solidAt honra o catálogo
 *
 * `solidAt` responde a "esta célula barra a passagem?". A implementação
 * canónica vem de `blocksMovement` via {@link solidAtFromBlocks}: água e lava
 * têm `solid: false` e não barram, folhagem é `decoration` e também não. Um
 * `CollisionMap` pode expor o seu próprio `solidAt`; sem ele, o padrão cai
 * para `hasBlock` — o comportamento histórico, onde todo bloco barra.
 *
 * ## Caixa embutida
 *
 * Se a caixa já intersecta um sólido no início (estado inválido criado pelo
 * editor, por exemplo), a varredura devolve movimento zero — ela não empurra
 * nem deixa aprofundar. Quem resolve o encaixe é {@link pushOut}: empurra no
 * eixo de menor penetração (MTV), limitado a {@link MAX_PUSH} células.
 *
 * O push-out é a FERRAMENTA DE REPARO do editor, não um passo da simulação.
 * O movimento contínuo já garante o contacto (ver "Garantia de contacto"
 * acima): a varredura nunca cria uma caixa embutida, logo não há o que
 * reparar quadro a quadro — e chamar o MTV por passo custaria a varredura de
 * O(área da caixa) no laço quente e mudaria o comportamento preso nos
 * traços. O `fixedStepWithMap` não chama push-out de propósito.
 *
 * As varreduras assumem `half < 0.5` (caixa mais estreita que a célula). O
 * `PLAYER_HALF` satisfaz isso; um `half` maior precisa de revisitar a
 * varredura.
 */
import type { BlockCatalog } from './block-catalog.ts';
import type { CollisionMap } from './collision.ts';
import type { MapData } from './map.ts';
import {
  aabbOverlaps,
  blocksMovement,
  enumerateBlocks,
  instanceId,
  type GridAabb,
  type PlacedBlock,
} from './map-instances.ts';

// ------------------------------------------------------------------ constantes

/**
 * Meia-largura do personagem, em células. Caixa total ≈ 0,65 célula.
 *
 * Escolha de projecto: o corpo do personagem é mais estreito que a célula do
 * mapa, de modo que ele cabe no corredor de uma célula — a colisão só sente a
 * parede quando a face encosta nela.
 */
export const PLAYER_HALF = 0.325;

/**
 * Limite do push-out, em células. Uma penetração maior que isto não é
 * resolvida num passo — devolve `null` e o chamador decide o que fazer.
 * Com o `PLAYER_HALF`, a penetração máxima possível é 0,65 (< 0,9); o limite
 * existe para caixas maiores.
 */
export const MAX_PUSH = 0.9;

/**
 * Tolerância de fronteira (estabilidade), em células.
 *
 * Uma face que termina a menos de `EPS` da fronteira de uma célula conta como
 * contacto, não como penetração. O valor foi medido, não chutado:
 *
 *   - o arredondamento do clamp da face — a cadeia
 *     `cx + (faceClampada - (cx ± half))` erra a fronteira em ±1-2 ulps
 *     (~2e-15 com o `PLAYER_HALF`) — coberto com 5×10⁵ de folga;
 *   - a deriva acumulada do passo fixo (`pos += vel·dt`, 4 células/s a 1/60 s)
 *     é ~4,7e-9 em 10⁵ quadros — mas ela só cresce em movimento LIVRE, no
 *     eixo livre: a face pressionada é reposta a K ± 2e-15 por cada clamp, e
 *     uma travessia de fronteira com a caixa em movimento é legítima. A
 *     deriva nunca chega a uma decisão de fronteira que importe.
 *
 * Um EPS maior (0,001, por exemplo) foi testado e REJEITADO: a tolerância dos
 * spans deixaria passar uma caixa por um canto de muro a menos de EPS — medido
 * em 0,0009 — e ela "nadaria" ao longo da parede a essa profundidade. É a
 * antítese do "nunca entra num cubo sólido". O piso de ruído é ~2e-15; 1e-9 é
 * a ordem de grandeza certa.
 *
 * A tolerância vale para as funções de span (`rowSpan`/`colSpan`), que decidem
 * com que células a caixa está em contacto — o lado do eixo livre, onde o
 * contacto não pode travar o deslizar. A verificação de caixa embutida (face
 * dianteira dentro de célula sólida, em `sweepX`/`sweepY`) continua EXACTA:
 * uma caixa penetrada não avança mais para dentro, aconteça o que acontecer.
 */
export const EPS = 1e-9;

// ------------------------------------------------------------------ tipos

/** Entidade com caixa de colisão no espaço do GRID (células). */
export interface EntityBox {
  /** Centro x no mundo (contínuo). */
  readonly cx: number;
  /** Centro y no mundo (contínuo). */
  readonly cy: number;
  /** Nível z (inteiro, piso). */
  readonly z: number;
  /** Meia-largura da caixa (padrão: `PLAYER_HALF` → caixa total ~0,65). */
  readonly half: number;
}

/**
 * "Esta célula barra a passagem?"
 *
 * A pergunta que a colisão por caixa faz ao mundo. A implementação canónica
 * usa `blocksMovement` (catálogo); o padrão para um `CollisionMap` sem
 * `solidAt` próprio é `hasBlock` (ver {@link solidAtOf}).
 */
export type SolidAt = (x: number, y: number, z: number) => boolean;

/** Resultado de uma resolução de movimento por caixa. */
export interface MovementResult {
  /** Novo centro x (clampado). */
  readonly x: number;
  /** Novo centro y (clampado). */
  readonly y: number;
  /** O eixo X foi bloqueado por um sólido. */
  readonly blockedX: boolean;
  /** O eixo Y foi bloqueado por um sólido. */
  readonly blockedY: boolean;
}

/** Célula onde o personagem de teste está. */
export interface PlayerCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ------------------------------------------------------------------ sólido

/**
 * `solidAt` de um {@link CollisionMap}: usa o `solidAt` próprio do mapa
 * quando existe, senão cai para `hasBlock`.
 */
export function solidAtOf(map: CollisionMap): SolidAt {
  return (x, y, z) => map.solidAt?.(x, y, z) ?? map.hasBlock(x, y, z);
}

/**
 * `solidAt` que honra o catálogo de materiais: água, lava e folhagem não
 * barram (`blocksMovement` = `kind !== 'decoration' && material.solid`).
 *
 * É a ponte entre o mapa real (MapData + catálogo) e a colisão por caixa.
 */
export function solidAtFromBlocks(blocks: readonly PlacedBlock[]): SolidAt {
  const index = new Map<string, PlacedBlock>();
  for (const b of blocks) index.set(b.id, b);
  return (x, y, z) => {
    const block = index.get(instanceId(x, y, z));
    return block !== undefined && blocksMovement(block);
  };
}

// ------------------------------------------------------------------ AABB

/**
 * AABB da entidade no grid.
 *
 * Meio-aberta em cima, como `aabbOf`: `maxX/maxY` exclusivos, e em Z a caixa
 * ocupa [z, z+1) — o corpo está sobre o piso `z`, e um bloco em `z+1` é um
 * tecto, não uma parede.
 */
export function entityAabb(box: EntityBox): GridAabb {
  return {
    minX: box.cx - box.half,
    minY: box.cy - box.half,
    minZ: box.z,
    maxX: box.cx + box.half,
    maxY: box.cy + box.half,
    maxZ: box.z + 1,
  };
}

// ------------------------------------------------------------------ varredura

/** Alguma célula sólida na coluna `col`, nas linhas `y0..y1`, no nível `z`? */
function anySolidAt(col: number, z: number, y0: number, y1: number, solidAt: SolidAt): boolean {
  for (let y = y0; y <= y1; y++) {
    if (solidAt(col, y, z)) return true;
  }
  return false;
}

/**
 * Linhas que a caixa ocupa (intervalo Y meio-aberto em cima).
 *
 * `EPS` dos DOIS lados. Sem a tolerância no lado inferior, um clamp que aterra
 * a face em K − 1 ulp (o pior caso medido do arredondamento) faz a caixa
 * "ocupar" a linha do muro — a varredura perpendicular vê a parede e o
 * deslizar trava. Dentro de `EPS`, encostar é encostar, não ocupar.
 */
function rowSpan(box: EntityBox): { y0: number; y1: number } {
  return {
    y0: Math.floor(box.cy - box.half + EPS),
    y1: Math.floor(box.cy + box.half - EPS),
  };
}

/**
 * Colunas que a caixa ocupa (intervalo X meio-aberto em cima).
 *
 * Mesma tolerância dos dois lados que em {@link rowSpan}: a face colada à
 * fronteira (a ±EPS) não pode fazer a varredura perpendicular ver o muro.
 */
function colSpan(box: EntityBox): { x0: number; x1: number } {
  return {
    x0: Math.floor(box.cx - box.half + EPS),
    x1: Math.floor(box.cx + box.half - EPS),
  };
}

/**
 * Varre o movimento em X e devolve o `dx` efectivo (clampado).
 *
 * Marcha a face dianteira (maxX ao andar +x, minX ao andar -x) célula a
 * célula na direcção do movimento e clampa na primeira célula sólida do
 * percurso, considerando as linhas que a caixa ocupa.
 *
 * Uma caixa já embutida num sólido devolve 0 — quem resolve o encaixe é
 * {@link pushOut}.
 */
export function sweepX(
  map: CollisionMap,
  box: EntityBox,
  dx: number,
  solidAt: SolidAt = solidAtOf(map),
): number {
  if (dx === 0) return 0;
  const dir = dx > 0 ? 1 : -1;
  const face = dir > 0 ? box.cx + box.half : box.cx - box.half;
  const { y0, y1 } = rowSpan(box);

  // Face inicial já dentro de sólido → caixa embutida: não anda.
  if (anySolidAt(Math.floor(face), box.z, y0, y1, solidAt)) return 0;

  // A célula terminal é ONDE a face termina — `floor(face + dx)`, sem EPS.
  // Um EPS aqui alarga um buraco: com face + dx = K ± ε, o floor com EPS puxa
  // a terminal para K ∓ 1 e a célula de destino nunca é varrida — a caixa
  // aterraria embutida na célula onde deveria ter parado na face (ε dentro
  // do muro, e o próximo quadro fica preso: a varredura recusa embutida).
  const to = Math.floor(face + dx);
  for (let cell = Math.floor(face) + dir; dir > 0 ? cell <= to : cell >= to; cell += dir) {
    if (anySolidAt(cell, box.z, y0, y1, solidAt)) {
      // Primeira célula sólida: clampa a face na fronteira dela. O bloco
      // ocupa [cell, cell+1); andando +x a face pára em `cell`, andando -x
      // pára em `cell + 1`.
      const clampedFace = dir > 0 ? cell : cell + 1;
      return clampedFace - face;
    }
  }
  return dx;
}

/**
 * Varre o movimento em Y e devolve o `dy` efectivo (clampado).
 *
 * Simétrica a {@link sweepX}: marcha a face dianteira (maxY/minY) célula a
 * célula, considerando as colunas que a caixa ocupa.
 */
export function sweepY(
  map: CollisionMap,
  box: EntityBox,
  dy: number,
  solidAt: SolidAt = solidAtOf(map),
): number {
  if (dy === 0) return 0;
  const dir = dy > 0 ? 1 : -1;
  const face = dir > 0 ? box.cy + box.half : box.cy - box.half;
  const { x0, x1 } = colSpan(box);

  if (anySolidAtY(Math.floor(face), box.z, x0, x1, solidAt)) return 0;

  const to = Math.floor(face + dy); // ver sweepX: a terminal é o destino real
  for (let cell = Math.floor(face) + dir; dir > 0 ? cell <= to : cell >= to; cell += dir) {
    if (anySolidAtY(cell, box.z, x0, x1, solidAt)) {
      const clampedFace = dir > 0 ? cell : cell + 1;
      return clampedFace - face;
    }
  }
  return dy;
}

/** Alguma célula sólida na linha `row`, nas colunas `x0..x1`, no nível `z`? */
function anySolidAtY(row: number, z: number, x0: number, x1: number, solidAt: SolidAt): boolean {
  for (let x = x0; x <= x1; x++) {
    if (solidAt(x, row, z)) return true;
  }
  return false;
}

/**
 * Resolve um movimento horizontal (dx, dy) contra os sólidos.
 *
 * Move X primeiro, actualiza a caixa, e move Y em cima do resultado — a
 * ordem que dá o sliding natural: um eixo bloqueado não trava o outro. É a
 * função que a simulação chama no lugar do teste de ponto contra `hasBlock`.
 */
export function resolveMovement(
  map: CollisionMap,
  box: EntityBox,
  dx: number,
  dy: number,
  solidAt: SolidAt = solidAtOf(map),
): MovementResult {
  const bx = sweepX(map, box, dx, solidAt);
  const movedX: EntityBox = { ...box, cx: box.cx + bx };
  const by = sweepY(map, movedX, dy, solidAt);
  return {
    x: movedX.cx,
    y: box.cy + by,
    blockedX: dx !== 0 && bx !== dx,
    blockedY: dy !== 0 && by !== dy,
  };
}

// ------------------------------------------------------------------ push-out

/**
 * Células sólidas com que a caixa está em contacto após {@link resolveMovement}.
 *
 * A face bloqueada está na fronteira de uma célula sólida; esta função
 * devolve essas células (uma por linha/coluna do percurso perpendicular). É o
 * que permite propor o degrau pela face pressionada — a caixa encosta no
 * degrau antes de o centro cruzar a aresta.
 */
export function pressedCells(
  box: EntityBox,
  moved: MovementResult,
  dx: number,
  dy: number,
): readonly { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  if (moved.blockedX && dx !== 0) {
    const col = dx > 0 ? Math.round(moved.x + box.half) : Math.round(moved.x - box.half) - 1;
    const { y0, y1 } = rowSpan({ ...box, cy: moved.y });
    for (let y = y0; y <= y1; y++) cells.push({ x: col, y });
  }
  if (moved.blockedY && dy !== 0) {
    const row = dy > 0 ? Math.round(moved.y + box.half) : Math.round(moved.y - box.half) - 1;
    const { x0, x1 } = colSpan({ ...box, cx: moved.x });
    for (let x = x0; x <= x1; x++) cells.push({ x, y: row });
  }
  return cells;
}

/**
 * Núcleo do push-out (MTV), sem o mapa — só a pergunta do sólido importa.
 *
 * Se a caixa intersecta sólidos, empurra-a no eixo de menor penetração até
 * encostar na fronteira da célula — um passo, não uma resolução iterativa. Se
 * não intersecta nada, ou se a penetração excede {@link MAX_PUSH}, devolve
 * `null` (nada a fazer / profundo demais para resolver no limite).
 *
 * Com o `PLAYER_HALF`, a penetração máxima possível é 0,65 — dentro do
 * limite de 0,9.
 */
export function pushOutOf(solidAt: SolidAt, box: EntityBox): EntityBox | null {
  const aabb = entityAabb(box);
  const { x0, x1 } = colSpan(box);
  const { y0, y1 } = rowSpan(box);

  let best: { pen: number; axis: 'x' | 'y'; cx: number; cy: number } | null = null;

  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (!solidAt(x, y, box.z)) continue;
      const ox = Math.min(aabb.maxX, x + 1) - Math.max(aabb.minX, x);
      const oy = Math.min(aabb.maxY, y + 1) - Math.max(aabb.minY, y);
      if (ox <= 0 || oy <= 0) continue; // encosta, não penetra
      if (ox <= oy) {
        if (!best || ox < best.pen) best = { pen: ox, axis: 'x', cx: x, cy: y };
      } else if (!best || oy < best.pen) {
        best = { pen: oy, axis: 'y', cx: x, cy: y };
      }
    }
  }

  if (!best) return null; // já livre
  if (best.pen > MAX_PUSH) return null; // profundo demais para o limite

  if (best.axis === 'x') {
    // Empurra para o lado onde o centro está (a metade da célula mais perto).
    const newCx = box.cx < best.cx + 0.5 ? best.cx - box.half : best.cx + 1 + box.half;
    return { ...box, cx: newCx };
  }
  const newCy = box.cy < best.cy + 0.5 ? best.cy - box.half : best.cy + 1 + box.half;
  return { ...box, cy: newCy };
}

/**
 * Empurra a caixa para fora do primeiro sólido que intersecta (MTV).
 *
 * É o que garante que "colocar um bloco sobre o personagem" o empurra para
 * fora em vez de o deixar dentro da pedra. Ver {@link pushOutOf} para a
 * semântica.
 */
export function pushOut(
  map: CollisionMap,
  box: EntityBox,
  solidAt: SolidAt = solidAtOf(map),
): EntityBox | null {
  return pushOutOf(solidAt, box);
}

// ------------------------------------------------------------------ editor

/**
 * Garante que colocar um bloco não deixa o personagem de teste dentro dele.
 *
 * Ponte para o editor 3D: depois de `placeBlock` (ou de pintar a célula),
 * se o personagem de teste estiver na célula e o bloco for sólido, empurra-o
 * para fora (MTV) e devolve a célula nova. Devolve `null` quando não há o
 * que empurrar (personagem fora da célula, bloco não-sólido, ou penetração
 * além do limite).
 */
export function pushPlayerOutOfCell(
  map: MapData,
  catalog: BlockCatalog,
  player: PlayerCell,
  cell: PlayerCell,
): PlayerCell | null {
  const solidAt = solidAtFromBlocks(enumerateBlocks(map, catalog));
  const box: EntityBox = {
    cx: player.x + 0.5,
    cy: player.y + 0.5,
    z: player.z,
    half: PLAYER_HALF,
  };
  const blockAabb: GridAabb = {
    minX: cell.x,
    minY: cell.y,
    minZ: cell.z,
    maxX: cell.x + 1,
    maxY: cell.y + 1,
    maxZ: cell.z + 1,
  };
  if (!aabbOverlaps(entityAabb(box), blockAabb)) return null;
  const pushed = pushOutOf(solidAt, box);
  if (!pushed) return null;
  return { x: Math.floor(pushed.cx), y: Math.floor(pushed.cy), z: pushed.z };
}
