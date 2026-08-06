/**
 * API de consulta ao mundo físico: raycast, overlap, sweep.
 *
 * Três funções que respondem a perguntas espaciais contra o grid de voxels.
 * Todas operam sobre o {@link CollisionMap} — não dependem de Three.js, não
 * dependem do renderizador, e são testáveis sem navegador.
 *
 * ## Raycast (DDA de voxel)
 *
 * {@link raycast} percorre a grade de voxels ao longo de um raio usando o
 * algoritmo de Amanatides-Woo (DDA). Devolve a primeira célula ocupada, a normal
 * da face atingida e a distância até ao ponto de impacto.
 *
 * Só testa voxels ocupados (`hasBlock`). O raio é paramétrico: `origin + t *
 * direction` com `t >= 0`. Se nenhum voxel for atingido dentro de `maxDistance`,
 * devolve `hit: null`.
 *
 * ## Overlap
 *
 * {@link overlap} recebe um AABB e devolve as células ocupadas que intersectam
 * essa caixa. É uma iteração sobre o sub-volume da grade, não uma travessia.
 *
 * ## Sweep
 *
 * {@link sweep} varre um AABB ao longo de um vetor de velocidade usando o
 * algoritmo de varrimento por eixo já existente em `collision-box.ts`. Devolve
 * o tempo de colisão (0–1) e a normal da face atingida.
 */

import { type CollisionMap } from './collision.ts';
import { entityAabb, type EntityBox } from './collision-box.ts';
import type { GridAabb } from './map-instances.ts';

// ------------------------------------------------------------------ Vec3

/** Vetor 3D simples — não importa Three.js para isto. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Soma de vetores. */
export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Subtração de vetores. */
export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** Produto por escalar. */
export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

/** Magnitude (comprimento). */
export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** Normaliza o vetor (devolve vetor de comprimento 1). */
export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ------------------------------------------------------------------ raycast

/** Resultado de um raycast contra o mundo de voxels. */
export interface RaycastResult {
  /** Célula atingida, ou `null` se o raio não acertou nada. */
  readonly hit: Vec3 | null;
  /** Normal da face atingida (aponta para FORA do voxel). */
  readonly normal: Vec3;
  /** Distância paramétrica ao longo do raio (t). */
  readonly distance: number;
}

/**
 * Lança um raio contra o grid de voxels (Amanatides-Woo DDA).
 *
 * O raio começa em `origin` e avança na direção `direction`. A direção NÃO
 * precisa ser normalizada — a normalização é feita internamente para o DDA,
 * e a distância devolvida é no espaço do vetor original.
 *
 * Só células com `hasBlock = true` são consideradas obstáculos. O raio pára na
 * primeira célula ocupada que encontra.
 *
 * @param origin - Ponto de partida do raio (coordenadas do mundo).
 * @param direction - Direção do raio (qualquer magnitude).
 * @param maxDistance - Distância máxima paramétrica (no espaço da direção).
 * @param map - Mapa de colisão.
 * @returns O ponto de impacto, a normal e a distância.
 */
export function raycast(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  map: CollisionMap,
): RaycastResult {
  const dirLen = vec3Length(direction);
  if (dirLen === 0) return { hit: null, normal: { x: 0, y: 0, z: 0 }, distance: 0 };

  const dir = vec3Normalize(direction);
  const maxT = maxDistance / dirLen;

  // Célula inicial.
  let cx = Math.floor(origin.x);
  let cy = Math.floor(origin.y);
  let cz = Math.floor(origin.z);

  // Direção do passo (+1 ou -1).
  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  // Distância paramétrica até à próxima fronteira em cada eixo.
  const nextBoundaryX = stepX > 0 ? cx + 1 : cx;
  const nextBoundaryY = stepY > 0 ? cy + 1 : cy;
  const nextBoundaryZ = stepZ > 0 ? cz + 1 : cz;

  // tMax: distância até à próxima fronteira.
  let tMaxX = stepX !== 0 ? (nextBoundaryX - origin.x) / dir.x : Infinity;
  let tMaxY = stepY !== 0 ? (nextBoundaryY - origin.y) / dir.y : Infinity;
  let tMaxZ = stepZ !== 0 ? (nextBoundaryZ - origin.z) / dir.z : Infinity;

  // tDelta: distância entre fronteiras consecutivas.
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  // Normal da face que foi atingida.
  let normal: Vec3 = { x: 0, y: 0, z: 0 };

  // Se o raio começa dentro de um voxel, devolve esse voxel imediatamente.
  if (cz >= 0 && map.hasBlock(cx, cy, cz)) {
    return { hit: { x: cx, y: cy, z: cz }, normal: { x: 0, y: 0, z: 1 }, distance: 0 };
  }

  let t = 0;
  // Limite de iterações de segurança (grade 256^3 no pior caso).
  const maxIter = 512;
  for (let i = 0; i < maxIter; i++) {
    // Encontra o menor tMax.
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      cx += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal = { x: -stepX, y: 0, z: 0 };
    } else if (tMaxY < tMaxZ) {
      cy += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal = { x: 0, y: -stepY, z: 0 };
    } else {
      cz += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal = { x: 0, y: 0, z: -stepZ };
    }

    if (t > maxT) break;

    // Fora do grid? O chão é z >= 0.
    if (cz < 0) break;

    if (map.hasBlock(cx, cy, cz)) {
      return {
        hit: { x: cx, y: cy, z: cz },
        normal,
        distance: t * dirLen, // distância no espaço original
      };
    }
  }

  return { hit: null, normal: { x: 0, y: 0, z: 0 }, distance: 0 };
}

// ------------------------------------------------------------------ overlap

/**
 * Entidade que pode ser devolvida por {@link overlap}.
 *
 * `kind` distingue o tipo de entidade para o chamador reagir de forma diferente
 * (ex: bloco a cair causa dano; ator é empurrado).
 */
export interface OverlapEntity {
  readonly kind: 'block' | 'actor';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Meia-largura da caixa (0,5 para blocos; `PLAYER_HALF` para o ator). */
  readonly half: number;
}

/**
 * Devolve as entidades cujo AABB intersecta `box`.
 *
 * Itera sobre as células do sub-volume `[floor(min), ceil(max))` e devolve
 * as que estão ocupadas. Não faz varrimento — é um teste de intersecção
 * instantânea.
 *
 * @param aabb - Caixa de consulta (coordenadas do grid).
 * @param entities - Lista de entidades a testar.
 * @returns Entidades que intersectam a caixa.
 */
export function overlap(
  aabb: GridAabb,
  entities: readonly OverlapEntity[],
): OverlapEntity[] {
  const result: OverlapEntity[] = [];
  for (const entity of entities) {
    const eAabb: GridAabb = {
      minX: entity.x - entity.half,
      minY: entity.y - entity.half,
      minZ: entity.z,
      maxX: entity.x + entity.half,
      maxY: entity.y + entity.half,
      maxZ: entity.z + 1,
    };

    if (
      aabb.minX < eAabb.maxX &&
      eAabb.minX < aabb.maxX &&
      aabb.minY < eAabb.maxY &&
      eAabb.minY < aabb.maxY &&
      aabb.minZ < eAabb.maxZ &&
      eAabb.minZ < aabb.maxZ
    ) {
      result.push(entity);
    }
  }
  return result;
}

/**
 * Devolve as células ocupadas do mapa que intersectam `aabb`.
 *
 * Itera sobre as células do sub-volume e testa `hasBlock`.
 */
export function overlapMap(
  aabb: GridAabb,
  map: CollisionMap,
): Vec3[] {
  const result: Vec3[] = [];
  const minX = Math.floor(aabb.minX);
  const minY = Math.floor(aabb.minY);
  const minZ = Math.max(0, Math.floor(aabb.minZ));
  const maxX = Math.ceil(aabb.maxX);
  const maxY = Math.ceil(aabb.maxY);
  const maxZ = Math.ceil(aabb.maxZ);

  for (let x = minX; x < maxX; x++) {
    for (let y = minY; y < maxY; y++) {
      for (let z = minZ; z < maxZ; z++) {
        if (map.hasBlock(x, y, z)) {
          result.push({ x, y, z });
        }
      }
    }
  }
  return result;
}

// ------------------------------------------------------------------ sweep

/** Resultado de um sweep de AABB contra o mundo. */
export interface SweepResult {
  /** Célula atingida, ou `null` se não houve colisão. */
  readonly hit: Vec3 | null;
  /** Tempo normalizado da colisão (0–1). 1 se não houve colisão. */
  readonly time: number;
  /** Normal da face atingida. */
  readonly normal: Vec3;
}

/**
 * Varre um AABB ao longo de `velocity` e devolve a primeira colisão com o grid.
 *
 * Algoritmo de varrimento por eixo, similar ao de `resolveMovement` mas para
 * os 3 eixos. A caixa percorre cada eixo separadamente (X, Y, depois Z) e
 * clampa na primeira célula sólida em cada eixo.
 *
 * A ordem X → Y → Z é a mesma de `resolveMovement`: permite sliding natural.
 *
 * @param box - Caixa a varrer (posição inicial).
 * @param velocity - Vetor de velocidade (deslocamento total).
 * @param map - Mapa de colisão.
 * @returns Tempo de colisão (0–1), célula atingida e normal.
 */
export function sweep(
  box: EntityBox,
  velocity: Vec3,
  map: CollisionMap,
): SweepResult {
  const aabb = entityAabb(box);

  // --- eixo X ---
  let tx = 1;
  let hitX: Vec3 | null = null;
  let nx: Vec3 = { x: 0, y: 0, z: 0 };

  if (velocity.x !== 0) {
    const dir = velocity.x > 0 ? 1 : -1;
    const face = dir > 0 ? aabb.maxX : aabb.minX;

    // Células a varrer.
    const toFace = face + velocity.x;
    const startCell = Math.floor(face);
    const endCell = Math.floor(toFace);

    // Começa na célula SEGUINTE (skip da célula onde a face já está).
    // A face está em `startCell` (canto da célula). Se a face está exatamente
    // na fronteira, o `dir` decide se a célula à frente já conta.
    let cell = startCell + dir;
    for (
      ;
      dir > 0 ? cell <= endCell : cell >= endCell;
      cell += dir
    ) {

      // Testa se alguma célula na faixa Y/Z está ocupada.
      const minY = Math.floor(aabb.minY);
      const maxY = Math.ceil(aabb.maxY) - 1;
      const minZ = Math.max(0, Math.floor(aabb.minZ));
      const maxZ = Math.ceil(aabb.maxZ) - 1;

      let blocked = false;
      for (let cy = minY; cy <= maxY && !blocked; cy++) {
        for (let cz = minZ; cz <= maxZ && !blocked; cz++) {
          if (map.hasBlock(cell, cy, cz)) {
            blocked = true;
            const clampedFace = dir > 0 ? cell : cell + 1;
            const disp = clampedFace - face;
            tx = velocity.x !== 0 ? disp / velocity.x : 1;
            tx = Math.max(0, Math.min(1, tx));
            hitX = { x: cell, y: cy, z: cz };
            nx = { x: -dir, y: 0, z: 0 };
          }
        }
      }
      if (blocked) break;
    }
  }

  // --- eixo Y ---
  let ty = 1;
  let hitY: Vec3 | null = null;
  let ny: Vec3 = { x: 0, y: 0, z: 0 };

  if (velocity.y !== 0) {
    // Aplica o deslocamento X parcial.
    const dx = velocity.x * tx;
    const movedMinY = aabb.minY + 0; // Y não muda com X, mas a caixa é alinhada
    const movedMaxY = aabb.maxY + 0;
    const dir = velocity.y > 0 ? 1 : -1;
    const face = dir > 0 ? movedMaxY : movedMinY;
    const toFace = face + velocity.y;

    const startCell = Math.floor(face);
    const endCell = Math.floor(toFace);

    let cell = startCell + dir;
    for (
      ;
      dir > 0 ? cell <= endCell : cell >= endCell;
      cell += dir
    ) {

      const movedMinX = aabb.minX + velocity.x * tx;
      const movedMaxX = aabb.maxX + velocity.x * tx;
      const minX = Math.floor(movedMinX);
      const maxX = Math.ceil(movedMaxX) - 1;
      const minZ = Math.max(0, Math.floor(aabb.minZ));
      const maxZ = Math.ceil(aabb.maxZ) - 1;

      let blocked = false;
      for (let cx = minX; cx <= maxX && !blocked; cx++) {
        for (let cz = minZ; cz <= maxZ && !blocked; cz++) {
          if (map.hasBlock(cx, cell, cz)) {
            blocked = true;
            const clampedFace = dir > 0 ? cell : cell + 1;
            const disp = clampedFace - face;
            ty = velocity.y !== 0 ? disp / velocity.y : 1;
            ty = Math.max(0, Math.min(1, ty));
            hitY = { x: cx, y: cell, z: cz };
            ny = { x: 0, y: -dir, z: 0 };
          }
        }
      }
      if (blocked) break;
    }
  }

  // --- eixo Z ---
  let tz = 1;
  let hitZ: Vec3 | null = null;
  let nz: Vec3 = { x: 0, y: 0, z: 0 };

  if (velocity.z !== 0) {
    const dir = velocity.z > 0 ? 1 : -1;
    const face = dir > 0 ? aabb.maxZ : aabb.minZ;
    const toFace = face + velocity.z;

    const startCell = Math.floor(face);
    const endCell = Math.floor(toFace);

    let cell = startCell + dir;
    for (
      ;
      dir > 0 ? cell <= endCell : cell >= endCell;
      cell += dir
    ) {
      if (cell < 0) continue; // abaixo do chão

      const movedMinX = aabb.minX + velocity.x * tx;
      const movedMaxX = aabb.maxX + velocity.x * tx;
      const movedMinY = aabb.minY + velocity.y * ty;
      const movedMaxY = aabb.maxY + velocity.y * ty;
      const minX = Math.floor(movedMinX);
      const maxX = Math.ceil(movedMaxX) - 1;
      const minY = Math.floor(movedMinY);
      const maxY = Math.ceil(movedMaxY) - 1;

      let blocked = false;
      for (let cx = minX; cx <= maxX && !blocked; cx++) {
        for (let cy = minY; cy <= maxY && !blocked; cy++) {
          if (map.hasBlock(cx, cy, cell)) {
            blocked = true;
            const clampedFace = dir > 0 ? cell : cell + 1;
            const disp = clampedFace - face;
            tz = velocity.z !== 0 ? disp / velocity.z : 1;
            tz = Math.max(0, Math.min(1, tz));
            hitZ = { x: cx, y: cy, z: cell };
            nz = { x: 0, y: 0, z: -dir };
          }
        }
      }
      if (blocked) break;
    }
  }

  // Determina qual eixo colidiu primeiro (menor t).
  // A ordem de aplicação é X → Y → Z, e o tempo de colisão é o menor dos três.
  if (tx < ty && tx < tz && hitX) {
    // Recalcular com a posição após o impacto X.
    return { hit: hitX, time: tx, normal: nx };
  }
  if (ty < tz && hitY) {
    return { hit: hitY, time: ty, normal: ny };
  }
  if (hitZ) {
    return { hit: hitZ, time: tz, normal: nz };
  }

  return { hit: null, time: 1, normal: { x: 0, y: 0, z: 0 } };
}
