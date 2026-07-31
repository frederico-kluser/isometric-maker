/**
 * Ferramenta de colocação de paredes, portas, pilares e escadas — F2-07.
 *
 * Coloca elementos nas arestas das células. Detecta proximidade do cursor
 * a uma aresta e muda o modo de interacção.
 *
 * ## Regras
 *
 * - Parede: colocada na aresta entre duas células, bloqueia passagem.
 * - Porta: colocada na aresta, permite passagem (não bloqueia colisão).
 * - Pilar: colocado no vértice (canto) da célula.
 * - Escada: colocada na aresta, permite step-up independentemente da altura.
 * - Perto da aresta, o cursor muda para modo parede.
 * - Nada escreve no estado directo — tudo por operações do iso-core.
 * - Todo texto em pt-BR.
 */

import { type EdgeSide, EdgeStore } from '@isometric-maker/iso-core/map';

// ------------------------------------------------------------------ tipos

/** Tipos de elementos que podem ser colocados nas arestas. */
export type ElementoAresta = 'parede' | 'porta' | 'pilar' | 'escada';

/** Resultado de uma operação na aresta. */
export interface WallResult {
  /** Novo estado das arestas. */
  readonly edges: EdgeStore;
  /** Mensagem para o utilizador (pt-BR). */
  readonly mensagem: string;
}

// ------------------------------------------------------------------ geometria inline (evita importar geometry.ts)

interface ScreenPoint {
  readonly sx: number;
  readonly sy: number;
}

interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** Geometria da projecção isométrica. */
export interface GeometriaProjecao {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly zStep: number;
}

export const GEOMETRIA_PADRAO: GeometriaProjecao = {
  tileWidth: 64,
  tileHeight: 32,
  zStep: 16,
};

function screenToWorld(
  sx: number,
  sy: number,
  z: number,
  geom: GeometriaProjecao,
): WorldPoint {
  const halfW = geom.tileWidth / 2;
  const halfH = geom.tileHeight / 2;
  const a = sx / halfW;
  const b = (sy + z * geom.zStep) / halfH;
  return { x: (b + a) / 2, y: (b - a) / 2 };
}

/**
 * Converte coordenadas de mundo para ecrã.
 */
export function worldToScreen(
  x: number,
  y: number,
  z: number,
  geom: GeometriaProjecao,
): ScreenPoint {
  const halfW = geom.tileWidth / 2;
  const halfH = geom.tileHeight / 2;
  return {
    sx: (x - y) * halfW,
    sy: (x + y) * halfH - z * geom.zStep,
  };
}

// ------------------------------------------------------------------ detecção de proximidade

/**
 * Lado da aresta mais próximo do cursor.
 *
 * Devolve `null` se o cursor não estiver perto de nenhuma aresta.
 */
export type LadoProximo = {
  readonly lado: EdgeSide;
  /** Distância em píxeis do cursor à aresta. */
  readonly distancia: number;
};

/**
 * Verifica se o cursor está perto de uma aresta da célula (x, y, z).
 *
 * "Perto" significa a menos de 12 px da linha da aresta em ecrã.
 *
 * @param sx - Coordenada x do ecrã (cursor).
 * @param sy - Coordenada y do ecrã (cursor).
 * @param cellX - Coordenada x da célula.
 * @param cellY - Coordenada y da célula.
 * @param z - Nível z.
 * @param geom - Geometria da projecção.
 * @returns O lado mais próximo ou null.
 */
export function arestaProxima(
  sx: number,
  sy: number,
  cellX: number,
  cellY: number,
  z: number,
  geom: GeometriaProjecao = GEOMETRIA_PADRAO,
): LadoProximo | null {
  const LIMIAR = 12; // píxeis

  // Centro da célula em ecrã
  const centro = worldToScreen(cellX, cellY, z, geom);

  // Pontos médios das 4 arestas em ecrã
  const arestas: { lado: EdgeSide; sx: number; sy: number }[] = [
    {
      lado: 'N',
      sx: centro.sx,
      sy: centro.sy - geom.tileHeight / 2,
    },
    {
      lado: 'S',
      sx: centro.sx,
      sy: centro.sy + geom.tileHeight / 2,
    },
    {
      lado: 'L',
      sx: centro.sx + geom.tileWidth / 2,
      sy: centro.sy,
    },
    {
      lado: 'O',
      sx: centro.sx - geom.tileWidth / 2,
      sy: centro.sy,
    },
  ];

  let melhor: LadoProximo | null = null;

  for (const a of arestas) {
    const dx = sx - a.sx;
    const dy = sy - a.sy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < LIMIAR && (!melhor || dist < melhor.distancia)) {
      melhor = { lado: a.lado, distancia: dist };
    }
  }

  return melhor;
}

// ------------------------------------------------------------------ colocação

/**
 * Coloca um elemento numa aresta.
 *
 * @param edges - Estado actual das arestas.
 * @param x - Coordenada x da célula.
 * @param y - Coordenada y da célula.
 * @param z - Nível z da aresta.
 * @param lado - Lado da aresta (N, S, L, O).
 * @param tipo - Tipo de elemento a colocar.
 * @returns Novo estado e mensagem.
 */
export function colocarNaAresta(
  edges: EdgeStore,
  x: number,
  y: number,
  z: number,
  lado: EdgeSide,
  tipo: ElementoAresta,
): WallResult {
  const novasArestas = cloneEdges(edges);

  const existente = novasArestas.getEdge(x, y, z, lado);

  if (existente) {
    // Substitui
    novasArestas.setEdge(x, y, z, lado, tipo);
    return {
      edges: novasArestas,
      mensagem: `${tipo} em (${x},${y},${z},${lado}) substituiu "${existente}".`,
    };
  }

  novasArestas.setEdge(x, y, z, lado, tipo);
  return {
    edges: novasArestas,
    mensagem: `${tipo} colocada em (${x},${y},${z},${lado}).`,
  };
}

// ------------------------------------------------------------------ remoção

/**
 * Remove o elemento de uma aresta.
 *
 * @returns Novo estado e mensagem. Se não houver elemento, retorna o mesmo estado.
 */
export function removerDaAresta(
  edges: EdgeStore,
  x: number,
  y: number,
  z: number,
  lado: EdgeSide,
): WallResult {
  const existente = edges.getEdge(x, y, z, lado);

  if (!existente) {
    return {
      edges,
      mensagem: `Nenhum elemento em (${x},${y},${z},${lado}) para remover.`,
    };
  }

  const novasArestas = cloneEdges(edges);
  novasArestas.removeEdge(x, y, z, lado);
  return {
    edges: novasArestas,
    mensagem: `"${existente}" removida de (${x},${y},${z},${lado}).`,
  };
}

// ------------------------------------------------------------------ consulta

/**
 * Devolve o tipo de elemento numa aresta, ou undefined se não houver.
 */
export function elementoNaAresta(
  edges: EdgeStore,
  x: number,
  y: number,
  z: number,
  lado: EdgeSide,
): string | undefined {
  return edges.getEdge(x, y, z, lado);
}

// ------------------------------------------------------------------ utilitários

function cloneEdges(edges: EdgeStore): EdgeStore {
  return EdgeStore.fromEntries(edges.toEntries());
}
