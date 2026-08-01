/**
 * Leitura de rotation_urls por chave — NUNCA por índice.
 *
 * Três ordenações de direção convivem no spec do PixelLab, e endpoints diferentes
 * devolvem-nas em ordens diferentes. Fatiar por índice assume a ordem canónica e
 * troca leste/oeste em silêncio quando o endpoint não a segue.
 *
 * Este módulo lê o dicionário `rotation_urls` pelas chaves (nomes de direção),
 * valida que cada chave é uma das 8 direcções conhecidas, e recusa prosseguir se
 * uma direcção esperada estiver ausente.
 *
 * "Chave desconhecida é erro nomeado. Direção ausente é erro explícito."
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DIRECTIONS, type Direction } from './model.ts';

// ------------------------------------------------------------------ erros nomeados

/** A resposta contém uma chave que não corresponde a nenhuma das 8 direcções canónicas. */
export class UnknownDirectionError extends Error {
  public readonly direction: string;

  constructor(direction: string) {
    super(`direção desconhecida em rotation_urls: "${direction}". As direcções válidas são: ${DIRECTIONS.join(', ')}.`);
    this.name = 'UnknownDirectionError';
    this.direction = direction;
  }
}

/** Uma das 8 direcções esperadas está ausente de rotation_urls. */
export class MissingDirectionError extends Error {
  public readonly direction: Direction;

  constructor(direction: Direction) {
    super(`direção "${direction}" está ausente de rotation_urls. O endpoint deve devolver as 8 direcções.`);
    this.name = 'MissingDirectionError';
    this.direction = direction;
  }
}

// ------------------------------------------------------------------ tipos

export interface FramesResult {
  /** Mapa direção → caminhos relativos dos ficheiros PNG. */
  readonly frames: Record<string, string[]>;
  /** true quando o campo `skeletons` veio populado na resposta (E5). */
  readonly hasSkeletons: boolean;
}

// ------------------------------------------------------------------ formas do payload

/**
 * true quando o dicionário mapeia direção → URL (string http), e não
 * direção → lista de frames base64.
 *
 * A distinção existe porque a MESMA chave `rotation_urls` carrega as duas
 * formas em endpoints diferentes: os de rotação devolvem listas base64, e o
 * CharacterDetail (GET /characters/{id}) devolve URLs. Ler pela forma dos
 * valores é o que impede o caminho do v3 de cair no ramo do base64 e sair
 * com zero frames — que foi exatamente o bug do Sprite Studio.
 */
function isUrlMap(dict: Record<string, unknown>): boolean {
  const values = Object.values(dict).filter((v) => v !== null && v !== undefined);
  if (values.length === 0) return false;
  return values.every((v) => typeof v === 'string' && /^https?:\/\//i.test(v));
}

// ------------------------------------------------------------------ parsing

/**
 * Extrai `rotation_urls` da resposta da API, valida as direcções, e escreve
 * os frames em disco.
 *
 * PRÉ-CONDIÇÃO: a resposta deve conter o campo `rotation_urls` com as 8
 * direcções canónicas como chaves.
 *
 * @param response - Corpo da resposta da API (já deserializado).
 * @param scope - Subpasta dentro de assets/ (ex.: 'characters').
 * @param key - Identificador único do asset (ex.: 'base-humano::__base__').
 * @param assetsDir - Raiz do diretório de assets.
 */
export async function parseAndWriteFrames(
  response: unknown,
  scope: string,
  key: string,
  assetsDir: string,
): Promise<FramesResult> {
  const obj = response as Record<string, unknown> | null | undefined;
  if (!obj || typeof obj !== 'object') {
    throw new Error('resposta da API não é um objeto');
  }

  // Try new format (images dict) first, fallback to old format (rotation_urls).
  let rotationUrls: Record<string, unknown> | null = null;
  const images = obj['images'];
  if (images && typeof images === 'object') {
    rotationUrls = images as Record<string, unknown>;
  } else {
    const ru = obj['rotation_urls'];
    if (ru && typeof ru === 'object') {
      rotationUrls = ru as Record<string, unknown>;
    }
  }

  if (!rotationUrls) {
    throw new Error('resposta da API não contém images nem rotation_urls');
  }

  // --- skeletons (E5) ---
  const skeletons = obj['skeletons'];
  const hasSkeletons = Array.isArray(skeletons) && skeletons.length > 0;

  // --- valida chaves ---
  const rot = rotationUrls as Record<string, unknown>;
  const seen = new Set<string>();

  for (const k of Object.keys(rot)) {
    if (!(DIRECTIONS as readonly string[]).includes(k)) {
      throw new UnknownDirectionError(k);
    }
    seen.add(k);
  }

  // --- verifica direcções ausentes ---
  for (const dir of DIRECTIONS) {
    if (!seen.has(dir)) {
      throw new MissingDirectionError(dir);
    }
  }

  // --- download frames from storage_urls or decode from images ---
  const safe = key.replace(/[^a-z0-9-]+/gi, '_');
  const outDir = join(assetsDir, scope, safe);
  await mkdir(outDir, { recursive: true });

  const frames: Record<string, string[]> = {};

  // Prefer downloadable PNG URLs. Duas formas na mesma API:
  //   - `storage_urls`: dicionário direção → URL (endpoints de rotação);
  //   - `rotation_urls` com VALORES STRING: é o formato do CharacterDetail
  //     (GET /characters/{id}), o único lugar onde o create-character-v3
  //     devolve pixels. O background job da v3 traz só metadados.
  const storageUrls = obj['storage_urls'] as Record<string, string> | undefined;
  const urlMap =
    storageUrls ?? (isUrlMap(rotationUrls) ? (rotationUrls as Record<string, string>) : undefined);
  if (urlMap) {
    for (const dir of DIRECTIONS) {
      const url = urlMap[dir];
      if (!url) throw new MissingDirectionError(dir);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`download ${dir} falhou: HTTP ${response.status}`);
      const buf = Buffer.from(await response.arrayBuffer());
      const name = `${dir}-00.png`;
      await writeFile(join(outDir, name), buf);
      frames[dir] = [`/assets/${scope}/${safe}/${name}`];
    }
    return { frames, hasSkeletons };
  }

  // Fallback: decode from images/rotation_urls dict (raw RGBA or base64 strings).
  const fallbackRot = rotationUrls;
  if (!fallbackRot) throw new Error('resposta da API não contém images nem rotation_urls');

  for (const dir of DIRECTIONS) {
    const frameList = fallbackRot[dir];
    if (!Array.isArray(frameList)) continue;

    const list: string[] = [];
    for (let f = 0; f < frameList.length; f++) {
      const entry = frameList[f];
      let b64: string | undefined;
      if (typeof entry === 'string') {
        b64 = entry.replace(/^data:image\/\w+;base64,/, '');
      } else if (entry && typeof entry === 'object' && 'base64' in entry) {
        b64 = (entry as Record<string, unknown>)['base64'] as string | undefined;
      }
      if (!b64) continue;
      const name = `${dir}-${String(f).padStart(2, '0')}.png`;
      await writeFile(join(outDir, name), Buffer.from(b64, 'base64'));
      list.push(`/assets/${scope}/${safe}/${name}`);
    }

    if (list.length > 0) {
      frames[dir] = list;
    }
  }

  return { frames, hasSkeletons };
}
