/**
 * Adaptador de `MapData` para a interface `CollisionMap` do iso-core.
 *
 * O iso-core define colisão contra duas perguntas — `hasBlock` e `hasEdge` — e
 * **nenhum store do projeto as implementa**: todo `CollisionMap` que existia na
 * árvore até aqui era duplo de teste escrito à mão. Este módulo é a primeira
 * ponte de verdade entre o documento que o editor manipula e a física.
 *
 * ## Duas armadilhas do formato, resolvidas aqui
 *
 * 1. **Ar dentro da coluna existe.** As colunas são RLE desde z=0 e podem
 *    conter runs de `''` (ar) no meio — colocar um bloco em z=5 numa coluna
 *    vazia enche z=0..4 de ar explícito. Logo `getBlock` devolvendo string
 *    vazia significa "vazio", não "sólido", e `undefined` significa "acima do
 *    topo". Os dois são não-sólidos, e tratar `''` como bloco faria o
 *    personagem andar sobre o ar.
 * 2. **`hasEdge` não recebe `tipo`.** A assinatura do iso-core só pergunta se
 *    existe aresta naquele lado, então **toda aresta bloqueia igual** — uma
 *    `porta` barra tanto quanto uma `parede`. Está registrado como limitação
 *    conhecida, não corrigido: distinguir tipos muda a interface do iso-core e
 *    é decisão própria. Hoje o editor nem tem ferramenta de aresta, então
 *    `edges` está sempre vazio na prática.
 *
 * O índice é montado uma vez por mapa e consultado em O(1). Reconstruir a cada
 * quadro custaria varrer o mapa inteiro 60 vezes por segundo para responder
 * perguntas que não mudaram.
 */
import type {
  CollisionMap,
} from './collision.ts';
import type {
  EdgeSide,
  MapData,
} from './map.ts';

/** Chave de célula no índice. */
function cellKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function edgeKey(x: number, y: number, z: number, lado: EdgeSide): string {
  return `${x}:${y}:${z}:${lado}`;
}

/**
 * Constrói um `CollisionMap` a partir do documento do editor.
 *
 * O resultado é imutável e só vale para o `map` recebido: qualquer edição pede
 * um índice novo. Como o editor só muda o documento por comando do usuário
 * (ADR 0010), reconstruir na mudança de estado é barato e correto.
 */
export function buildCollisionMap(map: MapData): CollisionMap {
  const solidos = new Set<string>();
  for (const [chave, runs] of Object.entries(map.blocks)) {
    const [xs, ys] = chave.split(':');
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    let z = 0;
    for (const run of runs) {
      // Run de ar avança o z e não marca nada — é exatamente o buraco que a
      // armadilha 1 descreve.
      if (run.block !== '') {
        for (let i = 0; i < run.count; i += 1) solidos.add(cellKey(x, y, z + i));
      }
      z += run.count;
    }
  }

  const arestas = new Set<string>();
  for (const e of map.edges) arestas.add(edgeKey(e.x, e.y, e.z, e.lado));

  return {
    hasBlock(x, y, z) {
      return solidos.has(cellKey(x, y, z));
    },
    hasEdge(x, y, z, lado) {
      return arestas.has(edgeKey(x, y, z, lado));
    },
  };
}

/**
 * Maior `z` livre sobre a coluna `(x, y)` — onde um personagem largado ali
 * assenta.
 *
 * Anda de baixo para cima procurando a primeira célula vazia cuja de baixo é
 * sólida; se a coluna não tem nada, devolve 0, que é o plano de chão. É a mesma
 * regra de suporte de `canEnter`, e por isso um personagem posto aqui nunca
 * nasce dentro de pedra nem flutuando.
 */
export function spawnZAt(
  colisao: CollisionMap,
  x: number,
  y: number,
  maxZ = 64,
): number {
  for (let z = 0; z <= maxZ; z += 1) {
    if (colisao.hasBlock(x, y, z)) continue;
    if (z === 0 || colisao.hasBlock(x, y, z - 1)) return z;
  }
  return 0;
}
