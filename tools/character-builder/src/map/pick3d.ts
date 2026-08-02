/**
 * Seleção de célula sob o cursor, com rotação de câmera.
 *
 * Módulo PURO — sem PixiJS, sem DOM. Sucessor de `picking.ts`, que resolve o
 * mesmo problema só na vista 0 e sem alvo de colocação; aquele continua no repo
 * porque tem testes próprios e é o que o renderizador antigo usa.
 *
 * ## Duas respostas, não uma
 *
 * Um editor precisa saber DUAS coisas de um clique, e confundi-las é o que faz
 * um bloco novo nascer dentro do que já existe:
 *
 *   - **hit** — a célula OCUPADA sob o cursor. É o alvo de remover e pintar.
 *   - **placement** — a célula VAZIA adjacente onde uma peça nova assenta. É
 *     em cima dela que o cubo semitransparente de preview é desenhado.
 *
 * Sem terreno sob o cursor, `placement` cai no piso `z = 0` — dá para começar
 * um mapa do zero em vez de precisar de um mapa para poder editar.
 *
 * ## O algoritmo é aritmética, não hit-test
 *
 * Na projeção dimétrica 2:1, subir um nível de z desloca a leitura em exatamente
 * meia célula em x e em y. Então percorrer a coluna sob o cursor é caminhar pela
 * diagonal: para cada z, do topo para baixo, converte a tela em célula NAQUELE
 * plano e pergunta se há bloco. Nenhum raio, nenhum teste de sprite.
 */
import type { MapData } from '../../../../packages/iso-core/src/map.ts';
import {
  screenToCell,
  type Camera,
  type ProjectGeometry,
} from './camera.ts';

export interface PickCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Pick3DResult {
  /** Célula ocupada sob o cursor, ou null quando o cursor está no vazio. */
  readonly hit: (PickCell & { readonly block: string }) | null;
  /** Célula vazia onde uma peça nova assenta. Nunca é null. */
  readonly placement: PickCell;
}

/** Teto de z varrido quando o mapa está vazio — o piso ainda precisa responder. */
const MIN_SCAN_HEIGHT = 1;

/** Maior z ocupado no mapa. */
export function maxOccupiedZ(map: MapData): number {
  let max = 0;
  for (const runs of Object.values(map.blocks)) {
    let z = 0;
    for (const run of runs) {
      if (run.block !== '') max = Math.max(max, z + run.count - 1);
      z += run.count;
    }
  }
  return max;
}

/** Tipo de bloco em (x,y,z), ou undefined para ar/fora do mapa. */
export function blockAt(
  map: MapData,
  x: number,
  y: number,
  z: number,
): string | undefined {
  const runs = map.blocks[`${x}:${y}`];
  if (!runs) return undefined;
  let cur = 0;
  for (const run of runs) {
    if (z >= cur && z <= cur + run.count - 1) {
      return run.block === '' ? undefined : run.block;
    }
    cur += run.count;
  }
  return undefined;
}

/** Altura da coluna (primeiro z livre acima do topo). */
export function columnHeight(map: MapData, x: number, y: number): number {
  const runs = map.blocks[`${x}:${y}`];
  if (!runs) return 0;
  let total = 0;
  let lastFilled = 0;
  for (const run of runs) {
    total += run.count;
    if (run.block !== '') lastFilled = total;
  }
  return lastFilled;
}

/**
 * Resolve o clique em `hit` + `placement`.
 *
 * O `placement` é a célula IMEDIATAMENTE acima do bloco atingido, no mesmo
 * (x,y) — é onde a peça empilha. Sem acerto, é o piso da coluna sob o cursor
 * em z = 0, para que um mapa vazio ainda aceite a primeira peça.
 */
export function pick3d(
  sx: number,
  sy: number,
  map: MapData,
  camera: Camera,
  geom: ProjectGeometry,
): Pick3DResult {
  const top = Math.max(maxOccupiedZ(map), MIN_SCAN_HEIGHT);

  // Do topo para baixo pela diagonal: a primeira célula ocupada é o acerto.
  for (let z = top; z >= 0; z -= 1) {
    const cell = screenToCell(sx, sy, z, camera, geom);
    const block = blockAt(map, cell.x, cell.y, z);
    if (block !== undefined) {
      return {
        hit: { x: cell.x, y: cell.y, z, block },
        placement: { x: cell.x, y: cell.y, z: z + 1 },
      };
    }
  }

  // Vazio: o alvo é o piso da coluna sob o cursor.
  const floor = screenToCell(sx, sy, 0, camera, geom);
  return { hit: null, placement: { x: floor.x, y: floor.y, z: 0 } };
}

/**
 * Igual a {@link pick3d}, mas o alvo de colocação é o TOPO da coluna, não a
 * célula acima do bloco atingido.
 *
 * A diferença aparece em relevo: mirando a lateral de uma torre, `pick3d`
 * assentaria a peça encostada no meio dela; este assenta no topo. É a leitura
 * certa para a ferramenta de empilhar, e a errada para preencher um vão —
 * por isso as duas existem, nomeadas.
 */
export function pickColumnTop(
  sx: number,
  sy: number,
  map: MapData,
  camera: Camera,
  geom: ProjectGeometry,
): Pick3DResult {
  const base = pick3d(sx, sy, map, camera, geom);
  if (base.hit === null) return base;
  const height = columnHeight(map, base.hit.x, base.hit.y);
  return {
    hit: base.hit,
    placement: { x: base.hit.x, y: base.hit.y, z: height },
  };
}
