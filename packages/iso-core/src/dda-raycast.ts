/**
 * Amanatides-Woo DDA (Digital Differential Analyzer) voxel raycasting.
 *
 * Caminha uma grid 3D célula por célula ao longo de um raio, encontrando
 * a primeira célula ocupada (ou saindo dos limites) sem precisar de mesh
 * nenhuma — opera diretamente sobre os dados do mapa (MapData / RLE).
 *
 * ## Sistema de coordenadas
 *
 * Opera em coordenadas de mapa:
 *
 *   map.x = world X
 *   map.y = world Y
 *   map.z = world Z (altura)
 *
 * Nenhuma dependência do Three.js — as coordenadas do Three.js são
 * convertidas ANTES de chamar esta função (ver pick3d-raycaster.ts).
 *
 * ## Referência
 *
 * Amanatides, J., Woo, A. "A Fast Voxel Traversal Algorithm for Ray Tracing."
 * Eurographics '87.
 */

// ------------------------------------------------------------------ tipos

export interface DdaCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface DdaHit {
  /** A célula ocupada que foi atingida (coordenadas de mapa). */
  readonly cell: DdaCell;
  /**
   * A normal da face por onde o raio entrou, em coordenadas de mapa:
   *   {x:0, y:0, z:1} = face de cima (top)
   *   {x:0, y:1, z:0} = face lateral no eixo Y
   *   {x:1, y:0, z:0} = face lateral no eixo X
   */
  readonly normal: DdaCell;
  /** Ponto de entrada em coordenadas de mundo (para ordenação por distância). */
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
}

export interface DdaResult {
  /** Primeira célula ocupada atingida, ou null se o raio sair dos limites. */
  readonly hit: DdaHit | null;
  /** Todas as células percorridas (para debug; pode ser vazio em produção). */
  readonly trace: readonly DdaCell[];
}

// ------------------------------------------------------------------ implementação

/**
 * Amanatides-Woo DDA voxel raycast.
 *
 * @param origin       Origem do raio em coordenadas de mapa.
 * @param direction    Direção normalizada em coordenadas de mapa.
 * @param isOccupied   Callback: devolve true se a célula (x, y, z) está ocupada.
 * @param maxDistance  Distância máxima do raio em unidades de mundo.
 * @returns            Resultado com hit (ou null) e trace das células visitadas.
 */
export function ddaRaycast(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  isOccupied: (x: number, y: number, z: number) => boolean,
  maxDistance: number,
): DdaResult {
  const trace: DdaCell[] = [];

  // Célula inicial (contendo a origem)
  let cellX = Math.floor(origin.x);
  let cellY = Math.floor(origin.y);
  let cellZ = Math.floor(origin.z);

  const dirX = direction.x;
  const dirY = direction.y;
  const dirZ = direction.z;

  // Direção do passo para cada eixo
  const stepX = dirX > 0 ? 1 : dirX < 0 ? -1 : 0;
  const stepY = dirY > 0 ? 1 : dirY < 0 ? -1 : 0;
  const stepZ = dirZ > 0 ? 1 : dirZ < 0 ? -1 : 0;

  // tDelta: distância percorrida pelo raio para atravessar uma célula
  // inteira no eixo. Se a direção for zero no eixo, usamos Infinity
  // para que esse eixo nunca seja escolhido para o passo.
  const tDeltaX = dirX !== 0 ? Math.abs(1 / dirX) : Infinity;
  const tDeltaY = dirY !== 0 ? Math.abs(1 / dirY) : Infinity;
  const tDeltaZ = dirZ !== 0 ? Math.abs(1 / dirZ) : Infinity;

  // tMax: distância até a próxima fronteira de célula no eixo
  let tMaxX: number;
  let tMaxY: number;
  let tMaxZ: number;

  if (dirX > 0) {
    tMaxX = ((cellX + 1) - origin.x) * tDeltaX;
  } else if (dirX < 0) {
    tMaxX = (origin.x - cellX) * tDeltaX;
  } else {
    tMaxX = Infinity;
  }

  if (dirY > 0) {
    tMaxY = ((cellY + 1) - origin.y) * tDeltaY;
  } else if (dirY < 0) {
    tMaxY = (origin.y - cellY) * tDeltaY;
  } else {
    tMaxY = Infinity;
  }

  if (dirZ > 0) {
    tMaxZ = ((cellZ + 1) - origin.z) * tDeltaZ;
  } else if (dirZ < 0) {
    tMaxZ = (origin.z - cellZ) * tDeltaZ;
  } else {
    tMaxZ = Infinity;
  }

  // Se a origem está dentro de uma célula ocupada, pula para a vizinha.
  // O raio começa FORA dos blocos (câmera está acima do mapa).
  // Mas se por algum motivo começar dentro, não consideramos a célula inicial.
  const startInside = isOccupied(cellX, cellY, cellZ);

  // Limite de segurança: previne loop infinito em casos patológicos.
  // Com maxDistance razoável e grid finita, o laço é curto (< 200 passos).
  const SAFETY_LIMIT = 10000;
  let steps = 0;

  // Lado em que o último passo foi dado (para derivar a normal)
  let lastStepAxis: 'x' | 'y' | 'z' = 'x';
  let lastStepSign = 0;

  // Distância acumulada ao longo do raio (aproximada pelo menor tMax)
  let t = 0;

  for (; steps < SAFETY_LIMIT; steps++) {
    // Se a origem não estava dentro de uma célula ocupada, verifica a célula atual
    if (!startInside || steps > 0) {
      if (isOccupied(cellX, cellY, cellZ)) {
        // Atingiu uma célula ocupada
        const point = {
          x: origin.x + dirX * t,
          y: origin.y + dirY * t,
          z: origin.z + dirZ * t,
        };

        // Normal da face: oposta à direção do passo que entrou na célula.
        // Entrar na direção +x → normal aponta para -x.
        const normal: DdaCell = { x: 0, y: 0, z: 0 };
        if (lastStepAxis === 'x') (normal as { x: number }).x = -lastStepSign;
        else if (lastStepAxis === 'y') (normal as { y: number }).y = -lastStepSign;
        else (normal as { z: number }).z = -lastStepSign;

        return {
          hit: { cell: { x: cellX, y: cellY, z: cellZ }, normal, point },
          trace,
        };
      }
    }

    // Guarda a célula atual no trace
    trace.push({ x: cellX, y: cellY, z: cellZ });

    // Escolhe o eixo com menor tMax para o próximo passo
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        // Passo em X
        t = tMaxX;
        if (t > maxDistance) break;
        cellX += stepX;
        tMaxX += tDeltaX;
        lastStepAxis = 'x';
        lastStepSign = stepX;
      } else {
        // Passo em Z
        t = tMaxZ;
        if (t > maxDistance) break;
        cellZ += stepZ;
        tMaxZ += tDeltaZ;
        lastStepAxis = 'z';
        lastStepSign = stepZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        // Passo em Y
        t = tMaxY;
        if (t > maxDistance) break;
        cellY += stepY;
        tMaxY += tDeltaY;
        lastStepAxis = 'y';
        lastStepSign = stepY;
      } else {
        // Passo em Z
        t = tMaxZ;
        if (t > maxDistance) break;
        cellZ += stepZ;
        tMaxZ += tDeltaZ;
        lastStepAxis = 'z';
        lastStepSign = stepZ;
      }
    }
  }

  // Saiu dos limites ou excedeu maxDistance sem acertar nada
  return { hit: null, trace };
}
