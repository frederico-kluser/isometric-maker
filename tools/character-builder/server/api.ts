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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PixelLabClient, pollJob } from '../../pixellab-pipeline/src/api.ts';
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

// ---------------------------------------------------------------- generation

/** Step 1: the base body, rotated into 8 directions. Everything derives from this. */
async function generateBase(character: Character): Promise<void> {
  const s = await load();
  const key = cellKey(character.id, '__base__');
  const c = client();

  const body: Record<string, unknown> = {
    description: character.description,
    image_size: { width: character.size, height: character.size },
    view: 'low top-down',
    seed: character.seed,
    no_background: true,
  };
  // Reference art wins over the prompt: the v3 model rotates the supplied
  // south-facing image instead of inventing a body. Max 256x256.
  if (character.referenceImage) body['reference_image'] = character.referenceImage;

  const res = await c.submit<{ background_job_id?: string; character_id?: string }>(
    'create-character-v3', body,
  );
  const jobId = res.data?.background_job_id;
  const remoteId = res.data?.character_id;
  if (remoteId) {
    const ch = s.characters.find((x) => x.id === character.id);
    if (ch) ch.remoteId = remoteId;
    await save(s);
  }
  if (!jobId) throw new Error('a API não devolveu background_job_id');

  const polled = await pollJob(c, jobId, { timeoutMs: 900_000 });
  if (!polled.ok) throw new Error(polled.reason === 'timeout' ? 'tempo esgotado' : (polled.detail ?? 'falhou'));

  const images = extractImages(polled.job.last_response ?? polled.job);
  if (images.length === 0) throw new Error('resposta sem imagem');

  const frames = await writeFrames('characters', key, images);
  const cell: Cell = {
    key, status: 'pronto', frames, updatedAt: new Date().toISOString(),
    ...(jobId ? { jobId } : {}), ...(remoteId ? { remoteId } : {}),
  };
  const cur = await load();
  cur.cells[key] = cell;
  await save(cur);
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
