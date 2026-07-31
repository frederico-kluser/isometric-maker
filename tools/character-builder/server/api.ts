/**
 * Local API for the character builder, mounted as Vite middleware.
 *
 * Two responsibilities that must not leak into the browser:
 *   1. The PixelLab token. Every call to the API goes through here.
 *   2. Long jobs. Generation takes 2-5 minutes; the browser polls this server,
 *      which owns the job registry and survives a page reload.
 *
 * The transport itself (429/529/423 handling, backoff, poll) is reused from the
 * pipeline rather than reimplemented — it is already tested.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PixelLabClient, pollJob } from '../../pixellab-pipeline/src/api.ts';
import {
  COST_TABLE, estimateByArea, checkBudget,
  type BudgetReport,
} from '../../pixellab-pipeline/src/cost.ts';
import {
  rotateCardinals, estimateRotate,
  type RotateInput,
} from './rotate.ts';
import { validateImport } from '../src/import.ts';
import {
  parseAndWriteFrames,
  UnknownDirectionError,
  MissingDirectionError,
} from './frames.ts';
import { getEstimateReport, trackSpend } from './estimate.ts';
import {
  DIRECTIONS, cellKey, seedStudio, wardrobeKey,
  type Cell, type Character, type Pose, type Studio, type WardrobeItem,
} from './model.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const STUDIO_JSON = join(ROOT, 'studio.json');
const ASSETS = join(ROOT, 'assets');

// ---------------------------------------------------------------- persistence

let cache: Studio | undefined;

async function load(): Promise<Studio> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(STUDIO_JSON, 'utf8')) as Studio;
  } catch {
    cache = seedStudio();
    await save(cache);
  }
  return cache;
}

async function save(s: Studio): Promise<void> {
  cache = s;
  await mkdir(dirname(STUDIO_JSON), { recursive: true });
  const tmp = `${STUDIO_JSON}.tmp`;
  await writeFile(tmp, `${JSON.stringify(s, null, 2)}\n`);
  const { rename } = await import('node:fs/promises');
  await rename(tmp, STUDIO_JSON);
}

// ---------------------------------------------------------------- job registry

interface Job {
  readonly key: string;
  readonly label: string;
  status: 'gerando' | 'pronto' | 'falhou';
  message?: string;
  startedAt: number;
}

const jobs = new Map<string, Job>();

function client(): PixelLabClient {
  const secret = process.env['PIXELLAB_SECRET'];
  if (!secret) {
    throw new Error(
      'PIXELLAB_SECRET não está definido. Exporte o token antes de subir o estúdio — ' +
        'ele fica só no servidor e nunca chega ao navegador.',
    );
  }
  return new PixelLabClient(secret);
}

/** Pulls every PNG out of a response, whatever shape it arrived in. */
function extractImages(payload: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') {
      if (n.startsWith('data:image/')) out.push(n.replace(/^data:image\/\w+;base64,/, ''));
      else if (/^iVBORw0KGgo/.test(n) && n.length > 256) out.push(n);
      return;
    }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (k === 'usage') continue;
        walk(v);
      }
    }
  };
  walk(payload);
  return out;
}

async function writeFrames(
  scope: string, key: string, images: string[],
): Promise<Record<string, string[]>> {
  const safe = key.replace(/[^a-z0-9-]+/gi, '_');
  const dir = join(ASSETS, scope, safe);
  await mkdir(dir, { recursive: true });

  const frames: Record<string, string[]> = {};
  // The 8-rotation endpoints return frames in canonical direction order. When a
  // pose has several frames per direction they arrive grouped the same way, so
  // slicing by direction index is the correct read of the payload.
  const perDir = Math.max(1, Math.floor(images.length / DIRECTIONS.length));
  for (const [di, dir8] of DIRECTIONS.entries()) {
    const list: string[] = [];
    for (let f = 0; f < perDir; f += 1) {
      const idx = di * perDir + f;
      const b64 = images[idx];
      if (!b64) continue;
      const name = `${dir8}-${String(f).padStart(2, '0')}.png`;
      await writeFile(join(dir, name), Buffer.from(b64, 'base64'));
      list.push(`/assets/${scope}/${safe}/${name}`);
    }
    if (list.length > 0) frames[dir8] = list;
  }
  return frames;
}

// ---------------------------------------------------------------- helpers

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9-]+/gi, '_');
}

function appendLedger(path: string, line: Record<string, unknown>): void {
  mkdirSync(join(path, '..'), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`);
}

function logBudgetReport(label: string, report: BudgetReport): void {
  const e = report.estimate;
  const lines = [
    `[guard] ${label}: ${e.point.toFixed(4)} USD ` +
      `(faixa ${e.low.toFixed(4)}–${e.high.toFixed(4)}, confiança ${e.confidence})`,
  ];
  if (report.avisos.length > 0) {
    for (const a of report.avisos) {
      lines.push(`[guard]   aviso [${a.code}]: ${a.text}`);
    }
  }
  // O guard informa e nunca recusa (F0-03). Logamos e seguimos.
  for (const line of lines) console.log(line);
}

// ---------------------------------------------------------------- prova de congelamento

/**
 * Decodifica os pixels de um PNG 8 bpc RGB/RGBA usando só node:zlib.
 * Retorna null se o PNG não estiver num formato suportado.
 */
function decodePNGPixels(b64: string): { width: number; height: number; pixels: Buffer } | null {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 8) return null;
  // Assinatura PNG
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) if (buf[i] !== SIG[i]) return null;

  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks: Buffer[] = [];

  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);

    if (type === 'IHDR') {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
      bitDepth = buf[pos + 16]!;
      colorType = buf[pos + 17]!;
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (idatChunks.length === 0 || width === 0 || height === 0) return null;
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return null;

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = 1 + width * channels; // 1 filter byte + scanline
  const pixels = Buffer.alloc(width * height * channels);

  // Desfiltra cada scanline (None, Sub, Up, Average, Paeth).
  for (let y = 0; y < height; y += 1) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const filter = row[0]!;
    const scanline = row.subarray(1);
    const outRow = pixels.subarray(y * width * channels, (y + 1) * width * channels);

    for (let x = 0; x < scanline.length; x += 1) {
      const left = x >= channels ? outRow[x - channels]! : 0;
      const up = y > 0 ? pixels[(y - 1) * width * channels + x]! : 0;
      const upLeft = (y > 0 && x >= channels) ? pixels[(y - 1) * width * channels + x - channels]! : 0;

      let val = scanline[x]!;
      switch (filter) {
        case 0: break; // None
        case 1: val = (val + left) & 0xff; break; // Sub
        case 2: val = (val + up) & 0xff; break; // Up
        case 3: val = (val + ((left + up) >> 1)) & 0xff; break; // Average
        case 4: { // Paeth
          const p = left + up - upLeft;
          const pL = Math.abs(p - left);
          const pU = Math.abs(p - up);
          const pUL = Math.abs(p - upLeft);
          const pr = (pL <= pU && pL <= pUL) ? left : (pU <= pUL) ? up : upLeft;
          val = (val + pr) & 0xff;
          break;
        }
        default: return null; // filtro desconhecido
      }
      outRow[x] = val;
    }
  }

  return { width, height, pixels };
}

/**
 * Compara os pixels decodificados de duas imagens PNG.
 * Retorna true se forem idênticos, false se diferirem, e null se a decodificação
 * falhar (formato não suportado).
 */
function pixelsIdenticos(sentB64: string, returnedB64: string): boolean | null {
  // Atalho: buffers idênticos = congelamento byte-a-byte confirmado.
  if (Buffer.from(sentB64, 'base64').equals(Buffer.from(returnedB64, 'base64'))) {
    return true;
  }
  // Comparação pixel a pixel para o caso de recompressão sem alteração.
  const sent = decodePNGPixels(sentB64);
  const returned = decodePNGPixels(returnedB64);
  if (!sent || !returned) return null;
  if (sent.width !== returned.width || sent.height !== returned.height) return false;
  return sent.pixels.equals(returned.pixels);
}

/**
 * Verifica que as 4 cardeais devolvidas pela API têm os mesmos pixels das
 * imagens enviadas no mapa `directions`. Esta é a prova de que o parâmetro
 * `directions` de /create-character-with-8-directions congela as direções
 * fornecidas em vez de regenerá-las.
 */
function verifyFreezing(
  sent: Record<string, string>,
  response: unknown,
  imageSize: number,
): void {
  // O endpoint devolve um dicionário keyeado por nome de direção.
  const returned = (response as Record<string, unknown> | null) ?? {};

  const cardinals = ['south', 'north', 'east', 'west'] as const;
  const results: string[] = [];

  for (const dir of cardinals) {
    const sentB64 = sent[dir];
    const returnedVal = returned[dir];
    if (!sentB64) {
      results.push(`${dir}: ausente do mapa enviado — pulando`);
      continue;
    }
    if (typeof returnedVal !== 'string') {
      results.push(`${dir}: resposta não contém string base64 para esta direção`);
      continue;
    }
    // Limpa prefixo data URI se presente.
    const returnedB64 = returnedVal.replace(/^data:image\/\w+;base64,/, '');

    const identical = pixelsIdenticos(sentB64, returnedB64);
    if (identical === true) {
      results.push(`${dir}: CONGELADA — pixels idênticos`);
    } else if (identical === false) {
      // Decodifica ambas mas difere — a API reprocessou.
      const sDec = decodePNGPixels(sentB64);
      const rDec = decodePNGPixels(returnedB64);
      const sInfo = sDec ? `${sDec.width}×${sDec.height}` : '?';
      const rInfo = rDec ? `${rDec.width}×${rDec.height}` : '?';
      results.push(
        `${dir}: REPROCESSADA — sent ${sInfo}, returned ${rInfo}. ` +
        `O mapa directions não congelou esta direção.`,
      );
    } else {
      results.push(`${dir}: não foi possível decodificar — verificação inconclusiva`);
    }
  }

  console.log(`[freeze] Prova de congelamento (image_size=${imageSize}):`);
  for (const r of results) console.log(`[freeze]   ${r}`);
}

// ---------------------------------------------------------------- generation

/**
 * Step 1: the base body, rotated into 8 directions via
 * /create-character-with-8-directions (mode='standard').
 *
 * Este endpoint aceita um mapa `directions` que congela as 4 cardeais
 * fornecidas e gera apenas as 4 diagonais — ao contrário do endpoint v3
 * que gera todas as 8 direções a partir de uma única imagem de referência.
 *
 * Fluxo:
 *   1. Valida a imagem de referência (south) e suas dimensões.
 *   2. Obtém north/east/west via /rotate (com guard e ledger).
 *   3. Submete as 4 cardeais no mapa `directions` (com guard e ledger).
 *   4. Prova de congelamento: compara pixels devolvidos com os enviados.
 *
 * Idempotente: mesma (arte-base, seed, isometric) → nenhuma requisição sai.
 */
async function generateBase(character: Character): Promise<void> {
  const s = await load();
  const key = cellKey(character.id, '__base__');

  // Idempotência: célula pronta = não gasta.
  const existing = s.cells[key];
  if (existing?.status === 'pronto') return;

  // Validação: arte de referência é obrigatória.
  if (!character.referenceImage) {
    throw new Error(
      'é preciso enviar uma imagem de referência (virada para o sul) antes de gerar. ' +
        'O endpoint /create-character-with-8-directions requer ao menos a direção south.',
    );
  }

  // Validação: dimensões da referência batem com image_size.
  // PROIBIDO enviar imagem de directions cujas dimensões não batam com image_size.
  const refBuf = Buffer.from(character.referenceImage, 'base64');
  const validation = validateImport(
    refBuf.buffer.slice(refBuf.byteOffset, refBuf.byteOffset + refBuf.byteLength),
    character.size,
  );
  if (!validation.ok) {
    throw new Error(`imagem de referência inválida: ${validation.error}`);
  }
  if (validation.width !== character.size) {
    throw new Error(
      `a imagem de referência tem ${validation.width}×${validation.height} px, ` +
        `mas o personagem espera ${character.size}×${character.size}. ` +
        `O mapa directions exige que todas as imagens tenham as mesmas dimensões de image_size.`,
    );
  }

  const c = client();
  const outputDir = join(ASSETS, 'characters', sanitize(key));
  const ledgerPath = join(ASSETS, 'ledger.ndjson');

  // --- Cardeais via /rotate (south→north, south→east, south→west) ---

  const rotateInput: RotateInput = {
    fromImage: character.referenceImage,
    seed: character.seed,
    imageSize: { width: character.size, height: character.size },
    outputDir,
    // isometric: OMITIDO quando undefined (F0-09). Com exactOptionalPropertyTypes
    // não podemos passar `undefined` — só incluímos quando o valor é boolean.
    ...(character.isometric !== undefined ? { isometric: character.isometric } : {}),
  };

  // Guard do rotate: informa, não recusa.
  const rotateReport = estimateRotate(rotateInput);
  logBudgetReport('rotate (3× south→N/E/W)', rotateReport);

  const cards = await rotateCardinals(c, rotateInput, { ledgerPath });

  // Ler as PNGs geradas como base64 para o mapa directions.
  const northB64 = (await readFile(cards.north)).toString('base64');
  const eastB64 = (await readFile(cards.east)).toString('base64');
  const westB64 = (await readFile(cards.west)).toString('base64');

  // --- Criação do personagem com 8 direções ---

  const directions: Record<string, string> = {
    south: character.referenceImage,
    north: northB64,
    east: eastB64,
    west: westB64,
  };

  // Guard da criação: informa, não recusa.
  const area = character.size * character.size;
  const creationEstimate = estimateByArea(
    COST_TABLE['create-character-with-8-directions'], area,
  );
  const creationReport = checkBudget({
    estimate: creationEstimate,
    maxSingleAssetUsd: creationEstimate.point,
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: undefined,
  });
  logBudgetReport('create-character-with-8-directions', creationReport);

  const body: Record<string, unknown> = {
    description: character.description,
    image_size: { width: character.size, height: character.size },
    view: 'low top-down',
    mode: 'standard',
    seed: character.seed,
    directions,
  };
  // isometric: OMITIDO quando false (F0-09).
  if (character.isometric) body['isometric'] = true;

  const res = await c.submit<{ background_job_id?: string; character_id?: string }>(
    'create-character-with-8-directions', body,
  );

  // Tracking de sessão: o dinheiro já saiu na submissão.
  if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);

  // Persistir character_id IMEDIATAMENTE.
  const jobId = res.data?.background_job_id;
  const remoteId = res.data?.character_id;
  if (remoteId) {
    const ch = s.characters.find((x) => x.id === character.id);
    if (ch) ch.remoteId = remoteId;
    await save(s);
  }
  if (!jobId) throw new Error('a API não devolveu background_job_id');

  // Ledger da criação.
  const usage = res.usage;
  appendLedger(ledgerPath, {
    at: new Date().toISOString(),
    endpoint: 'create-character-with-8-directions',
    usd: usage?.usd ?? null,
    generations: usage?.generations ?? null,
    unit: usage?.type ?? 'unknown',
  });

  // Poll.
  const polled = await pollJob(c, jobId, { timeoutMs: 900_000 });
  if (!polled.ok) {
    throw new Error(
      polled.reason === 'timeout' ? 'tempo esgotado' : (polled.detail ?? 'falhou'),
    );
  }

  // --- Prova de congelamento ---
  const response = polled.job.last_response ?? polled.job;
  verifyFreezing(directions, response, character.size);

  // Extrair imagens e salvar — usando rotation_urls por chave, NUNCA por índice.
  const { frames, hasSkeletons } = await parseAndWriteFrames(
    response, 'characters', key, ASSETS,
  );
  if (Object.keys(frames).length === 0) throw new Error('resposta sem imagem');

  const cell: Cell = {
    key, status: 'pronto', frames, updatedAt: new Date().toISOString(),
    ...(jobId ? { jobId } : {}), ...(remoteId ? { remoteId } : {}),
    ...(usage?.usd != null ? { costUsd: usage.usd } : {}),
  };
  const cur = await load();
  cur.cells[key] = cell;
  await save(cur);

  if (hasSkeletons) {
    console.log('[skeletons] resposta de E5: skeletons populado para', key);
  }
}

/** Step 2: a pose, animated on top of an existing base character. */
async function generatePose(character: Character, pose: Pose): Promise<void> {
  if (!character.remoteId) {
    throw new Error('gere o modelo base primeiro — a pose se apoia no personagem remoto');
  }
  const key = cellKey(character.id, pose.id);
  const c = client();

  const body: Record<string, unknown> = {
    character_id: character.remoteId,
    animation_name: pose.id,
    seed: character.seed,
    // Without this the API animates only the south direction in custom mode.
    directions: [...DIRECTIONS],
  };

  if (pose.kind === 'template') {
    // 1 generation per direction — by far the cheapest path.
    body['mode'] = 'template';
    body['template_animation_id'] = pose.templateId;
  } else if (pose.kind === 'action') {
    // Free text. Costs ~1 gen/direction up to 96px and scales with size above.
    body['mode'] = 'v3';
    body['action_description'] = pose.action;
    body['frame_count'] = pose.frameCount;
  } else {
    throw new Error('pose de esqueleto é gerada pelo endpoint animate-with-skeleton, não por aqui');
  }

  const res = await c.submit<Record<string, unknown>>('animate-character', body);
  // Animation queues one job PER DIRECTION and returns a list of ids.
  const ids = collectJobIds(res.data);
  if (ids.length === 0) throw new Error('a API não devolveu nenhum job id');

  const images: string[] = [];
  for (const id of ids) {
    const polled = await pollJob(c, id, { timeoutMs: 900_000 });
    if (!polled.ok) continue;
    images.push(...extractImages(polled.job.last_response ?? polled.job));
  }
  if (images.length === 0) throw new Error('nenhuma direção retornou imagem');

  const frames = await writeFrames('poses', key, images);
  const cur = await load();
  cur.cells[key] = {
    key, status: 'pronto', frames, updatedAt: new Date().toISOString(),
  };
  await save(cur);
}

/** Step 3: equipment, as a character state derived from the base body. */
async function generateWardrobe(character: Character, item: WardrobeItem): Promise<void> {
  if (!character.remoteId) throw new Error('gere o modelo base primeiro');
  // Refuse before spending: a garment authored for one silhouette will not fit
  // another, and the API will happily charge for the attempt.
  if (item.silhouette !== character.silhouette) {
    throw new Error(
      `"${item.label}" foi feita para a silhueta ${item.silhouette}, e ${character.label} ` +
        `é ${character.silhouette}. Peça só vale dentro da mesma silhueta — gere uma variante.`,
    );
  }
  const key = wardrobeKey(character.id, item.id);
  const c = client();

  const res = await c.submit<{ background_job_id?: string; character_id?: string }>(
    'create-character-state',
    {
      character_id: character.remoteId,
      edit_description: item.editDescription,
      seed: item.seed,
      no_background: true,
      // Snapping to the source palette is what stops each piece drifting in colour.
      use_color_palette_from_reference: item.keepPalette,
    },
  );
  const jobId = res.data?.background_job_id;
  if (!jobId) throw new Error('a API não devolveu background_job_id');

  const polled = await pollJob(c, jobId, { timeoutMs: 900_000 });
  if (!polled.ok) throw new Error(polled.reason === 'timeout' ? 'tempo esgotado' : (polled.detail ?? 'falhou'));

  const images = extractImages(polled.job.last_response ?? polled.job);
  if (images.length === 0) throw new Error('resposta sem imagem');

  const frames = await writeFrames('wardrobe', key, images);
  const cur = await load();
  const groupId = (polled.job.last_response as { group_id?: string } | undefined)?.group_id;
  cur.cells[key] = {
    key, status: 'pronto', frames, updatedAt: new Date().toISOString(),
    ...(res.data?.character_id ? { remoteId: res.data.character_id } : {}),
    ...(groupId ? { groupId } : {}),
  };
  await save(cur);
}

function collectJobIds(payload: unknown): string[] {
  const ids: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (/job_id$/i.test(k) && typeof v === 'string') ids.push(v);
        else walk(v);
      }
    }
  };
  walk(payload);
  return [...new Set(ids)];
}

/** Runs a generation in the background and records its outcome. */
function spawn(key: string, label: string, work: () => Promise<void>): void {
  jobs.set(key, { key, label, status: 'gerando', startedAt: Date.now() });
  void (async () => {
    try {
      await work();
      jobs.set(key, { key, label, status: 'pronto', startedAt: Date.now() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jobs.set(key, { key, label, status: 'falhou', message, startedAt: Date.now() });
      const s = await load();
      s.cells[key] = { key, status: 'falhou', error: message, updatedAt: new Date().toISOString() };
      await save(s);
    }
  })();
}

// ---------------------------------------------------------------- http

const json = (res: ServerResponse, code: number, body: unknown): void => {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
}

const slug = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `id-${Date.now()}`;

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://local');
  if (!url.pathname.startsWith('/api/')) return false;

  try {
    // ---- state -------------------------------------------------------------
    if (url.pathname === '/api/studio' && req.method === 'GET') {
      const s = await load();
      json(res, 200, {
        ...s,
        jobs: Object.fromEntries([...jobs].map(([k, v]) => [k, v])),
        hasToken: Boolean(process.env['PIXELLAB_SECRET']),
      });
      return true;
    }

    if (url.pathname === '/api/balance' && req.method === 'GET') {
      const { usd } = await client().balance();
      json(res, 200, { usd });
      return true;
    }

    // ---- characters --------------------------------------------------------
    if (url.pathname === '/api/characters' && req.method === 'POST') {
      const b = await readBody<{
        label: string; description: string; size?: number; seed?: number;
        silhouette?: import('./model.ts').Silhouette;
      }>(req);
      const s = await load();
      const ch: Character = {
        id: slug(b.label), label: b.label, description: b.description,
        silhouette: b.silhouette ?? 'humano-medio',
        size: b.size ?? 64, seed: b.seed ?? Math.floor(Math.random() * 100000),
        createdAt: new Date().toISOString(),
      };
      s.characters.push(ch);
      await save(s);
      json(res, 200, ch);
      return true;
    }

    if (url.pathname === '/api/reference' && req.method === 'POST') {
      const b = await readBody<{ characterId: string; base64: string }>(req);
      const s = await load();
      const ch = s.characters.find((c) => c.id === b.characterId);
      if (!ch) { json(res, 404, { error: 'personagem não encontrado' }); return true; }
      ch.referenceImage = b.base64.replace(/^data:image\/\w+;base64,/, '');
      await save(s);
      json(res, 200, { ok: true, bytes: ch.referenceImage.length });
      return true;
    }

    // ---- poses -------------------------------------------------------------
    if (url.pathname === '/api/poses' && req.method === 'POST') {
      const b = await readBody<Omit<Pose, 'id'> & { label: string }>(req);
      const s = await load();
      const pose: Pose = { ...b, id: slug(b.label) };
      s.poses.push(pose);
      await save(s);
      json(res, 200, pose);
      return true;
    }

    if (url.pathname === '/api/poses' && req.method === 'DELETE') {
      const b = await readBody<{ id: string }>(req);
      const s = await load();
      s.poses = s.poses.filter((p) => p.id !== b.id || p.builtin);
      await save(s);
      json(res, 200, { ok: true });
      return true;
    }

    // ---- wardrobe ----------------------------------------------------------
    if (url.pathname === '/api/wardrobe' && req.method === 'POST') {
      const b = await readBody<Omit<WardrobeItem, 'id' | 'createdAt'>>(req);
      const s = await load();
      const item: WardrobeItem = {
        ...b, id: slug(b.label), createdAt: new Date().toISOString(),
      };
      s.wardrobe.push(item);
      await save(s);
      json(res, 200, item);
      return true;
    }

    // ---- estimate ----------------------------------------------------------
    if (url.pathname === '/api/estimate' && req.method === 'GET') {
      const charId = url.searchParams.get('characterId');
      const poseId = url.searchParams.get('poseId');
      const wardrobeId = url.searchParams.get('wardrobeId');
      const s = await load();
      const ch = s.characters.find((c) => c.id === charId);
      if (!ch) { json(res, 404, { error: 'personagem não encontrado' }); return true; }

      const pose = poseId ? s.poses.find((p) => p.id === poseId) : undefined;
      const item = wardrobeId ? s.wardrobe.find((w) => w.id === wardrobeId) : undefined;

      const estReq: import('../server/estimate.ts').EstimateRequest = {
        character: ch,
        ...(pose ? { pose } : {}),
        ...(item ? { item } : {}),
      };
      const estimate = await getEstimateReport(estReq);
      json(res, 200, estimate);
      return true;
    }

    // ---- generation --------------------------------------------------------
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const b = await readBody<{ characterId: string; poseId?: string; wardrobeId?: string }>(req);
      const s = await load();
      const ch = s.characters.find((c) => c.id === b.characterId);
      if (!ch) { json(res, 404, { error: 'personagem não encontrado' }); return true; }

      if (b.wardrobeId) {
        const item = s.wardrobe.find((w) => w.id === b.wardrobeId);
        if (!item) { json(res, 404, { error: 'peça não encontrada' }); return true; }
        const key = wardrobeKey(ch.id, item.id);
        s.cells[key] = { key, status: 'gerando', updatedAt: new Date().toISOString() };
        await save(s);
        spawn(key, `${ch.label} · ${item.label}`, () => generateWardrobe(ch, item));
        json(res, 202, { key });
        return true;
      }

      if (!b.poseId || b.poseId === '__base__') {
        const key = cellKey(ch.id, '__base__');
        s.cells[key] = { key, status: 'gerando', updatedAt: new Date().toISOString() };
        await save(s);
        spawn(key, `${ch.label} · modelo base`, () => generateBase(ch));
        json(res, 202, { key });
        return true;
      }

      const pose = s.poses.find((p) => p.id === b.poseId);
      if (!pose) { json(res, 404, { error: 'pose não encontrada' }); return true; }
      const key = cellKey(ch.id, pose.id);
      s.cells[key] = { key, status: 'gerando', updatedAt: new Date().toISOString() };
      await save(s);
      spawn(key, `${ch.label} · ${pose.label}`, () => generatePose(ch, pose));
      json(res, 202, { key });
      return true;
    }

    json(res, 404, { error: 'rota desconhecida' });
    return true;
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}
