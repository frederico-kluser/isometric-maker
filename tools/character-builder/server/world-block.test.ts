/**
 * Teste da bancada de blocos do mundo com cliente falso — as DUAS técnicas.
 *
 * Propriedades verificadas (sem rede, sem gastar):
 *   1. Validação ANTES de gastar: erro nomeado e ZERO chamadas.
 *   2. `chained`: 4 gerações de tile; a norte sai PRIMEIRO com o molde como
 *      init_image, e as outras três recebem o RESULTADO da norte como
 *      init_image E color_image — o encadeamento é o contrato.
 *   3. `rotated`: 1 tile (source) + 1 create-character-v3; as 8 direções vêm
 *      de rotation_urls como imagens separadas (nada de GIF), gravadas em
 *      v3/; as 4 vistas são derivadas localmente no quadro CANÔNICO 48×53.
 *   4. Idempotência e retomada SEM repagar: segunda execução = zero
 *      submissões; falha depois da submissão deixa stub com tile_id /
 *      character_id, e a retomada busca o artefato pago de graça.
 *   5. A técnica entra no hash; default explícito e omitido têm o MESMO hash.
 *   6. tile_id/character_id no ledger E no manifesto, e o manifesto NUNCA
 *      perde provenance numa retomada parcial (ADR 0023).
 *   7. listWorldBlocks só publica bloco COMPLETO do formato v2; trocar o
 *      mapeamento facing→direção rederiva de graça.
 *   8. `texture`: 1 cubo via create-isometric-tile (molde como init_image,
 *      shape 'block', canvas da API → recorte 48×53) + ação de LLM/fallback +
 *      1 animate-with-text-v3; o stub do cubo pago nunca é re-submetido.
 *   9. Remoção: `deleteWorldBlock` leva o diretório INTEIRO (inclusive nomes
 *      de formatos antigos), é idempotente, RECUSA qualquer caminho que não
 *      seja 16 hexadecimais (`..`, `%2e%2e`, separador, NUL) e tira o
 *      manifesto primeiro, para que uma remoção parcial deixe restos
 *      invisíveis ao catálogo em vez de bloco listado sem PNG.
 *
 * Execute com: node --test server/world-block.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PixelLabClient, PixelLabError, type ApiResult } from '../../pixellab-pipeline/src/api.ts';
import { COST_TABLE, estimateByArea } from '../../pixellab-pipeline/src/cost.ts';
import { apiImageSize, mouldBase64, BLOCK_GEOMETRY } from './cube-mould.ts';
import { decodePngToRgba, encodePngFromRgba, readPngHeader } from './png.ts';
import { DIRECTIONS } from './model.ts';
import {
  runWorldBlock,
  readWorldBlockResult,
  listWorldBlocks,
  deleteWorldBlock,
  isWorldBlockHash,
  facingPrompt,
  cubePrompt,
  fallbackMaterial,
  MATERIAL_MAX_LEN,
  actionWithMaterial,
  worldBlockHash,
  padPngToApiCanvas,
  apiBytesToCanonicalPng,
  animationPixelBudget,
  sheetNeedsRepack,
  repackSpritesheetIfStale,
  ANIMATION_PIXEL_BUDGET,
  WorldBlockValidationError,
  BLOCK_FACINGS,
  FACING_TO_V3_DIRECTION,
  type WorldBlockConfig,
  type WorldBlockErrorCode,
} from './world-block.ts';

// ------------------------------------------------------------------ PNG sintético

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** PNG RGBA válido e DECODIFICÁVEL (tipo de cor 6); `fill` distingue arquivos. */
function makePNGRect(width: number, height: number, fill: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = row + 1 + x * 4;
      raw[px] = fill & 0xff;
      raw[px + 1] = (fill * 7) & 0xff;
      raw[px + 2] = (fill * 13) & 0xff;
      raw[px + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makePNG(side: number, fill: number): Buffer {
  return makePNGRect(side, side, fill);
}

/**
 * PNG com CABEÇALHO válido e PIXELS podres: o IHDR declara `width×height`, o
 * IDAT não é zlib nenhum.
 *
 * É o reagente que separa "leu o cabeçalho" de "inflou a imagem". `readPngHeader`
 * abre este arquivo sem reclamar; `decodePngToRgba` estoura no `inflateSync`.
 * Um caminho que só precisa das dimensões passa por ele em silêncio — e é
 * exatamente essa a propriedade sob teste.
 */
function makePNGCabecalhoValidoPixelsPodres(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', Buffer.from('isto nao e um fluxo zlib, e de proposito')),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Um PNG distinto por seed — é como provamos qual chamada produziu o quê. */
function pngForSeed(seed: number): string {
  return makePNG(8, (seed % 200) + 1).toString('base64');
}

/** Um PNG distinto por direção do v3. */
function pngForDirection(direction: string): Buffer {
  let h = 0;
  for (const ch of direction) h = (h * 31 + ch.charCodeAt(0)) % 199;
  return makePNG(16, h + 1);
}

// ------------------------------------------------------------------ client falso

type ResponseMode = 'sync' | 'async-job' | 'async-tile';

class FakeClient extends PixelLabClient {
  readonly tileBodies: Array<Record<string, unknown>> = [];
  readonly v3Bodies: Array<Record<string, unknown>> = [];
  /** Corpos dos POSTs de /animate-with-text-v3 (técnica 'texture'). */
  readonly animBodies: Array<Record<string, unknown>> = [];
  /** GETs de /isometric-tiles — prova a recuperação por tile_id sem POST. */
  readonly tileGets: string[] = [];
  /** Ordem de chegada dos POSTs de tile — prova que a norte vem primeiro. */
  readonly order: string[] = [];
  mode: ResponseMode = 'sync';
  /** Quantos GETs de tile respondem 423 antes de entregar. */
  lockedReads = 0;
  /** Quantos jobs de tile respondem 'failed' (falha DEPOIS da cobrança). */
  failTileJobs = 0;
  /** Direções OMITIDAS de rotation_urls, para o teste de ausência. */
  omitDirections: string[] = [];
  private tileReads = new Map<string, number>();

  constructor() {
    super('fake-token-for-test-only');
  }

  /**
   * Simula o estado do fornecedor em 2026-08-01: qualquer submissão de tile
   * com init_image/color_image morre em 422 síncrono (validação pede PNG,
   * worker exige RGBA cru — incompatíveis; ver o comentário em generateTile).
   */
  rejectImageInputs = false;
  /** Quando definido, o POST de animação devolve `enhanced_prompt`. */
  animEnhancedPrompt: string | undefined;
  /** Quadro dos frames devolvidos pela animação. Default: o canônico 48×53. */
  animFrameWidth = BLOCK_GEOMETRY.spriteWidth;
  animFrameHeight = BLOCK_GEOMETRY.spriteHeight;

  override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    if (method === 'POST' && path === '/create-isometric-tile') {
      const b = (body ?? {}) as Record<string, unknown>;
      if (this.rejectImageInputs && ('init_image' in b || 'color_image' in b)) {
        // Antes do push: o 422 não cobra, não vira ledger e não conta corpo.
        throw new PixelLabError(
          '422 em POST /create-isometric-tile',
          422,
          '{"detail":[{"type":"value_error","loc":["body","init_image","base64"],' +
            '"msg":"Value error, decodes but is not a readable image."}]}',
          false,
        );
      }
      this.tileBodies.push(b);
      this.order.push(String(b['description']));
      const seed = Number(b['seed']);
      if (this.mode === 'sync') {
        // A técnica 'texture' pede o cubo via create-isometric-tile: o endpoint
        // devolve PIXELS RGBA CRUS no canvas da API (48×56), nunca um PNG — o
        // recorte canônico (48×53) é o que o world-block faz com a resposta.
        if (/pixel art cube/.test(String(b['description']))) {
          const api = apiImageSize();
          const rgba = Buffer.alloc(api.width * api.height * 4);
          for (let i = 0; i < rgba.length; i += 1) rgba[i] = (seed * 7 + i) & 0xff;
          return this.ok<T>({
            image: { type: 'base64', base64: rgba.toString('base64') },
            usage: { type: 'usd', usd: 0.02 },
          });
        }
        return this.ok<T>({
          image: { type: 'base64', base64: pngForSeed(seed) },
          usage: { type: 'usd', usd: 0.0156 },
        });
      }
      return this.ok<T>({
        background_job_id: `job-${seed}`,
        tile_id: `tile-${seed}`,
        status: 'processing',
        usage: { type: 'usd', usd: 0.0156 },
      });
    }

    if (method === 'POST' && path === '/create-character-v3') {
      const b = (body ?? {}) as Record<string, unknown>;
      this.v3Bodies.push(b);
      const seed = Number(b['seed']);
      return this.ok<T>({
        background_job_id: `v3job-${seed}`,
        character_id: `char-${seed}`,
        usage: { type: 'usd', usd: 0.04 },
      });
    }

    if (method === 'POST' && path === '/animate-with-text-v3') {
      const b = (body ?? {}) as Record<string, unknown>;
      this.animBodies.push(b);
      const seed = Number(b['seed']);
      return this.ok<T>({
        background_job_id: `animjob-${seed}`,
        usage: { type: 'usd', usd: 0.03 },
        ...(this.animEnhancedPrompt !== undefined
          ? { enhanced_prompt: this.animEnhancedPrompt }
          : {}),
      });
    }

    if (method === 'GET' && path.startsWith('/background-jobs/')) {
      const id = path.slice('/background-jobs/'.length);
      if (id.startsWith('animjob-')) {
        // O job da animação de textura traz os frames prontos em
        // last_response.images[] — 4 frames no QUADRO CANÔNICO 48×53.
        //
        // Não é detalhe do fake: o `first_frame` que o world-block manda é o
        // cubo base 48×53, e o /animate-with-text-v3 devolve frames do tamanho
        // do primeiro. Os dois blocos pagos em disco têm frames 48×53. Um fake
        // que devolvesse 48×48 quadrado esconderia justamente o bug de recorte
        // que o packSpritesheet tinha.
        return this.ok<T>({
          id,
          status: 'completed',
          created_at: '2026-08-01T00:00:00Z',
          last_response: {
            images: [1, 2, 3, 4].map((fill) => ({
              base64: makePNGRect(
                this.animFrameWidth,
                this.animFrameHeight,
                fill,
              ).toString('base64'),
            })),
          },
        });
      }
      if (id.startsWith('v3job-')) {
        // O job do v3 traz SÓ metadado — os pixels moram no CharacterDetail.
        return this.ok<T>({
          id,
          status: 'completed',
          created_at: '2026-08-01T00:00:00Z',
          last_response: { character_id: id.replace('v3job-', 'char-'), directions_count: 8 },
        });
      }
      if (this.failTileJobs > 0) {
        this.failTileJobs -= 1;
        return this.ok<T>({
          id,
          status: 'failed',
          created_at: '2026-08-01T00:00:00Z',
          error: 'falha simulada depois da cobrança',
        });
      }
      const seed = Number(id.replace('job-', ''));
      return this.ok<T>({
        id,
        status: 'completed',
        created_at: '2026-08-01T00:00:00Z',
        last_response:
          this.mode === 'async-job'
            ? { image: { type: 'base64', base64: pngForSeed(seed) } }
            : { tile_id: `tile-${seed}` },
      });
    }

    if (method === 'GET' && path.startsWith('/isometric-tiles/')) {
      const id = decodeURIComponent(path.slice('/isometric-tiles/'.length));
      this.tileGets.push(id);
      const seen = (this.tileReads.get(id) ?? 0) + 1;
      this.tileReads.set(id, seen);
      // 423 Locked = ainda processando, direto do spec.
      if (seen <= this.lockedReads) {
        throw new PixelLabError(`423 Locked (ainda gerando): ${path}`, 423, '', false);
      }
      const seed = Number(id.replace('tile-', ''));
      return this.ok<T>({ image: { type: 'base64', base64: pngForSeed(seed) } });
    }

    if (method === 'GET' && path.startsWith('/characters/')) {
      const urls: Record<string, string> = {};
      for (const d of DIRECTIONS) {
        if (!this.omitDirections.includes(d)) urls[d] = `https://fake.test/v3/${d}.png`;
      }
      return this.ok<T>({
        id: decodeURIComponent(path.slice('/characters/'.length)),
        status: 'completed',
        directions: 8,
        rotation_urls: urls,
      });
    }

    throw new Error(`FakeClient: chamada inesperada ${method} ${path}`);
  }

  get calls(): number {
    return this.tileBodies.length + this.v3Bodies.length + this.animBodies.length;
  }

  private ok<T>(data: unknown): ApiResult<T> {
    const usage = (data as { usage?: ApiResult<T>['usage'] }).usage;
    return {
      data: data as T,
      status: 200,
      raw: JSON.stringify(data),
      ...(usage ? { usage } : {}),
    };
  }
}

/**
 * Serve os downloads de rotation_urls sem rede. Restaurar SEMPRE (finally).
 * `failOnce`/`failAlways` simulam queda no meio do lote de downloads.
 */
function mockFetch(failOnce: Set<string> = new Set(), failAlways: Set<string> = new Set()): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const m = /\/v3\/([a-z-]+)\.png$/.exec(url);
    if (!m) return new Response('não conheço essa URL', { status: 404 });
    const dir = m[1]!;
    if (failAlways.has(dir)) return new Response('erro simulado', { status: 500 });
    if (failOnce.has(dir)) {
      failOnce.delete(dir);
      return new Response('erro simulado', { status: 500 });
    }
    return new Response(new Uint8Array(pngForDirection(dir)), { status: 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// ------------------------------------------------------------------ helpers

function tmpDir(): string {
  const dir = join(tmpdir(), `world-block-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function baseConfig(): WorldBlockConfig {
  return { description: 'grass on top of dirt', seed: 5 };
}

function rotatedConfig(): WorldBlockConfig {
  return { ...baseConfig(), technique: 'rotated' };
}

function textureConfig(): WorldBlockConfig {
  return { ...baseConfig(), technique: 'texture' };
}

/**
 * Sem ANTHROPIC_API_KEY, a ação da animação usa o fallback determinístico —
 * nenhuma rede nos testes. Restaura a chave original (finally).
 */
async function withFallbackAction<T>(run: () => Promise<T>): Promise<T> {
  const prev = process.env['ANTHROPIC_API_KEY'];
  delete process.env['ANTHROPIC_API_KEY'];
  try {
    return await run();
  } finally {
    if (prev !== undefined) process.env['ANTHROPIC_API_KEY'] = prev;
  }
}

function opts(dir: string, logs?: string[]) {
  return {
    assetsDir: join(dir, 'assets'),
    ledgerPath: join(dir, 'assets', 'ledger.ndjson'),
    ...(logs ? { onLog: (m: string) => logs.push(m) } : {}),
  };
}

function readLedger(dir: string): Array<Record<string, unknown>> {
  const path = join(dir, 'assets', 'ledger.ndjson');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function facePath(dir: string, hash: string, facing: string): string {
  return join(dir, 'assets', 'world-blocks', hash, `${facing}.png`);
}

function blockFile(dir: string, hash: string, ...rest: string[]): string {
  return join(dir, 'assets', 'world-blocks', hash, ...rest);
}

function readManifest(dir: string, hash: string): Record<string, unknown> {
  return JSON.parse(readFileSync(blockFile(dir, hash, 'block.json'), 'utf-8')) as Record<
    string,
    unknown
  >;
}

async function assertValidation(
  config: WorldBlockConfig,
  code: WorldBlockErrorCode,
): Promise<void> {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    await assert.rejects(runWorldBlock(client, config, opts(dir)), (err: unknown) => {
      assert.ok(
        err instanceof WorldBlockValidationError,
        `esperava WorldBlockValidationError, veio ${String(err)}`,
      );
      assert.equal(err.code, code);
      return true;
    });
    assert.equal(client.calls, 0, `validação ${code} não pode chamar a API`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ validação

test('description ausente ou vazia → description-required, sem chamada', async () => {
  await assertValidation({ ...baseConfig(), description: '' }, 'description-required');
  await assertValidation({ ...baseConfig(), description: '   ' }, 'description-required');
  await assertValidation({ seed: 5 } as WorldBlockConfig, 'description-required');
});

test('enums e faixas do spec fora → erros nomeados, sem chamada', async () => {
  await assertValidation({ ...baseConfig(), shape: 'cubo' as never }, 'shape-enum');
  await assertValidation({ ...baseConfig(), tileUnitSize: 24 as never }, 'tile-unit-size-enum');
  await assertValidation({ ...baseConfig(), outline: 'grosso' as never }, 'outline-enum');
  await assertValidation({ ...baseConfig(), shading: 'nenhum' as never }, 'shading-enum');
  await assertValidation({ ...baseConfig(), detail: 'muito' as never }, 'detail-enum');
  await assertValidation({ ...baseConfig(), textGuidanceScale: 0 }, 'guidance-range');
  await assertValidation({ ...baseConfig(), textGuidanceScale: 21 }, 'guidance-range');
  await assertValidation({ ...baseConfig(), seed: -1 }, 'seed-range');
  await assertValidation({ ...baseConfig(), technique: 'girado' as never }, 'technique-enum');
  await assertValidation({ ...baseConfig(), initImageStrength: 0 }, 'init-strength-range');
  await assertValidation({ ...baseConfig(), initImageStrength: 1000 }, 'init-strength-range');
  await assertValidation({ ...baseConfig(), frameCount: 6 as never }, 'frame-count-enum');
  await assertValidation({ ...baseConfig(), fps: 0 }, 'fps-range');
  await assertValidation({ ...baseConfig(), fps: 61 }, 'fps-range');
});

// ------------------------------------------------------------------ hash

test('a técnica entra no hash — chained, rotated e texture não compartilham cache', () => {
  const chained = worldBlockHash(baseConfig());
  const rotated = worldBlockHash(rotatedConfig());
  const texture = worldBlockHash(textureConfig());
  assert.notEqual(chained, rotated, 'são dois artefatos do mesmo prompt, comparáveis');
  assert.notEqual(chained, texture, 'texture é outro artefato do mesmo prompt');
  assert.notEqual(rotated, texture);
});

test('texture: frameCount, fps e action entram no hash; defaults explícitos não', () => {
  const t = textureConfig();
  assert.equal(worldBlockHash(t), worldBlockHash({ ...t, frameCount: 8 }));
  assert.equal(worldBlockHash(t), worldBlockHash({ ...t, fps: 8 }));
  assert.notEqual(worldBlockHash(t), worldBlockHash({ ...t, frameCount: 4 }));
  assert.notEqual(worldBlockHash(t), worldBlockHash({ ...t, fps: 4 }));
  assert.notEqual(worldBlockHash(t), worldBlockHash({ ...t, action: 'flowing' }));
});

/**
 * Os knobs de estilo do tile passaram a ser enviados na técnica 'texture'.
 * Mandar o default do endpoint produz a MESMA arte que omitir o campo — então
 * os dois têm de hashear igual, senão o mesmo artefato é comprado duas vezes.
 * Os defaults vêm do spec vendorizado (CreateIsometricTileRequest).
 */
test('texture: knob no default do endpoint hasheia igual a knob omitido', () => {
  const t = textureConfig();
  assert.equal(worldBlockHash(t), worldBlockHash({ ...t, textGuidanceScale: 8 }));
  assert.equal(worldBlockHash(t), worldBlockHash({ ...t, outline: 'lineless' }));
  assert.equal(worldBlockHash(t), worldBlockHash({ ...t, shading: 'basic shading' }));
  assert.equal(worldBlockHash(t), worldBlockHash({ ...t, detail: 'medium detail' }));
});

test('texture: knob FORA do default é outro artefato e tem outro hash', () => {
  const t = textureConfig();
  assert.notEqual(worldBlockHash(t), worldBlockHash({ ...t, textGuidanceScale: 14 }));
  assert.notEqual(worldBlockHash(t), worldBlockHash({ ...t, outline: 'selective outline' }));
  assert.notEqual(worldBlockHash(t), worldBlockHash({ ...t, shading: 'detailed shading' }));
  assert.notEqual(worldBlockHash(t), worldBlockHash({ ...t, detail: 'highly detailed' }));
});

test('default explícito e omitido têm o MESMO hash (não se paga duas vezes o mesmo request)', () => {
  const omitido = worldBlockHash(baseConfig());
  assert.equal(omitido, worldBlockHash({ ...baseConfig(), tileUnitSize: 16 }));
  assert.equal(omitido, worldBlockHash({ ...baseConfig(), textGuidanceScale: 8 }));
  assert.notEqual(omitido, worldBlockHash({ ...baseConfig(), tileUnitSize: 32 }));
  assert.notEqual(omitido, worldBlockHash({ ...baseConfig(), textGuidanceScale: 9 }));
});

// ------------------------------------------------------------------ técnica chained

test('chained: 4 gerações, norte PRIMEIRO com o molde, e o resultado dela nas outras', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const result = await runWorldBlock(client, baseConfig(), opts(dir));

    assert.equal(client.tileBodies.length, 4, 'toda geração tem 4 vistas');
    assert.equal(client.v3Bodies.length, 0);
    assert.equal(result.generated, 4);
    assert.equal(result.technique, 'chained');

    // Norte primeiro, com o MOLDE como init_image — acolchoado no canvas da
    // API (múltiplos de 4; o 48×53 cru falha com code 3006 no fornecedor).
    assert.equal(client.order[0], facingPrompt('grass on top of dirt', 'north'));
    const northBody = client.tileBodies[0]!;
    assert.deepEqual(
      northBody['init_image'],
      { type: 'base64', base64: padPngToApiCanvas(mouldBase64(), apiImageSize()) },
      'a norte nasce do molde do cubo, no canvas da API',
    );
    assert.equal(northBody['init_image_strength'], 480);
    assert.equal(northBody['color_image'], undefined, 'a primeira não tem paleta para travar');

    // As outras três recebem o RESULTADO da norte como molde E paleta.
    const northB64 = readFileSync(facePath(dir, result.hash, 'north')).toString('base64');
    const northApiB64 = padPngToApiCanvas(northB64, apiImageSize());
    for (const b of client.tileBodies.slice(1)) {
      assert.deepEqual(
        b['init_image'],
        { type: 'base64', base64: northApiB64 },
        'o resultado da norte É o molde das outras faces',
      );
      assert.deepEqual(b['color_image'], { type: 'base64', base64: northApiB64 });
    }

    // Cada vista tem seu prompt e sua arte.
    const prompts = new Set(client.tileBodies.map((b) => String(b['description'])));
    assert.equal(prompts.size, 4);
    for (const f of BLOCK_FACINGS) {
      assert.ok(prompts.has(facingPrompt('grass on top of dirt', f)), `prompt da ${f}`);
    }
    const bytes = BLOCK_FACINGS.map((f) =>
      readFileSync(facePath(dir, result.hash, f)).toString('base64'),
    );
    assert.equal(new Set(bytes).size, 4, '4 vistas = 4 artes distintas');

    // O canvas da API é o bounding box arredondado a múltiplos de 4 — nunca o
    // canônico cru (48×53 falha no fornecedor com code 3006).
    assert.deepEqual(client.tileBodies[0]!['image_size'], apiImageSize());
    assert.equal(apiImageSize().width % 4, 0);
    assert.equal(apiImageSize().height % 4, 0);
    assert.ok(apiImageSize().width >= BLOCK_GEOMETRY.spriteWidth);
    assert.ok(apiImageSize().height >= BLOCK_GEOMETRY.spriteHeight);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: segunda execução com a mesma config — ZERO submissões e fromCache', async () => {
  const dir = tmpDir();
  try {
    const first = await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));
    const client = new FakeClient();
    const second = await runWorldBlock(client, baseConfig(), opts(dir));

    assert.equal(client.calls, 0, 'gerar de novo com o mesmo spec não gasta nada');
    assert.equal(second.fromCache, true);
    assert.equal(second.generated, 0);
    assert.equal(second.hash, first.hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('canvas da API: acolchoa a múltiplos de 4 e o recorte devolve o quadro canônico intacto', () => {
  const frame = { width: BLOCK_GEOMETRY.spriteWidth, height: BLOCK_GEOMETRY.spriteHeight };
  const api = apiImageSize();

  const rgba = Buffer.alloc(frame.width * frame.height * 4);
  for (let i = 0; i < rgba.length; i += 1) rgba[i] = (i * 31 + 7) & 0xff;
  const canonical = encodePngFromRgba(rgba, frame.width, frame.height);

  // A ida emite RGBA CRU no canvas da API — é o que `Image.frombytes` do
  // backend espera; um PNG aqui derruba o job com "Expected image of size".
  const padded = Buffer.from(padPngToApiCanvas(canonical.toString('base64'), api), 'base64');
  assert.equal(padded.length, api.width * api.height * 4, 'RGBA cru, nunca PNG');

  // A API devolve os pixels CRUS do canvas DELA — a volta tem de ser a
  // inversa exata da ida.
  const cropped = apiBytesToCanonicalPng(padded, api, frame);
  const back = readPngHeader(cropped);
  assert.equal(back.width, frame.width);
  assert.equal(back.height, frame.height);
  assert.deepEqual(decodePngToRgba(cropped).data, rgba, 'ida e volta sem perder um byte');
});

test('fornecedor recusando init/color (estado 2026-08-01) → resubmete sem imagens e completa', async () => {
  const dir = tmpDir();
  try {
    const logs: string[] = [];
    const client = new FakeClient();
    client.rejectImageInputs = true;
    const result = await runWorldBlock(client, baseConfig(), opts(dir, logs));

    assert.equal(result.generated, 4, 'as 4 vistas saem mesmo com o fornecedor recusando imagem');
    assert.equal(client.tileBodies.length, 4, 'o 422 síncrono não conta como submissão');
    for (const b of client.tileBodies) {
      assert.ok(!('init_image' in b), 'o fallback remove o init_image');
      assert.ok(!('color_image' in b), 'o fallback remove o color_image');
      assert.ok(!('init_image_strength' in b));
    }
    assert.ok(
      logs.some((l) => l.includes('recusou init_image')),
      'o aviso do fallback é gritante no log',
    );
    for (const f of BLOCK_FACINGS) {
      assert.ok(existsSync(facePath(dir, result.hash, f)), `face ${f} em disco`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: apagar UMA face regenera só ela, encadeada na norte que está em disco', async () => {
  const dir = tmpDir();
  try {
    const first = await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));
    rmSync(facePath(dir, first.hash, 'east'), { force: true });

    const client = new FakeClient();
    await runWorldBlock(client, baseConfig(), opts(dir));
    assert.equal(client.tileBodies.length, 1, 'só a face que sumiu volta a custar');
    assert.equal(client.tileBodies[0]?.['description'], facingPrompt('grass on top of dirt', 'east'));
    const northB64 = readFileSync(facePath(dir, first.hash, 'north')).toString('base64');
    assert.deepEqual(client.tileBodies[0]?.['init_image'], {
      type: 'base64',
      base64: padPngToApiCanvas(northB64, apiImageSize()),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: north.png sumido com irmãs em disco avisa que o encadeamento quebrou', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  try {
    const first = await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));
    rmSync(facePath(dir, first.hash, 'north'), { force: true });

    const client = new FakeClient();
    await runWorldBlock(client, baseConfig(), opts(dir, logs));
    assert.equal(client.tileBodies.length, 1, 'só a norte é regenerada — regenerar as irmãs custaria 3 gerações sem ninguém pedir');
    assert.ok(
      logs.some((l) => l.includes('irmãs') && l.includes('aviso')),
      'o usuário tem que ficar sabendo que o bloco pode ter ficado incoerente',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: manifesto de retomada parcial NÃO perde o tile_id das faces que ficaram', async () => {
  const dir = tmpDir();
  try {
    const client1 = new FakeClient();
    client1.mode = 'async-tile';
    const first = await runWorldBlock(client1, baseConfig(), opts(dir));
    assert.equal((readManifest(dir, first.hash)['faces'] as Array<Record<string, unknown>>)[0]?.['tileId'], 'tile-5');

    // Regenera só a leste, em modo síncrono (sem tile_id novo).
    rmSync(facePath(dir, first.hash, 'east'), { force: true });
    await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));

    const faces = readManifest(dir, first.hash)['faces'] as Array<Record<string, unknown>>;
    const north = faces.find((f) => f['facing'] === 'north');
    assert.equal(north?.['tileId'], 'tile-5', 'a norte não foi tocada — o caminho de volta fica');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: falha DEPOIS da cobrança deixa stub, e a retomada busca o tile pago sem re-submeter', async () => {
  const dir = tmpDir();
  try {
    const client1 = new FakeClient();
    client1.mode = 'async-tile';
    client1.failTileJobs = 1;
    await assert.rejects(runWorldBlock(client1, baseConfig(), opts(dir)));
    assert.equal(client1.tileBodies.length, 1, 'a norte foi submetida (e cobrada) uma vez');

    const hash = worldBlockHash(baseConfig());
    const stub = JSON.parse(
      readFileSync(`${facePath(dir, hash, 'north')}.pending.json`, 'utf-8'),
    ) as Record<string, unknown>;
    assert.equal(stub['tileId'], 'tile-5', 'o caminho de volta fica em disco na hora da submissão');

    const client2 = new FakeClient();
    client2.mode = 'async-tile';
    const second = await runWorldBlock(client2, baseConfig(), opts(dir));
    assert.ok(client2.tileGets.includes('tile-5'), 'a retomada busca o tile pago por id');
    assert.equal(
      client2.tileBodies.filter((b) => String(b['description']).includes('north')).length,
      0,
      'a norte NÃO é re-submetida — re-pagar o que já foi pago é o pior bug deste sistema',
    );
    assert.equal(client2.tileBodies.length, 3, 'só as três irmãs restantes são novas');
    assert.equal(
      readFileSync(facePath(dir, second.hash, 'north')).toString('base64'),
      pngForSeed(5),
      'o PNG veio do tile pago original',
    );
    assert.ok(!existsSync(`${facePath(dir, hash, 'north')}.pending.json`), 'stub some após o resgate');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ formas de resposta

for (const mode of ['sync', 'async-job', 'async-tile'] as const) {
  test(`resposta ${mode} → mesmo PNG em disco (o status HTTP não diz se é assíncrono)`, async () => {
    const dir = tmpDir();
    try {
      const client = new FakeClient();
      client.mode = mode;
      const result = await runWorldBlock(client, baseConfig(), opts(dir));
      assert.equal(
        readFileSync(facePath(dir, result.hash, 'north')).toString('base64'),
        pngForSeed(5),
        `a forma ${mode} tem que entregar o mesmo PNG`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('423 Locked no GET do tile é "ainda processando", não erro', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    client.mode = 'async-tile';
    client.lockedReads = 1;
    const result = await runWorldBlock(client, baseConfig(), opts(dir));
    assert.ok(existsSync(facePath(dir, result.hash, 'north')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ técnica rotated

test('rotated: 1 tile (source com o molde) + 1 v3, 8 direções em v3/, 4 faces no quadro 48×53', async () => {
  const dir = tmpDir();
  const restore = mockFetch();
  try {
    const client = new FakeClient();
    const result = await runWorldBlock(client, rotatedConfig(), opts(dir));

    assert.equal(client.tileBodies.length, 1, 'um tile só: a source');
    assert.equal(client.v3Bodies.length, 1, 'um v3 só: as 8 direções');
    assert.equal(result.generated, 2);
    assert.equal(result.technique, 'rotated');

    // A source nasce do molde, como na chained — acolchoado no canvas da API.
    assert.deepEqual(client.tileBodies[0]!['init_image'], {
      type: 'base64',
      base64: padPngToApiCanvas(mouldBase64(), apiImageSize()),
    });
    assert.ok(existsSync(blockFile(dir, result.hash, 'source.png')));

    // O v3 recebe a source como reference_image, na vista do projeto.
    const sourceB64 = readFileSync(blockFile(dir, result.hash, 'source.png')).toString('base64');
    const v3 = client.v3Bodies[0]!;
    assert.deepEqual(v3['reference_image'], { type: 'base64', base64: sourceB64 });
    assert.equal(v3['view'], 'low top-down');
    assert.equal(v3['no_background'], true);

    // As 8 direções ficam em disco — imagens separadas, nada de GIF.
    for (const d of DIRECTIONS) {
      assert.ok(existsSync(blockFile(dir, result.hash, 'v3', `${d}.png`)), `v3/${d}.png`);
    }

    // As 4 faces existem NO QUADRO CANÔNICO 48×53 — o mesmo contrato de pixel
    // da técnica chained. Quadro quadrado desenharia o bloco a ~90% da célula.
    for (const f of BLOCK_FACINGS) {
      const head = readPngHeader(readFileSync(facePath(dir, result.hash, f)));
      assert.equal(head.width, BLOCK_GEOMETRY.spriteWidth, `largura da ${f}`);
      assert.equal(head.height, BLOCK_GEOMETRY.spriteHeight, `altura da ${f}`);
    }
    const faces = BLOCK_FACINGS.map((f) =>
      readFileSync(facePath(dir, result.hash, f)).toString('base64'),
    );
    assert.equal(new Set(faces).size, 4, '4 vistas distintas também aqui');

    // Ledger: as duas submissões, com o caminho de volta ao artefato pago.
    const lines = readLedger(dir);
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.['endpoint'], 'create-isometric-tile');
    assert.equal(lines[1]?.['endpoint'], 'create-character-v3');
    assert.equal(lines[1]?.['remoteId'], 'char-6', 'character_id no ledger');

    // Manifesto: source + character + mapeamento registrados.
    const manifest = readManifest(dir, result.hash);
    assert.equal(manifest['version'], 2);
    assert.equal(manifest['technique'], 'rotated');
    assert.equal((manifest['character'] as Record<string, unknown>)['id'], 'char-6');
    assert.ok(manifest['source'], 'a source de tile fica registrada');
    assert.equal(
      manifest['v3Mapping'],
      BLOCK_FACINGS.map((f) => FACING_TO_V3_DIRECTION[f]).join(','),
    );
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: faces apagadas com v3/ em disco rederivam DE GRAÇA — zero chamadas', async () => {
  const dir = tmpDir();
  const restore = mockFetch();
  try {
    const first = await runWorldBlock(new FakeClient(), rotatedConfig(), opts(dir));
    for (const f of BLOCK_FACINGS) rmSync(facePath(dir, first.hash, f), { force: true });

    const client = new FakeClient();
    const second = await runWorldBlock(client, rotatedConfig(), opts(dir));
    assert.equal(client.calls, 0, 'rederivar de v3/ não pode tocar a rede');
    assert.equal(second.fromCache, true);
    for (const f of BLOCK_FACINGS) assert.ok(existsSync(facePath(dir, first.hash, f)));
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: falha no download deixa o stub do v3, e a retomada NÃO paga outro v3', async () => {
  const dir = tmpDir();
  const eastDir = FACING_TO_V3_DIRECTION.east;
  const restoreFail = mockFetch(new Set([eastDir]));
  try {
    const client1 = new FakeClient();
    await assert.rejects(
      runWorldBlock(client1, rotatedConfig(), opts(dir)),
      new RegExp(eastDir),
      'direção necessária que falha derruba a execução',
    );
    assert.equal(client1.v3Bodies.length, 1, 'o v3 foi submetido (e cobrado) uma vez');
    const hash = worldBlockHash(rotatedConfig());
    assert.ok(
      existsSync(blockFile(dir, hash, 'v3', 'character.json')),
      'o stub com o character_id fica em disco na hora da submissão',
    );

    restoreFail();
    const restoreOk = mockFetch();
    try {
      const client2 = new FakeClient();
      const second = await runWorldBlock(client2, rotatedConfig(), opts(dir));
      assert.equal(client2.calls, 0, 'a retomada busca o personagem pago de graça — nenhum POST');
      assert.equal(second.generated, 0);
      for (const f of BLOCK_FACINGS) assert.ok(existsSync(facePath(dir, hash, f)));
      assert.equal(
        (readManifest(dir, hash)['character'] as Record<string, unknown>)['id'],
        'char-6',
        'o personagem retomado fica registrado no manifesto',
      );
      assert.ok(
        !existsSync(blockFile(dir, hash, 'v3', 'character.json')),
        'stub some depois de as direções chegarem',
      );
    } finally {
      restoreOk();
    }
  } finally {
    restoreFail();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: falha de download em direção NÃO usada não derruba o v3 pago', async () => {
  const dir = tmpDir();
  const restore = mockFetch(new Set(), new Set(['south-west']));
  try {
    const client = new FakeClient();
    const result = await runWorldBlock(client, rotatedConfig(), opts(dir));
    assert.equal(result.generated, 2);
    for (const f of BLOCK_FACINGS) assert.ok(existsSync(facePath(dir, result.hash, f)));
    assert.ok(
      !existsSync(blockFile(dir, result.hash, 'v3', 'south-west.png')),
      'a direção que falhou fica de fora, sem derrubar a execução',
    );
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: direção necessária ausente de rotation_urls é erro explícito', async () => {
  const dir = tmpDir();
  const restore = mockFetch();
  try {
    const client = new FakeClient();
    client.omitDirections = [FACING_TO_V3_DIRECTION.east];
    await assert.rejects(
      runWorldBlock(client, rotatedConfig(), opts(dir)),
      new RegExp(FACING_TO_V3_DIRECTION.east),
    );
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: manifesto e source apagados com as 4 faces em disco NÃO geram tile órfão', async () => {
  const dir = tmpDir();
  const restore = mockFetch();
  try {
    const first = await runWorldBlock(new FakeClient(), rotatedConfig(), opts(dir));
    rmSync(blockFile(dir, first.hash, 'block.json'), { force: true });
    rmSync(blockFile(dir, first.hash, 'source.png'), { force: true });

    const client = new FakeClient();
    const second = await runWorldBlock(client, rotatedConfig(), opts(dir));
    assert.equal(client.calls, 0, 'uma source que ninguém consome seria custo surpresa');
    assert.equal(second.fromCache, true);
    assert.ok(existsSync(blockFile(dir, first.hash, 'block.json')), 'o manifesto volta');
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: mapeamento diferente no manifesto invalida a leitura e rederiva de graça', async () => {
  const dir = tmpDir();
  const restore = mockFetch();
  try {
    const first = await runWorldBlock(new FakeClient(), rotatedConfig(), opts(dir));
    const assets = join(dir, 'assets');

    // Simula um flip de FACING_TO_V3_DIRECTION feito DEPOIS desta derivação.
    const manifest = readManifest(dir, first.hash);
    writeFileSync(
      blockFile(dir, first.hash, 'block.json'),
      `${JSON.stringify({ ...manifest, v3Mapping: 'south,west,north,east' }, null, 2)}\n`,
    );

    assert.equal(
      await readWorldBlockResult(first.hash, assets),
      null,
      'faces derivadas com OUTRO mapeamento não podem passar por prontas',
    );

    const client = new FakeClient();
    const second = await runWorldBlock(client, rotatedConfig(), opts(dir));
    assert.equal(client.calls, 0, 'rederivar por flip de mapeamento não custa nada');
    assert.equal(second.faces.length, 4);
    assert.equal(
      readManifest(dir, first.hash)['v3Mapping'],
      BLOCK_FACINGS.map((f) => FACING_TO_V3_DIRECTION[f]).join(','),
      'o manifesto passa a registrar o mapeamento vigente',
    );
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------ normalização do prompt

/**
 * O usuário deste editor escreve em português e conversando. Os dois blocos
 * pagos em disco provam: "bloco de gero" e "quero um cubo de ossos" — o
 * segundo carrega o PEDIDO, não o material. Isso ia inteiro para o fornecedor.
 *
 * O que se prova aqui é o PISO: o fallback determinístico, que roda sem
 * ANTHROPIC_API_KEY e sem tocar a rede. Com chave quem normaliza é o LLM, e
 * essa aresta não tem teste porque testá-la exigiria rede.
 */
test('fallbackMaterial tira os verbos de pedido em português', () => {
  assert.equal(fallbackMaterial('quero um cubo de ossos'), 'bone');
  assert.equal(fallbackMaterial('gera um bloco de pedra'), 'stone');
  assert.equal(fallbackMaterial('faz um cubo de madeira'), 'wood');
  assert.equal(fallbackMaterial('cria uma textura de grama'), 'grass');
  assert.equal(fallbackMaterial('por favor, me dê um bloco de gelo'), 'ice');
  assert.equal(fallbackMaterial('um bloco de areia'), 'sand');
});

/**
 * O defeito que este teste tranca: em JavaScript `\w` — e portanto `\b` — é
 * `[A-Za-z0-9_]` mesmo com a flag `u`. Numa string que COMEÇA com 'á' não há
 * fronteira de palavra antes do 'á', então `/\b[áa]gua\b/i.test('água')` era
 * `false` e "água" — a palavra que a própria UI usa de exemplo — nunca virava
 * "water". Só falhavam as entradas cuja alternativa começa com acento; as que
 * começam com ASCII ("mármore", "chão") casavam, o que escondia o buraco.
 *
 * Prova nos DOIS sentidos (com e sem acento) e nas TRÊS posições (início, meio
 * e fim da string).
 */
test('fallbackMaterial traduz palavra acentuada em qualquer posição', () => {
  // A palavra acentuada é a string inteira — o caso que `\b` derrubava.
  assert.equal(fallbackMaterial('água'), 'water');
  assert.equal(fallbackMaterial('árvore'), 'tree bark');
  // A mesma palavra sem acento continua funcionando.
  assert.equal(fallbackMaterial('agua'), 'water');
  assert.equal(fallbackMaterial('arvore'), 'tree bark');
  // No fim da string, depois do rodeio em português.
  assert.equal(fallbackMaterial('bloco de água'), 'water');
  assert.equal(fallbackMaterial('quero um cubo de árvore'), 'tree bark');
  // No meio da string.
  assert.equal(fallbackMaterial('bloco de água parada'), 'water parada');
  // Entradas acentuadas que já casavam antes (a alternativa começa com ASCII)
  // seguem casando — a correção do mecanismo não regrediu nenhuma.
  assert.equal(fallbackMaterial('bloco de mármore'), 'marble');
  assert.equal(fallbackMaterial('bloco de aço'), 'steel');
  assert.equal(fallbackMaterial('bloco de carvão'), 'coal');
  assert.equal(fallbackMaterial('chão'), 'dirt');
});

test('fallbackMaterial preserva os acentos do que NÃO está no glossário', () => {
  // O casamento é no texto sem acento; o recorte é no texto original. Palavra
  // fora do glossário sai daqui como o usuário digitou.
  assert.equal(fallbackMaterial('bloco de pedra vulcânica'), 'stone vulcânica');
});

test('fallbackMaterial não estraga descrição que já está em inglês', () => {
  assert.equal(fallbackMaterial('grass on top of dirt'), 'grass on top of dirt');
  assert.equal(fallbackMaterial('  mossy cobblestone  '), 'mossy cobblestone');
  // "tile" é palavra dos dois idiomas. Em inglês ela é o SUJEITO da frase, e a
  // regra que remove a palavra da forma devolvia "of grass".
  assert.equal(fallbackMaterial('tile of grass'), 'tile of grass');
  assert.equal(fallbackMaterial('block with moss on it'), 'block with moss on it');
});

/**
 * Em português o adjetivo vem depois do substantivo; em inglês, antes. Até
 * 2026-08-04 "pedra musgosa" saía como "stone moss" — que em inglês nomeia um
 * líquen, não pedra com musgo — e o teste congelava isso como correto sob o
 * nome "preserva adjetivos".
 */
test('fallbackMaterial põe o adjetivo antes do substantivo, como em inglês', () => {
  assert.equal(fallbackMaterial('quero um bloco de pedra musgosa'), 'mossy stone');
  assert.equal(fallbackMaterial('bloco de terra molhada'), 'wet dirt');
  assert.equal(fallbackMaterial('cubo de madeira velha'), 'old wood');
  // O substantivo "musgo" continua sendo "moss": só a forma ADJETIVA vira
  // "mossy".
  assert.equal(fallbackMaterial('bloco de musgo'), 'moss');
});

test('fallbackMaterial devolve o original quando sobraria vazio ou só resíduo', () => {
  // Só o pedido, sem material nenhum: perder tudo seria pior que mandar o
  // texto original.
  assert.equal(fallbackMaterial('quero um bloco'), 'quero um bloco');
  // O resíduo era a preposição solta "de", que virava o `description` do
  // request mandado ao fornecedor.
  assert.equal(fallbackMaterial('um bloco de'), 'um bloco de');
  assert.equal(fallbackMaterial('bloco'), 'bloco');
  assert.equal(fallbackMaterial('   '), '');
});

/**
 * O caminho do LLM corta o material em 200 caracteres. O determinístico não
 * cortava em nada, e a MESMA descrição rendia prompts de tamanhos diferentes
 * conforme houvesse ou não `ANTHROPIC_API_KEY` no ambiente.
 */
test('fallbackMaterial corta no mesmo teto do caminho do LLM', () => {
  const longo = `quero um bloco de pedra ${'muito '.repeat(80)}antiga`;
  assert.ok(longo.length > MATERIAL_MAX_LEN);
  assert.ok(fallbackMaterial(longo).length <= MATERIAL_MAX_LEN);
  // O caminho do resíduo (devolve o original) também respeita o teto.
  const soPedido = `quero um bloco ${'de '.repeat(200)}`.trim();
  assert.ok(soPedido.length > MATERIAL_MAX_LEN);
  assert.ok(fallbackMaterial(soPedido).length <= MATERIAL_MAX_LEN);
});

test('fallbackMaterial é puro — mesma entrada, mesma saída, sem rede', () => {
  const entrada = 'quero um cubo de ossos';
  assert.equal(fallbackMaterial(entrada), fallbackMaterial(entrada));
});

test('actionWithMaterial costura o material na ação — e não repete o que já está lá', () => {
  assert.equal(
    actionWithMaterial('subtle ambient motion', 'bone'),
    'subtle ambient motion, on a pixel art cube made of bone',
  );
  // Já nomeado: repetir o substantivo não guia melhor.
  assert.equal(
    actionWithMaterial('bone surface shimmering slowly', 'bone'),
    'bone surface shimmering slowly',
  );
  // Sem material, a ação passa intacta.
  assert.equal(actionWithMaterial('water rippling', '  '), 'water rippling');
});

test('cubePrompt só cita a imagem de referência quando existe referência', () => {
  const com = cubePrompt('bone', { hasReference: true });
  const sem = cubePrompt('bone');
  assert.match(com, /matching the exact shape and proportions of the reference image/);
  assert.doesNotMatch(sem, /reference image/);
  // A literal `pixel art cube` é contrato do FakeClient — nas duas formas.
  assert.match(com, /pixel art cube/);
  assert.match(sem, /pixel art cube/);
  assert.match(sem, /low top-down view/);
  assert.equal(sem, 'bone, pixel art cube, isometric block, low top-down view');
});

// ------------------------------------------------------------------ técnica texture

test('texture: 1 cubo via create-isometric-tile com o molde + 1 animate-with-text-v3', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const result = await withFallbackAction(() =>
      runWorldBlock(client, textureConfig(), opts(dir)),
    );

    assert.equal(client.tileBodies.length, 1, 'o cubo base é o único tile');
    assert.equal(client.animBodies.length, 1, 'uma animação só');
    assert.equal(result.generated, 2);
    assert.equal(result.technique, 'texture');
    assert.equal(result.faces.length, 0, 'texture não tem faces por vista');

    // O cubo nasce do MOLDE, no canvas da API, na força do spec e shape 'block'.
    // Com molde no request, a frase da referência FAZ sentido e vai junto.
    const tile = client.tileBodies[0]!;
    assert.equal(tile['description'], cubePrompt('grass on top of dirt', { hasReference: true }));
    assert.match(String(tile['description']), /pixel art cube/);
    assert.match(String(tile['description']), /low top-down view/);
    assert.match(String(tile['description']), /reference image/);
    assert.deepEqual(tile['image_size'], apiImageSize());
    assert.equal(tile['isometric_tile_shape'], 'block');
    assert.deepEqual(tile['init_image'], {
      type: 'base64',
      base64: padPngToApiCanvas(mouldBase64(), apiImageSize()),
    });
    assert.equal(tile['init_image_strength'], 300, 'o default do spec, não o 480 do chained');
    assert.equal(tile['text_guidance_scale'], 8, 'vai SEMPRE, ainda que no default');
    assert.equal(tile['seed'], 6, 'base + 1');
    assert.equal(tile['color_image'], undefined, 'sem paleta a travar');

    // O RGBA cru do endpoint recorta para o quadro canônico 48×53.
    const base = readPngHeader(readFileSync(blockFile(dir, result.hash, 'base.png')));
    assert.equal(base.width, BLOCK_GEOMETRY.spriteWidth, 'base.png largura canônica');
    assert.equal(base.height, BLOCK_GEOMETRY.spriteHeight, 'base.png altura canônica');

    // A animação recebe o cubo como first_frame.
    const anim = client.animBodies[0]!;
    assert.deepEqual(anim['first_frame'], {
      type: 'base64',
      base64: readFileSync(blockFile(dir, result.hash, 'base.png')).toString('base64'),
    });
    assert.equal(anim['frame_count'], 8, 'default 8');
    assert.equal(anim['seed'], 7, 'base + 2');

    // Spritesheet no quadro REAL do frame (48×53), 4 frames + sidecar + v3.
    const sheet = readPngHeader(readFileSync(blockFile(dir, result.hash, 'spritesheet.png')));
    assert.equal(sheet.width, BLOCK_GEOMETRY.spriteWidth * 4, 'tira horizontal de 4 frames');
    assert.equal(
      sheet.height,
      BLOCK_GEOMETRY.spriteHeight,
      'a folha tem a altura REAL do frame — 48 fixo cortava a base do cubo',
    );
    const sidecar = JSON.parse(
      readFileSync(blockFile(dir, result.hash, 'animation.json'), 'utf-8'),
    ) as Record<string, unknown>;
    assert.equal(sidecar['frameCount'], 4, 'frameCount real vem dos frames');
    assert.equal(sidecar['fps'], 8);
    assert.match(String(sidecar['action']), /grass swaying/, 'ação do fallback sem LLM');
    assert.match(
      String(sidecar['action']),
      /pixel art cube made of grass on top of dirt/,
      'o material vai DENTRO da ação — é o único texto que o animate vê',
    );

    const manifest = readManifest(dir, result.hash);
    assert.equal(manifest['version'], 3);
    assert.equal(manifest['technique'], 'texture');
    assert.equal((manifest['base'] as Record<string, unknown>)['seed'], 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('texture: fornecedor recusando o molde (estado 2026-08-01) → cubo sem referência, e completa', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  try {
    const client = new FakeClient();
    client.rejectImageInputs = true;
    const result = await withFallbackAction(() =>
      runWorldBlock(client, textureConfig(), opts(dir, logs)),
    );

    assert.equal(result.generated, 2, 'cubo + animação saem mesmo sem o molde');
    assert.equal(client.tileBodies.length, 1, 'o 422 síncrono não conta como submissão');
    assert.ok(!('init_image' in client.tileBodies[0]!), 'o fallback remove o init_image');
    assert.ok(!('init_image_strength' in client.tileBodies[0]!));
    assert.ok(logs.some((l) => l.includes('recusou o molde')), 'o aviso é gritante no log');

    // O prompt ainda pede o cubo, e o RGBA cru ainda recorta para 48×53.
    const semMolde = String(client.tileBodies[0]!['description']);
    assert.match(semMolde, /pixel art cube/);
    // A frase da referência SAI junto com a referência: sem init_image no
    // request, mandar o modelo casar com "a imagem de referência" é apontar
    // para o nada — e competir com o material que o usuário pediu.
    assert.doesNotMatch(
      semMolde,
      /reference image/,
      'sem molde no request, a frase da referência não pode ficar pendurada',
    );
    assert.equal(semMolde, cubePrompt('grass on top of dirt'));
    const base = readPngHeader(readFileSync(blockFile(dir, result.hash, 'base.png')));
    assert.equal(base.width, BLOCK_GEOMETRY.spriteWidth);
    assert.equal(base.height, BLOCK_GEOMETRY.spriteHeight);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('texture: segunda execução com a mesma config — ZERO submissões e fromCache', async () => {
  const dir = tmpDir();
  try {
    const first = await withFallbackAction(() =>
      runWorldBlock(new FakeClient(), textureConfig(), opts(dir)),
    );
    const client = new FakeClient();
    const second = await withFallbackAction(() =>
      runWorldBlock(client, textureConfig(), opts(dir)),
    );

    assert.equal(client.calls, 0, 'gerar de novo com o mesmo spec não gasta nada');
    assert.equal(second.fromCache, true);
    assert.equal(second.generated, 0);
    assert.equal(second.hash, first.hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('texture: falha DEPOIS da cobrança do cubo deixa stub, e a retomada não re-submete o tile', async () => {
  const dir = tmpDir();
  try {
    const client1 = new FakeClient();
    client1.mode = 'async-tile';
    client1.failTileJobs = 1;
    await assert.rejects(
      withFallbackAction(() => runWorldBlock(client1, textureConfig(), opts(dir))),
      'o job do cubo falhou depois da cobrança e derruba a execução',
    );
    assert.equal(client1.tileBodies.length, 1, 'o cubo foi submetido (e cobrado) uma vez');
    assert.equal(client1.animBodies.length, 0, 'a animação nem chegou a ser submetida');

    const hash = worldBlockHash(textureConfig());
    const stub = JSON.parse(
      readFileSync(blockFile(dir, hash, 'base.png.pending.json'), 'utf-8'),
    ) as Record<string, unknown>;
    assert.equal(stub['tileId'], 'tile-6', 'o caminho de volta fica em disco na hora da submissão');

    const client2 = new FakeClient();
    client2.mode = 'async-tile';
    const second = await withFallbackAction(() =>
      runWorldBlock(client2, textureConfig(), opts(dir)),
    );
    assert.ok(client2.tileGets.includes('tile-6'), 'a retomada busca o cubo pago por id');
    assert.equal(client2.tileBodies.length, 0, 'o cubo NÃO é re-submetido — re-pagar o pago é o pior bug');
    assert.equal(client2.animBodies.length, 1, 'só a animação é nova');
    assert.equal(second.generated, 1, 'o cubo retomado não conta como gasto');
    assert.ok(existsSync(blockFile(dir, hash, 'base.png')), 'o cubo recuperado chega ao disco');
    assert.ok(
      !existsSync(blockFile(dir, hash, 'base.png.pending.json')),
      'stub some após o resgate',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('texture: a descrição em português vira material em inglês antes de sair', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  try {
    const client = new FakeClient();
    const config: WorldBlockConfig = {
      ...textureConfig(),
      description: 'quero um cubo de ossos',
    };
    const result = await withFallbackAction(() => runWorldBlock(client, config, opts(dir, logs)));

    // O que chega ao /create-isometric-tile é o MATERIAL, não o pedido.
    const enviado = String(client.tileBodies[0]!['description']);
    assert.equal(enviado, cubePrompt('bone', { hasReference: true }));
    assert.doesNotMatch(enviado, /quero/, 'o verbo de pedido não chega ao fornecedor');
    assert.doesNotMatch(enviado, /ossos/, 'o português não chega ao fornecedor');

    // E o material chega TAMBÉM ao animate-with-text-v3, que só vê `action`.
    const acao = String(client.animBodies[0]!['action']);
    assert.match(acao, /bone/, 'o material tem de estar na ação — é o único texto que ela vê');

    // O manifesto guarda os dois: o que foi digitado e o que foi pedido.
    const manifest = readManifest(dir, result.hash);
    assert.equal(manifest['description'], 'quero um cubo de ossos', 'o texto do usuário fica');
    assert.equal(manifest['material'], 'bone', 'e o que foi de fato pedido também');
    assert.ok(
      logs.some((l) => l.includes('normalizada por regra')),
      'sem chave de LLM o log diz que a normalização foi por regra',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('texture: outline, shading, detail e text_guidance_scale chegam ao create-isometric-tile', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const config: WorldBlockConfig = {
      ...textureConfig(),
      textGuidanceScale: 14,
      outline: 'selective outline',
      shading: 'detailed shading',
      detail: 'highly detailed',
    };
    await withFallbackAction(() => runWorldBlock(client, config, opts(dir)));

    const tile = client.tileBodies[0]!;
    assert.equal(tile['text_guidance_scale'], 14);
    assert.equal(tile['outline'], 'selective outline');
    assert.equal(tile['shading'], 'detailed shading');
    assert.equal(tile['detail'], 'highly detailed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('texture: knob não configurado NÃO é enviado — o default é do fornecedor', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    await withFallbackAction(() => runWorldBlock(client, textureConfig(), opts(dir)));

    const tile = client.tileBodies[0]!;
    assert.ok(!('outline' in tile), 'omitido é omitido — não vira palpite nosso');
    assert.ok(!('shading' in tile));
    assert.ok(!('detail' in tile));
    // text_guidance_scale é a exceção declarada: vai sempre, no default do spec.
    assert.equal(tile['text_guidance_scale'], 8);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * O laço de cópia antigo usava passo `y * 48 * 4` na ORIGEM. Com um frame de
 * largura diferente de 48 isso lê a linha errada a cada iteração e cisalha a
 * folha inteira — arte paga, destruída em silêncio. O passo agora é a largura
 * real de cada frame.
 */
test('texture: frames de tamanho inesperado não cisalham a folha', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  try {
    const client = new FakeClient();
    client.animFrameWidth = 64;
    client.animFrameHeight = 40;
    const result = await withFallbackAction(() =>
      runWorldBlock(client, textureConfig(), opts(dir, logs)),
    );

    const sheet = readPngHeader(readFileSync(blockFile(dir, result.hash, 'spritesheet.png')));
    assert.equal(sheet.width, 64 * 4, 'o quadro sai do frame decodificado, não de um 48 fixo');
    assert.equal(sheet.height, 40);

    const atlas = JSON.parse(
      readFileSync(blockFile(dir, result.hash, 'spritesheet.json'), 'utf-8'),
    ) as { frames: Record<string, { frame: { w: number; h: number; x: number } }> };
    assert.equal(atlas.frames['frame_000']!.frame.w, 64);
    assert.equal(atlas.frames['frame_000']!.frame.h, 40);
    assert.equal(atlas.frames['frame_001']!.frame.x, 64, 'o próximo frame começa no quadro real');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('texture: no_background e enhance_prompt vão ao animate-with-text-v3; enhanced_prompt cai no sidecar e no manifesto', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    client.animEnhancedPrompt = 'richer motion description';
    const result = await withFallbackAction(() =>
      runWorldBlock(client, textureConfig(), opts(dir)),
    );

    const anim = client.animBodies[0]!;
    assert.equal(anim['no_background'], true, 'frames com fundo transparente');
    assert.equal(anim['enhance_prompt'], true, 'enhance_prompt default true');

    const sidecar = JSON.parse(
      readFileSync(blockFile(dir, result.hash, 'animation.json'), 'utf-8'),
    ) as Record<string, unknown>;
    assert.equal(sidecar['enhancePrompt'], true);
    assert.equal(sidecar['pingPong'], true);
    assert.equal(sidecar['enhancedPrompt'], 'richer motion description');

    const manifest = readManifest(dir, result.hash);
    assert.equal(manifest['animated'], true);
    assert.equal(manifest['pingPong'], true);
    assert.equal(manifest['enhancedPrompt'], 'richer motion description');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('texture: enhance_prompt:false e pingPong:false são respeitados e mudam o hash', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const result = await withFallbackAction(() =>
      runWorldBlock(
        client,
        { ...textureConfig(), enhancePrompt: false, pingPong: false },
        opts(dir),
      ),
    );
    const anim = client.animBodies[0]!;
    assert.equal(anim['enhance_prompt'], false);

    const sidecar = JSON.parse(
      readFileSync(blockFile(dir, result.hash, 'animation.json'), 'utf-8'),
    ) as Record<string, unknown>;
    assert.equal(sidecar['pingPong'], false);
    assert.equal(sidecar['enhancePrompt'], false);
    assert.equal(sidecar['enhancedPrompt'], undefined, 'sem enhanced_prompt quando desligado');

    assert.notEqual(
      worldBlockHash(textureConfig()),
      worldBlockHash({ ...textureConfig(), pingPong: false }),
    );
    assert.notEqual(
      worldBlockHash(textureConfig()),
      worldBlockHash({ ...textureConfig(), enhancePrompt: false }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('texture: frameCount 0 — só o cubo base, sem animate-with-text-v3; manifesto animated:false e baseUrl no catálogo', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const result = await withFallbackAction(() =>
      runWorldBlock(client, { ...textureConfig(), frameCount: 0 }, opts(dir)),
    );

    assert.equal(client.tileBodies.length, 1, 'o cubo base é gerado');
    assert.equal(client.animBodies.length, 0, 'nenhum animate-with-text-v3');
    assert.equal(result.generated, 1);
    assert.equal(result.faces.length, 0);

    assert.ok(existsSync(blockFile(dir, result.hash, 'base.png')), 'o cubo base existe');
    assert.ok(!existsSync(blockFile(dir, result.hash, 'spritesheet.png')), 'sem spritesheet');

    const manifest = readManifest(dir, result.hash);
    assert.equal(manifest['version'], 3);
    assert.equal(manifest['animated'], false);
    assert.equal(manifest['frameCount'], 0);
    assert.equal(manifest['animation'], undefined, 'sem registro de animação');

    // Leitura: bloco estático é lido pelo base.png.
    assert.ok(await readWorldBlockResult(result.hash, join(dir, 'assets')));

    // Catálogo: baseUrl em vez de spritesheet/animation.
    const list = await listWorldBlocks(join(dir, 'assets'));
    assert.equal(list.length, 1);
    assert.equal(list[0]?.animated, false);
    assert.equal(list[0]?.baseUrl, `/world-blocks/${result.hash}/base.png`);
    assert.equal(list[0]?.spritesheetUrl, undefined);
    assert.equal(list[0]?.animationUrl, undefined);

    // Idempotência: segunda execução não gasta nada.
    const client2 = new FakeClient();
    const second = await withFallbackAction(() =>
      runWorldBlock(client2, { ...textureConfig(), frameCount: 0 }, opts(dir)),
    );
    assert.equal(client2.calls, 0);
    assert.equal(second.fromCache, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('frameCount 0 é válido; pingPong e enhancePrompt precisam ser booleanos', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    await withFallbackAction(() =>
      runWorldBlock(client, { ...textureConfig(), frameCount: 0 }, opts(dir)),
    );
    assert.equal(client.animBodies.length, 0, 'frameCount 0 não chega a animar');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await assertValidation({ ...textureConfig(), pingPong: 'sim' as never }, 'ping-pong-type');
  await assertValidation({ ...textureConfig(), enhancePrompt: 'sim' as never }, 'enhance-prompt-type');
});

test('texture: pingPong e enhancePrompt entram no hash; defaults explícitos não', () => {
  const t = textureConfig();
  assert.equal(worldBlockHash(t), worldBlockHash({ ...t, pingPong: true }));
  assert.equal(worldBlockHash(t), worldBlockHash({ ...t, enhancePrompt: true }));
  assert.notEqual(worldBlockHash(t), worldBlockHash({ ...t, pingPong: false }));
  assert.notEqual(worldBlockHash(t), worldBlockHash({ ...t, enhancePrompt: false }));
  assert.notEqual(
    worldBlockHash(t),
    worldBlockHash({ ...t, frameCount: 0 }),
    '0 = sem animação, outro artefato',
  );
});

// ------------------------------------------------------------------ guard e ledger

test('o guard informa o custo das 4 gerações e nunca recusa (ADR 0012)', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  try {
    await runWorldBlock(new FakeClient(), baseConfig(), opts(dir, logs));
    const guard = logs.find((l) => l.startsWith('[guard]'));
    assert.ok(guard, 'toda execução que gasta tem que logar a estimativa');
    assert.match(guard, /create-isometric-tile \(4× world-block, molde encadeado/);
    assert.match(guard, /USD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotated: o guard informa os DOIS endpoints antes de gastar', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  const restore = mockFetch();
  try {
    await runWorldBlock(new FakeClient(), rotatedConfig(), opts(dir, logs));
    assert.ok(logs.some((l) => l.includes('create-isometric-tile (1× world-block source')));
    assert.ok(logs.some((l) => l.includes('create-character-v3 (8 direções')));
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('texture: o guard informa os DOIS endpoints e o ledger registra o job da animação', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  try {
    await withFallbackAction(() =>
      runWorldBlock(new FakeClient(), textureConfig(), opts(dir, logs)),
    );

    assert.ok(
      logs.some((l) => l.includes('create-isometric-tile (1× cubo base')),
      'guard do cubo (preço estimado do create-isometric-tile, não do pixflux)',
    );
    assert.ok(
      logs.some((l) => l.includes('animate-with-text-v3 (8 frames')),
      'guard da animação',
    );

    const lines = readLedger(dir);
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.['endpoint'], 'create-isometric-tile');
    assert.equal(lines[0]?.['kind'], 'world-block');
    assert.equal(lines[1]?.['endpoint'], 'animate-with-text-v3');
    assert.equal(lines[1]?.['jobId'], 'animjob-7', 'job da animação no ledger');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chained: tile_id no ledger E no manifesto (caminho de volta ao artefato pago)', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    client.mode = 'async-tile';
    const result = await runWorldBlock(client, baseConfig(), opts(dir));

    const lines = readLedger(dir);
    assert.equal(lines.length, 4);
    assert.equal(lines[0]?.['tileId'], 'tile-5');
    assert.equal(lines[0]?.['jobId'], 'job-5');
    assert.equal(lines[0]?.['endpoint'], 'create-isometric-tile');
    assert.equal(lines[0]?.['kind'], 'world-block');

    const manifest = readManifest(dir, result.hash) as { faces: Array<Record<string, unknown>> };
    assert.equal(manifest.faces[0]?.['tileId'], 'tile-5');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ leitura e catálogo

test('readWorldBlockResult — null para hash desconhecido e para bloco incompleto', async () => {
  const dir = tmpDir();
  try {
    assert.equal(await readWorldBlockResult('0'.repeat(16), join(dir, 'assets')), null);

    const result = await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));
    assert.ok(await readWorldBlockResult(result.hash, join(dir, 'assets')));

    rmSync(facePath(dir, result.hash, 'west'), { force: true });
    assert.equal(
      await readWorldBlockResult(result.hash, join(dir, 'assets')),
      null,
      'bloco pela metade não é bloco',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listWorldBlocks só publica bloco COMPLETO do formato v2, em ordem estável', async () => {
  const dir = tmpDir();
  try {
    const a = await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));
    const b = await runWorldBlock(
      new FakeClient(),
      { ...baseConfig(), description: 'cobblestone', seed: 9 },
      opts(dir),
    );

    let list = await listWorldBlocks(join(dir, 'assets'));
    assert.equal(list.length, 2);
    assert.deepEqual(
      list.map((x) => x.hash),
      [a.hash, b.hash].sort((p, q) => p.localeCompare(q)),
      'ordem estável: a paleta não pode dançar entre recargas',
    );
    assert.equal(list[0]?.technique, 'chained');
    assert.deepEqual(Object.keys(list[0]?.faceUrls ?? {}).sort(), [...BLOCK_FACINGS].sort());
    assert.match(String(list[0]?.faceUrls?.north ?? ''), /^\/world-blocks\/[a-f0-9]{16}\/north\.png$/);

    // Bloco pela metade sai da paleta: colocá-lo falharia na hora do desenho.
    rmSync(facePath(dir, b.hash, 'south'), { force: true });
    list = await listWorldBlocks(join(dir, 'assets'));
    assert.deepEqual(list.map((x) => x.hash), [a.hash]);

    // Manifesto do formato antigo (version 1, era uniforme) não entra: aquele
    // catálogo foi arquivado junto com a feature.
    const oldDir = join(dir, 'assets', 'world-blocks', 'aaaaaaaaaaaaaaaa');
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(
      join(oldDir, 'block.json'),
      JSON.stringify({ version: 1, hash: 'aaaaaaaaaaaaaaaa', facingMode: 'uniform', faces: [] }),
    );
    for (const f of BLOCK_FACINGS) writeFileSync(join(oldDir, `${f}.png`), 'nada');
    list = await listWorldBlocks(join(dir, 'assets'));
    assert.deepEqual(list.map((x) => x.hash), [a.hash]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listWorldBlocks publica bloco de VISTAS numeradas, em ordem numérica', async () => {
  const dir = tmpDir();
  try {
    // Bloco gravado por um gerador anterior: v3, técnica rotate8, oito vistas.
    // Seis blocos PAGOS existem assim em disco e ficavam invisíveis na paleta
    // porque o catálogo só conhecia v2 e v3/texture.
    const hash = 'bbbbbbbbbbbbbbbb';
    const blockPath = join(dir, 'assets', 'world-blocks', hash);
    mkdirSync(blockPath, { recursive: true });
    writeFileSync(
      join(blockPath, 'block.json'),
      JSON.stringify({
        version: 3,
        hash,
        technique: 'rotate8-mould',
        description: 'isometric pixel art cube block of grey stone',
        geometry: {
          tileWidth: 48, tileHeight: 24, cubeHeight: 29,
          spriteWidth: 48, spriteHeight: 53,
        },
        views: 8,
        rotate: { frameKeying: 'assumed-canonical-order' },
      }),
    );
    // Fora de ordem lexicográfica de propósito: `view-10` vem depois de `view-9`.
    for (const i of [0, 1, 9, 10]) {
      writeFileSync(join(blockPath, `view-${i}.png`), 'png');
    }

    const list = await listWorldBlocks(join(dir, 'assets'));
    assert.equal(list.length, 1);
    assert.equal(list[0]?.technique, 'views');
    assert.equal(list[0]?.shape, 'block');
    assert.deepEqual(list[0]?.spriteUrls, [
      `/world-blocks/${hash}/view-0.png`,
      `/world-blocks/${hash}/view-1.png`,
      `/world-blocks/${hash}/view-9.png`,
      `/world-blocks/${hash}/view-10.png`,
    ]);
    assert.equal(list[0]?.faceUrls, undefined, 'vistas não são faces por direção');
    assert.equal(list[0]?.geometry.spriteHeight, 53);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bloco v3 sem vista nenhuma em disco não entra na paleta', async () => {
  const dir = tmpDir();
  try {
    const hash = 'cccccccccccccccc';
    const blockPath = join(dir, 'assets', 'world-blocks', hash);
    mkdirSync(blockPath, { recursive: true });
    writeFileSync(
      join(blockPath, 'block.json'),
      JSON.stringify({
        version: 3, hash, technique: 'rotate8-prompt', description: 'nada em disco',
      }),
    );
    const list = await listWorldBlocks(join(dir, 'assets'));
    assert.deepEqual(list, [], 'manifesto sem arte é bloco pela metade');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listWorldBlocks publica textura animada (v3) com spritesheet e sidecar', async () => {
  const dir = tmpDir();
  try {
    const result = await withFallbackAction(() =>
      runWorldBlock(new FakeClient(), textureConfig(), opts(dir)),
    );

    const list = await listWorldBlocks(join(dir, 'assets'));
    assert.equal(list.length, 1);
    assert.equal(list[0]?.technique, 'texture');
    assert.equal(list[0]?.shape, 'block');
    assert.equal(list[0]?.spritesheetUrl, `/world-blocks/${result.hash}/spritesheet.png`);
    assert.equal(list[0]?.animationUrl, `/world-blocks/${result.hash}/animation.json`);
    assert.equal(list[0]?.frameCount, 4, 'frameCount real vem do sidecar');
    assert.equal(list[0]?.fps, 8);
    assert.equal(list[0]?.faceUrls, undefined, 'texture não tem faces por vista');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listWorldBlocks — [] quando nunca se gerou nada', async () => {
  const dir = tmpDir();
  try {
    assert.deepEqual(await listWorldBlocks(join(dir, 'assets')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ remoção

/**
 * Seed de um bloco no formato v2 ANTIGO, com nomes de arquivo que o código de
 * hoje não conhece mais (`view-0.png`, `first-frame.png`). Serve para provar
 * que a remoção leva o diretório INTEIRO, não uma lista de nomes conhecidos.
 */
function seedLegacyBlock(dir: string, hash: string): string[] {
  const blockPath = join(dir, 'assets', 'world-blocks', hash);
  mkdirSync(join(blockPath, 'v3'), { recursive: true });
  const files = [
    join(blockPath, 'block.json'),
    join(blockPath, 'view-0.png'),
    join(blockPath, 'view-1.png'),
    join(blockPath, 'first-frame.png'),
    join(blockPath, 'v3', 'north.png'),
  ];
  writeFileSync(
    files[0]!,
    JSON.stringify({ version: 2, hash, technique: 'chained', faces: [] }),
  );
  for (const f of files.slice(1)) writeFileSync(f, 'bytes antigos');
  return files;
}

test('isWorldBlockHash aceita 16 hex e recusa tudo o mais', () => {
  assert.equal(isWorldBlockHash('0123456789abcdef'), true);
  assert.equal(isWorldBlockHash('0123456789ABCDEF'), true, 'maiúsculas casam (flag i)');
  for (const bad of [
    '',
    '..',
    '../..',
    '%2e%2e',
    '0123456789abcde',        // 15
    '0123456789abcdef0',      // 17
    '0123456789abcdeg',       // 'g' não é hex
    '0123456789abcdef/x',
    '../0123456789abcdef',
    '0123456789abcdef\n',     // `$` em JS não aceita \n final sem a flag m
    '0123456789abcde\0',
    '0123456789abcdef\0/etc',
  ]) {
    assert.equal(isWorldBlockHash(bad), false, `deveria recusar ${JSON.stringify(bad)}`);
  }
  assert.equal(isWorldBlockHash(undefined), false);
  assert.equal(isWorldBlockHash(42), false);
});

test('deleteWorldBlock RECUSA caminho que não é hash — nada some do disco', async () => {
  const dir = tmpDir();
  try {
    // Um bloco real e um arquivo fora de world-blocks/: as duas coisas que um
    // DELETE com caminho arbitrário destruiria.
    const hash = worldBlockHash(baseConfig());
    seedLegacyBlock(dir, hash);
    const foraDaArvore = join(dir, 'assets', 'NAO-APAGUE.txt');
    writeFileSync(foraDaArvore, 'estado do usuário');

    const assetsDir = join(dir, 'assets');
    for (const evil of [
      '..',
      '../..',
      '../../..',
      '%2e%2e',
      '%2e%2e%2f%2e%2e',
      '..%2f..',
      `../${hash}`,
      `${hash}/..`,
      `${hash}\0`,
      '/etc',
      'world-blocks',
      '.',
    ]) {
      await assert.rejects(
        deleteWorldBlock(assetsDir, evil),
        (err: unknown) => {
          assert.ok(
            err instanceof WorldBlockValidationError,
            `esperava WorldBlockValidationError para ${JSON.stringify(evil)}, veio ${String(err)}`,
          );
          assert.equal(err.code, 'hash-format');
          return true;
        },
        `deleteWorldBlock aceitou ${JSON.stringify(evil)}`,
      );
    }

    // Nada foi tocado: nem o bloco legítimo, nem o arquivo vizinho, nem a raiz.
    assert.equal(existsSync(foraDaArvore), true, 'arquivo fora de world-blocks/ sobreviveu');
    assert.equal(existsSync(blockFile(dir, hash, 'block.json')), true);
    assert.equal(existsSync(join(dir, 'assets', 'world-blocks')), true);
    assert.equal(existsSync(join(dir, 'assets')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleteWorldBlock apaga o diretório INTEIRO e o bloco sai do catálogo', async () => {
  const dir = tmpDir();
  try {
    const result = await withFallbackAction(() =>
      runWorldBlock(new FakeClient(), textureConfig(), opts(dir)),
    );
    const hash = result.hash;
    const blockPath = join(dir, 'assets', 'world-blocks', hash);

    // O que a técnica 'texture' deixa em disco, antes.
    for (const f of ['block.json', 'base.png', 'spritesheet.png', 'spritesheet.json', 'animation.json']) {
      assert.equal(existsSync(blockFile(dir, hash, f)), true, `${f} deveria existir antes`);
    }
    assert.equal(existsSync(blockFile(dir, hash, 'frames')), true);
    assert.equal((await listWorldBlocks(join(dir, 'assets'))).length, 1);

    const removal = await deleteWorldBlock(join(dir, 'assets'), hash);

    assert.equal(removal.existed, true);
    assert.equal(removal.hash, hash);
    assert.ok(removal.removedFiles >= 5, `contou ${removal.removedFiles} arquivos removidos`);
    assert.equal(existsSync(blockPath), false, 'o diretório do bloco tem que sumir inteiro');
    assert.deepEqual(await listWorldBlocks(join(dir, 'assets')), []);
    assert.equal(await readWorldBlockResult(hash, join(dir, 'assets')), null);
    // A raiz continua de pé — apagar um bloco não é apagar a coleção.
    assert.equal(existsSync(join(dir, 'assets', 'world-blocks')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleteWorldBlock leva os formatos v2 antigos, com nomes que este código não conhece mais', async () => {
  const dir = tmpDir();
  try {
    const hash = 'abcdef0123456789';
    const files = seedLegacyBlock(dir, hash);
    for (const f of files) assert.equal(existsSync(f), true);

    const removal = await deleteWorldBlock(join(dir, 'assets'), hash);

    assert.equal(removal.existed, true);
    assert.equal(removal.removedFiles, files.length, 'contou os 5 arquivos, inclusive v3/north.png');
    for (const f of files) assert.equal(existsSync(f), false, `${f} deveria ter sumido`);
    assert.equal(existsSync(join(dir, 'assets', 'world-blocks', hash)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleteWorldBlock é IDEMPOTENTE — apagar duas vezes não é erro', async () => {
  const dir = tmpDir();
  try {
    const hash = 'abcdef0123456789';
    seedLegacyBlock(dir, hash);

    const first = await deleteWorldBlock(join(dir, 'assets'), hash);
    assert.equal(first.existed, true);

    const second = await deleteWorldBlock(join(dir, 'assets'), hash);
    assert.equal(second.existed, false, 'a segunda vez responde, não explode');
    assert.equal(second.removedFiles, 0);
    assert.equal(second.pendingDiscarded, false);

    // Hash que nunca existiu segue o mesmo caminho — inclusive com assets/
    // inteiro ausente, que é o estado de uma instalação nova.
    const virgem = tmpDir();
    try {
      const nunca = await deleteWorldBlock(join(virgem, 'assets'), '0000000000000000');
      assert.equal(nunca.existed, false);
    } finally {
      rmSync(virgem, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleteWorldBlock toca SÓ o bloco pedido — o irmão fica intacto', async () => {
  const dir = tmpDir();
  try {
    const a = await runWorldBlock(new FakeClient(), baseConfig(), opts(dir));
    const b = await runWorldBlock(
      new FakeClient(),
      { ...baseConfig(), description: 'cobblestone', seed: 9 },
      opts(dir),
    );
    assert.equal((await listWorldBlocks(join(dir, 'assets'))).length, 2);

    await deleteWorldBlock(join(dir, 'assets'), a.hash);

    const list = await listWorldBlocks(join(dir, 'assets'));
    assert.deepEqual(list.map((x) => x.hash), [b.hash]);
    assert.equal(existsSync(facePath(dir, b.hash, 'north')), true);
    // O ledger é da coleção, não do bloco: uma remoção não reescreve histórico
    // de gasto. O dinheiro saiu e o registro dele continua lá.
    assert.ok(readLedger(dir).length > 0, 'o ledger sobrevive à remoção');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleteWorldBlock avisa quando descarta trabalho JÁ PAGO esperando retomada', async () => {
  const dir = tmpDir();
  try {
    // Bloco cujo cubo foi cobrado e cuja animação ficou pendente: é o estado
    // que `runWorldBlock` sabe retomar DE GRAÇA pelo stub.
    const hash = 'abcdef0123456789';
    const blockPath = join(dir, 'assets', 'world-blocks', hash);
    mkdirSync(blockPath, { recursive: true });
    writeFileSync(join(blockPath, 'base.png'), 'cubo pago');
    writeFileSync(
      join(blockPath, 'animation.pending.json'),
      JSON.stringify({ jobId: 'animjob-5' }),
    );

    const removal = await deleteWorldBlock(join(dir, 'assets'), hash);
    assert.equal(removal.existed, true);
    assert.equal(
      removal.pendingDiscarded,
      true,
      'quem chama precisa poder dizer ao usuário que jogou fora algo já pago',
    );

    // Bloco completo, sem stub nenhum: nada a avisar.
    const dir2 = tmpDir();
    try {
      const done = await withFallbackAction(() =>
        runWorldBlock(new FakeClient(), textureConfig(), opts(dir2)),
      );
      const r2 = await deleteWorldBlock(join(dir2, 'assets'), done.hash);
      assert.equal(r2.pendingDiscarded, false);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('remoção parcial não deixa o catálogo mostrando bloco sem PNG', async () => {
  const dir = tmpDir();
  try {
    const result = await withFallbackAction(() =>
      runWorldBlock(new FakeClient(), textureConfig(), opts(dir)),
    );
    const hash = result.hash;
    assert.equal((await listWorldBlocks(join(dir, 'assets'))).length, 1);

    // `deleteWorldBlock` tira o manifesto PRIMEIRO justamente para que uma
    // falha no meio do rm caia neste estado, e não no oposto. Aqui o estado é
    // reproduzido à mão: manifesto fora, PNGs ainda em disco.
    rmSync(blockFile(dir, hash, 'block.json'), { force: true });
    assert.equal(existsSync(blockFile(dir, hash, 'spritesheet.png')), true);

    assert.deepEqual(
      await listWorldBlocks(join(dir, 'assets')),
      [],
      'sem manifesto o bloco some da paleta, mesmo com os PNGs lá',
    );
    assert.equal(await readWorldBlockResult(hash, join(dir, 'assets')), null);

    // E o inverso — manifesto de pé, artefato fora — também some do catálogo.
    const dir2 = tmpDir();
    try {
      const r2 = await withFallbackAction(() =>
        runWorldBlock(new FakeClient(), textureConfig(), opts(dir2)),
      );
      rmSync(blockFile(dir2, r2.hash, 'spritesheet.png'), { force: true });
      assert.deepEqual(await listWorldBlocks(join(dir2, 'assets')), []);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }

    // Chamar a remoção de novo termina o serviço: sobra nada.
    await deleteWorldBlock(join(dir, 'assets'), hash);
    assert.equal(existsSync(join(dir, 'assets', 'world-blocks', hash)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Regressão dos DOIS BLOCOS PAGOS que existem em disco
// ============================================================================
//
// `tools/character-builder/assets/world-blocks/` guarda dois blocos comprados
// com dinheiro real, e o `block.json` de cada um É a prova do defeito que a
// onda 1 consertou. Os valores abaixo foram COPIADOS de lá em 2026-08-04 e
// estão escritos como literais de propósito: `assets/` é gitignored e pode
// sumir, e um teste de regressão que dependa dele deixa de regredir em
// silêncio no dia em que a pasta não existir.
//
//   df00c6479810988c → description "quero um cubo de ossos"
//                      action      "subtle ambient motion with gentle light
//                                   variations and soft texture shimmer"
//                      (a string-CORINGA — o fallback que TODO bloco recebia,
//                      porque as 14 regexes de ACTION_FALLBACK são inglesas e
//                      nenhuma casa "quero um cubo de ossos")
//   a880b32d82456c4e → description "bloco de gero"
//                      action      "gotas de agua escorrendo"
//                      (português cru indo para um endpoint que só lê inglês)
//
// O `enhancedPrompt` gravado no primeiro fecha o argumento: a API devolveu
// "The cubic stone structure remains stationary…" para um cubo de OSSOS. Ela
// expandiu o que recebeu, e o que recebeu não dizia osso em lugar nenhum.

/** A ação-coringa exata gravada em `df00c6479810988c/block.json`. */
const ACAO_CORINGA =
  'subtle ambient motion with gentle light variations and soft texture shimmer';

/** A ação em português crua gravada em `a880b32d82456c4e/block.json`. */
const ACAO_EM_PORTUGUES = 'gotas de agua escorrendo';

test('regressão do bloco pago df00c6479810988c: "quero um cubo de ossos" não recebe mais a ação-coringa', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const config: WorldBlockConfig = {
      ...textureConfig(),
      description: 'quero um cubo de ossos',
    };
    const result = await withFallbackAction(() => runWorldBlock(client, config, opts(dir)));

    // 1. A ação que vai ao /animate-with-text-v3 deixou de ser a coringa.
    const acao = String(client.animBodies[0]!['action']);
    assert.notEqual(
      acao,
      ACAO_CORINGA,
      'esta é a string literal que o bloco pago recebeu; ela não pode voltar',
    );
    assert.doesNotMatch(acao, /gentle light variations/, 'nem em pedaço');
    assert.match(acao, /\bbone\b/, 'a ação agora nomeia o material — é o único texto que ela vê');

    // 2. O prompt do cubo deixou de carregar o PEDIDO e o português.
    const enviado = String(client.tileBodies[0]!['description']);
    assert.doesNotMatch(enviado, /quero/i);
    assert.doesNotMatch(enviado, /ossos/i);
    assert.match(enviado, /\bbone\b/);

    // 3. O manifesto guarda os dois textos, e a ação gravada também mudou —
    //    é o campo do block.json que denunciava o defeito.
    const manifest = readManifest(dir, result.hash);
    assert.equal(manifest['description'], 'quero um cubo de ossos');
    assert.equal(manifest['material'], 'bone');
    assert.notEqual(manifest['action'], ACAO_CORINGA);
    const sidecar = JSON.parse(
      readFileSync(blockFile(dir, result.hash, 'animation.json'), 'utf-8'),
    ) as Record<string, unknown>;
    assert.notEqual(sidecar['action'], ACAO_CORINGA);
    assert.equal(sidecar['material'], 'bone');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('regressão do bloco pago a880b32d82456c4e: "bloco de gero" não manda mais o rodeio ao fornecedor', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const config: WorldBlockConfig = { ...textureConfig(), description: 'bloco de gero' };
    const result = await withFallbackAction(() => runWorldBlock(client, config, opts(dir)));

    // "bloco de" era mandado inteiro ao /create-isometric-tile. Hoje o que sai
    // é só o que sobrou do pedido depois de removida a palavra da forma.
    const enviado = String(client.tileBodies[0]!['description']);
    assert.doesNotMatch(enviado, /bloco/i, 'a palavra da FORMA não é material');
    assert.equal(enviado, cubePrompt('gero', { hasReference: true }));

    // O manifesto separa o que foi digitado do que foi de fato pedido — dado
    // que, até 2026-08-04, não existia em lugar nenhum.
    const manifest = readManifest(dir, result.hash);
    assert.equal(manifest['description'], 'bloco de gero');
    assert.equal(manifest['material'], 'gero');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A ação que o usuário digita NÃO passa pela normalização — só a descrição
 * passa. Este teste não denuncia bug: fixa a fronteira, que é fácil de supor
 * no lugar errado. O bloco pago `a880b32d82456c4e` tem `action` em português
 * porque alguém a digitou assim, e continuaria assim hoje; o que mudou é que
 * o MATERIAL viaja junto, dentro da mesma string.
 */
test('regressão: `action` digitada pelo usuário passa intacta — só a descrição é normalizada', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    const config: WorldBlockConfig = {
      ...textureConfig(),
      description: 'bloco de gero',
      action: ACAO_EM_PORTUGUES,
    };
    await withFallbackAction(() => runWorldBlock(client, config, opts(dir)));

    const acao = String(client.animBodies[0]!['action']);
    assert.ok(
      acao.startsWith(ACAO_EM_PORTUGUES),
      `a ação digitada é preservada, veio "${acao}"`,
    );
    assert.equal(acao, actionWithMaterial(ACAO_EM_PORTUGUES, 'gero'));
    assert.match(acao, /on a pixel art cube made of gero/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Honestidade sobre o alcance da correção: a coringa não sumiu, ela ganhou o
 * material. Para os 14 materiais da tabela de `ACTION_FALLBACK` a ação passa a
 * ser específica; para qualquer outro (aqui "gero", que não está no glossário
 * nem na tabela) o texto continua sendo a coringa — com o material costurado
 * no fim, o que é o mínimo que o endpoint precisa para saber o que anima.
 */
test('regressão: material fora da tabela ainda cai na coringa, mas AGORA carrega o material', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClient();
    await withFallbackAction(() =>
      runWorldBlock(
        client,
        { ...textureConfig(), description: 'bloco de gero' },
        opts(dir),
      ),
    );
    const acao = String(client.animBodies[0]!['action']);
    assert.notEqual(acao, ACAO_CORINGA, 'a coringa NUA é o que não pode mais sair');
    assert.equal(acao, `${ACAO_CORINGA}, on a pixel art cube made of gero`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * **Limitação conhecida, não bug.** Com DOIS adjetivos o conectivo português
 * fica órfão no fim da frase: `frontAdjectives` move para a frente só as
 * palavras que ESTE módulo produziu, e o "e" não é uma delas. O fallback é o
 * piso de quem não tem `ANTHROPIC_API_KEY`, não um tradutor.
 */
test('fallbackMaterial: limitação conhecida — dois adjetivos deixam o conectivo órfão', () => {
  assert.equal(fallbackMaterial('pedra rachada e escura'), 'cracked dark stone e');
  // Com UM adjetivo a frase sai correta — é o caso que o mecanismo cobre.
  assert.equal(fallbackMaterial('pedra rachada'), 'cracked stone');
});

// ============================================================================
// packSpritesheet — o quadro sai do frame decodificado, nunca de um 48 fixo
// ============================================================================
//
// Até 2026-08-04 o empacotador assumia 48×48. O `first_frame` que ele mesmo
// manda é o cubo canônico 48×53, e os dois blocos pagos em disco têm folhas
// 432×48 e 240×48: as cinco linhas da base do cubo, já pagas, foram cortadas.
// Pior seria um frame de largura diferente — o laço copiava com passo
// `y * 48 * 4` sobre um buffer de outra largura e CISALHARIA a folha inteira.
//
// O que se prova aqui, para cada forma de frame: (1) a folha tem o quadro real,
// (2) o atlas JSON declara o que os PNGs realmente têm, e (3) cada quadro da
// folha é byte a byte o frame correspondente — que é o teste de cisalhamento
// de verdade, porque um passo errado produz uma folha do tamanho CERTO com os
// pixels no lugar errado.

/** Lê a spritesheet e devolve o retângulo do frame `i`, como RGBA cru. */
function tileDaFolha(
  sheet: Buffer,
  i: number,
  frameW: number,
  frameH: number,
): Buffer {
  const img = decodePngToRgba(sheet);
  const out = Buffer.alloc(frameW * frameH * 4);
  for (let y = 0; y < frameH; y += 1) {
    const src = (y * img.width + i * frameW) * 4;
    img.data.copy(out, y * frameW * 4, src, src + frameW * 4);
  }
  return out;
}

/**
 * Roda a técnica 'texture' com frames do quadro pedido e confere folha, atlas
 * e conteúdo. Devolve o hash para quem quiser olhar mais.
 */
async function assertFolhaCoerente(
  dir: string,
  frameW: number,
  frameH: number,
): Promise<string> {
  const client = new FakeClient();
  client.animFrameWidth = frameW;
  client.animFrameHeight = frameH;
  const result = await withFallbackAction(() =>
    runWorldBlock(client, textureConfig(), opts(dir)),
  );

  // 1. A folha tem o quadro REAL do frame, não um número fixo.
  const sheetBytes = readFileSync(blockFile(dir, result.hash, 'spritesheet.png'));
  const sheet = readPngHeader(sheetBytes);
  assert.equal(sheet.width, frameW * 4, `largura da folha para ${frameW}×${frameH}`);
  assert.equal(sheet.height, frameH, `altura da folha para ${frameW}×${frameH}`);

  // 2. O atlas declara o que os PNGs têm — e os PNGs em frames/ conferem.
  const atlas = JSON.parse(
    readFileSync(blockFile(dir, result.hash, 'spritesheet.json'), 'utf-8'),
  ) as {
    frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
    meta: { size: { w: number; h: number } };
    animations: { anim: string[] };
  };
  assert.equal(atlas.meta.size.w, sheet.width, 'meta.size mente sobre a folha');
  assert.equal(atlas.meta.size.h, sheet.height);
  assert.equal(atlas.animations.anim.length, 4);
  for (let i = 0; i < 4; i += 1) {
    const nome = `frame_00${i}`;
    const decl = atlas.frames[nome]!.frame;
    assert.equal(decl.w, frameW, `${nome}.w`);
    assert.equal(decl.h, frameH, `${nome}.h`);
    assert.equal(decl.x, i * frameW, `${nome}.x`);
    assert.equal(decl.y, 0);
    const png = readPngHeader(readFileSync(blockFile(dir, result.hash, 'frames', `${nome}.png`)));
    assert.equal(png.width, frameW, `o PNG de ${nome} tem que ter o que o atlas declara`);
    assert.equal(png.height, frameH);
  }

  // 3. Cada quadro da folha É o frame correspondente, byte a byte. É aqui que
  //    o cisalhamento apareceria: passo errado dá folha do tamanho certo com
  //    os pixels deslocados uma linha a cada linha.
  for (let i = 0; i < 4; i += 1) {
    const frame = decodePngToRgba(
      readFileSync(blockFile(dir, result.hash, 'frames', `frame_00${i}.png`)),
    );
    assert.deepEqual(
      tileDaFolha(sheetBytes, i, frameW, frameH),
      frame.data,
      `o quadro ${i} da folha não é o frame ${i} — a folha cisalhou`,
    );
  }
  return result.hash;
}

test('packSpritesheet: quadro CANÔNICO 48×53 — folha, atlas e pixels conferem', async () => {
  const dir = tmpDir();
  try {
    await assertFolhaCoerente(dir, BLOCK_GEOMETRY.spriteWidth, BLOCK_GEOMETRY.spriteHeight);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('packSpritesheet: quadro LEGADO 48×48 continua aceito e não cisalha', async () => {
  // 48×48 era a única forma aceita até 2026-08-04, e blocos gerados antes disso
  // existem em disco. Estreitar o aceite sem prova transformaria em exceção um
  // frame JÁ PAGO que hoje é gravado sem reclamação.
  const dir = tmpDir();
  try {
    await assertFolhaCoerente(dir, 48, 48);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('packSpritesheet: forma INESPERADA 37×61 (ímpar, fora de qualquer múltiplo) não cisalha', async () => {
  // Nem 48, nem quadrado, nem múltiplo de 4: exatamente o frame que o laço
  // antigo, com passo `y * 48 * 4`, destruiria em silêncio.
  const dir = tmpDir();
  try {
    await assertFolhaCoerente(dir, 37, 61);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Frames de tamanhos DIFERENTES entre si. A folha usa o quadro do primeiro e
 * recorta o resto — nada cisalha, mas pode faltar borda, e o aviso tem de sair
 * no log para que a perda não seja silenciosa.
 */
class FakeClientFramesIrregulares extends FakeClient {
  override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    if (method === 'GET' && path.startsWith('/background-jobs/animjob-')) {
      const id = path.slice('/background-jobs/'.length);
      // Frame 0 no quadro canônico; os outros MENORES em largura e MAIORES em
      // altura, para exercer os dois lados do `Math.min`.
      const shapes: ReadonlyArray<readonly [number, number]> = [
        [48, 53],
        [40, 60],
        [40, 60],
        [40, 60],
      ];
      return {
        data: {
          id,
          status: 'completed',
          created_at: '2026-08-01T00:00:00Z',
          last_response: {
            images: shapes.map(([w, h], i) => ({
              base64: makePNGRect(w, h, i + 1).toString('base64'),
            })),
          },
        } as T,
        status: 200,
        raw: '{}',
      };
    }
    return super.request<T>(method, path, body);
  }
}

test('packSpritesheet: frames de tamanhos diferentes entre si — recorte pelo primeiro, com aviso', async () => {
  const dir = tmpDir();
  const logs: string[] = [];
  try {
    const client = new FakeClientFramesIrregulares();
    const result = await withFallbackAction(() =>
      runWorldBlock(client, textureConfig(), opts(dir, logs)),
    );

    const sheetBytes = readFileSync(blockFile(dir, result.hash, 'spritesheet.png'));
    const sheet = readPngHeader(sheetBytes);
    assert.equal(sheet.width, 48 * 4, 'o quadro é o do PRIMEIRO frame');
    assert.equal(sheet.height, 53);
    assert.ok(
      logs.some((l) => l.includes('não têm todos') && l.includes('AVISO')),
      'faltar borda em frame pago não pode ser silencioso',
    );

    // O frame 0 entra inteiro.
    assert.deepEqual(
      tileDaFolha(sheetBytes, 0, 48, 53),
      decodePngToRgba(readFileSync(blockFile(dir, result.hash, 'frames', 'frame_000.png'))).data,
    );

    // Os menores entram nas 40 primeiras colunas e nas 53 primeiras linhas, sem
    // deslocamento: a linha `y` da folha é a linha `y` do frame. Um passo errado
    // aqui apareceria como diagonal.
    const folha = decodePngToRgba(sheetBytes);
    for (const i of [1, 2, 3]) {
      const frame = decodePngToRgba(
        readFileSync(blockFile(dir, result.hash, 'frames', `frame_00${i}.png`)),
      );
      assert.equal(frame.width, 40);
      assert.equal(frame.height, 60);
      for (const y of [0, 1, 26, 52]) {
        const naFolha = folha.data.subarray(
          (y * folha.width + i * 48) * 4,
          (y * folha.width + i * 48 + 40) * 4,
        );
        const noFrame = frame.data.subarray(y * 40 * 4, y * 40 * 4 + 40 * 4);
        assert.deepEqual(naFolha, noFrame, `linha ${y} do frame ${i} saiu deslocada`);
      }
      // A coluna 40..47 do quadro fica transparente — o frame era mais estreito.
      const sobra = folha.data.subarray(
        (0 * folha.width + i * 48 + 40) * 4,
        (0 * folha.width + i * 48 + 48) * 4,
      );
      assert.deepEqual(sobra, Buffer.alloc(8 * 4), 'o que o frame não cobre fica vazio');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Devolve os frames da animação como RGBA CRU (sem PNG), como o tile faz. */
class FakeClientFramesCrus extends FakeClient {
  /** Bytes por frame. 48×53×4 e 48×48×4 são as duas formas aceitas. */
  rawWidth = BLOCK_GEOMETRY.spriteWidth;
  rawHeight = BLOCK_GEOMETRY.spriteHeight;

  override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    if (method === 'GET' && path.startsWith('/background-jobs/animjob-')) {
      const id = path.slice('/background-jobs/'.length);
      const images = [1, 2, 3, 4].map((fill) => {
        const rgba = Buffer.alloc(this.rawWidth * this.rawHeight * 4);
        for (let i = 0; i < rgba.length; i += 1) rgba[i] = (fill * 31 + i) & 0xff;
        return { base64: rgba.toString('base64') };
      });
      return {
        data: {
          id,
          status: 'completed',
          created_at: '2026-08-01T00:00:00Z',
          last_response: { images },
        } as T,
        status: 200,
        raw: '{}',
      };
    }
    return super.request<T>(method, path, body);
  }
}

test('packSpritesheet: frame em RGBA CRU nas duas formas conhecidas é empacotado', async () => {
  for (const [w, h] of [
    [BLOCK_GEOMETRY.spriteWidth, BLOCK_GEOMETRY.spriteHeight],
    [BLOCK_GEOMETRY.spriteWidth, BLOCK_GEOMETRY.spriteWidth],
  ] as const) {
    const dir = tmpDir();
    try {
      const client = new FakeClientFramesCrus();
      client.rawWidth = w;
      client.rawHeight = h;
      const result = await withFallbackAction(() =>
        runWorldBlock(client, textureConfig(), opts(dir)),
      );
      const sheet = readPngHeader(readFileSync(blockFile(dir, result.hash, 'spritesheet.png')));
      assert.equal(sheet.width, w * 4, `RGBA cru ${w}×${h}: largura da folha`);
      assert.equal(sheet.height, h, `RGBA cru ${w}×${h}: altura da folha`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('packSpritesheet: RGBA cru de forma DESCONHECIDA é erro nomeado, não folha silenciosamente errada', async () => {
  const dir = tmpDir();
  try {
    const client = new FakeClientFramesCrus();
    client.rawWidth = 50;
    client.rawHeight = 50;
    await assert.rejects(
      withFallbackAction(() => runWorldBlock(client, textureConfig(), opts(dir))),
      /não é PNG nem RGBA cru/,
      'bytes que não casam nenhuma forma têm de parar a execução',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// OS DOIS BUGS QUE ESTAVAM TRANCADOS POR TESTE — agora consertados
// ============================================================================

/**
 * **Bug consertado (era `estimateByArea(COST_TABLE[...], 48 * 48)`).**
 *
 * Eram duas coisas erradas na mesma linha, e só uma delas aparecia no número:
 *
 * 1. O `48*48` literal NÃO mudava o valor: 2304 e 2544 caem os dois abaixo do
 *    primeiro ponto medido da tabela (64×64 = 4096) e `estimateByArea` prende
 *    no piso. O literal estava mascarado pelo clamp — e voltaria a importar no
 *    dia em que a tabela ganhasse um ponto menor. Consertado junto assim mesmo:
 *    o quadro agora sai do cabeçalho do PNG do cubo base.
 * 2. O que de fato subestimava era ignorar o `frame_count`. O orçamento do
 *    endpoint é `width × height × frame_count` (spec vendorizado: "Total pixel
 *    budget: width × height × frame_count ≤ 524,288") e a estimativa era de UM
 *    quadro: 0.0221 USD idêntico para 4, 8 e 16 frames.
 *
 * Preço ESTIMADO, sempre: a própria PixelLab rotula a coluna como
 * `Estimated Price* (USD)` e avisa que varia com o tempo de GPU.
 */
test('a estimativa da animação entra com o frame_count e com o quadro real', async () => {
  // A fórmula do orçamento é a do spec, não uma invenção do módulo.
  assert.equal(
    animationPixelBudget(BLOCK_GEOMETRY.spriteWidth, BLOCK_GEOMETRY.spriteHeight, 8),
    BLOCK_GEOMETRY.spriteWidth * BLOCK_GEOMETRY.spriteHeight * 8,
  );

  const deUmQuadroSo = estimateByArea(COST_TABLE['animate-with-text-v3'], 48 * 48);
  const pontos: string[] = [];
  for (const frameCount of [4, 8, 16] as const) {
    const dir = tmpDir();
    const logs: string[] = [];
    try {
      await withFallbackAction(() =>
        runWorldBlock(new FakeClient(), { ...textureConfig(), frameCount }, opts(dir, logs)),
      );
      const linha = logs.find((l) => l.includes('animate-with-text-v3'));
      assert.ok(linha, `o guard da animação tem que logar para ${frameCount} frames`);
      assert.match(
        linha,
        new RegExp(
          `${frameCount} frames de ${BLOCK_GEOMETRY.spriteWidth}×${BLOCK_GEOMETRY.spriteHeight}`,
        ),
        'o rótulo tem que dizer QUANTOS quadros e de que tamanho',
      );
      assert.match(linha, /preço estimado/, 'preço é estimativa, e o rótulo diz isso');
      const m = /: ([0-9.]+) USD/.exec(linha);
      assert.ok(m?.[1], `não achei o valor em "${linha}"`);
      pontos.push(m[1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // Agora a estimativa SE MOVE com o único parâmetro que multiplica o trabalho.
  assert.ok(
    Number(pontos[0]) > deUmQuadroSo.point,
    `4 frames (${pontos[0]}) tem de custar mais que um quadro só (${deUmQuadroSo.point})`,
  );
  assert.ok(
    Number(pontos[1]) > Number(pontos[0]),
    `8 frames (${pontos[1]}) tem de custar mais que 4 (${pontos[0]})`,
  );
  // 8 e 16 empatam, e não é bug: 48×53×8 = 20 352 já passa do ÚLTIMO ponto
  // medido da tabela (128×128 = 16 384), e `estimateByArea` prende no teto em
  // vez de extrapolar — inventar número fora da faixa medida é como se estoura
  // orçamento. O empate é o clamp declarado, não a estimativa parada.
  assert.equal(pontos[1], pontos[2], '8 e 16 frames prendem no teto da tabela medida');

  // O valor exato é o da área real do trabalho.
  const esperado8 = estimateByArea(
    COST_TABLE['animate-with-text-v3'],
    animationPixelBudget(BLOCK_GEOMETRY.spriteWidth, BLOCK_GEOMETRY.spriteHeight, 8),
  );
  assert.equal(pontos[1], esperado8.point.toFixed(4));
  // O número que esta correção troca: 0.0221 → 0.0424 (preço estimado).
  assert.equal(deUmQuadroSo.point.toFixed(4), '0.0221');
  assert.equal(esperado8.point.toFixed(4), '0.0424');
});

/**
 * **Bug consertado (era `geometry: MANIFEST_GEOMETRY` no ramo `texture`).**
 *
 * `listWorldBlocks` publicava a constante do módulo por cima da geometria
 * GRAVADA, enquanto o ramo `views` e o v2 já liam `manifest.geometry ??
 * MANIFEST_GEOMETRY`. Era invisível só porque a constante coincide com o que os
 * blocos em disco têm: no dia em que a geometria do projeto mudasse, os blocos
 * PAGOS com a antiga passariam a ser publicados com a nova, e o editor
 * desenharia arte comprada na projeção errada sem nada reclamar.
 */
test('o catálogo respeita a geometria gravada no manifesto de TEXTURA', async () => {
  const dir = tmpDir();
  try {
    const assets = join(dir, 'assets');
    const geometriaGravada = {
      tileWidth: 64,
      tileHeight: 32,
      cubeHeight: 40,
      spriteWidth: 64,
      spriteHeight: 72,
    };

    // Um bloco de TEXTURA animado cuja geometria em disco NÃO é a constante.
    const hashTextura = 'dddddddddddddddd';
    const dirTextura = join(assets, 'world-blocks', hashTextura);
    mkdirSync(dirTextura, { recursive: true });
    writeFileSync(
      join(dirTextura, 'block.json'),
      JSON.stringify({
        version: 3,
        hash: hashTextura,
        technique: 'texture',
        description: 'bloco pago com geometria antiga',
        geometry: geometriaGravada,
        action: 'x',
        animated: true,
        frameCount: 4,
        fps: 8,
      }),
    );
    writeFileSync(join(dirTextura, 'spritesheet.png'), 'png');

    // E um bloco de TEXTURA estático (frameCount 0) — o outro ramo corrigido.
    const hashParado = 'cccccccccccccccc';
    const dirParado = join(assets, 'world-blocks', hashParado);
    mkdirSync(dirParado, { recursive: true });
    writeFileSync(
      join(dirParado, 'block.json'),
      JSON.stringify({
        version: 3,
        hash: hashParado,
        technique: 'texture',
        description: 'bloco pago sem animação, geometria antiga',
        geometry: geometriaGravada,
        action: 'x',
        animated: false,
        frameCount: 0,
        fps: 8,
      }),
    );
    writeFileSync(join(dirParado, 'base.png'), 'png');

    // O MESMO manifesto de geometria, num bloco de VISTAS — o ramo que sempre
    // leu o manifesto. É o contraste que prova que os três concordam agora.
    const hashVistas = 'eeeeeeeeeeeeeeee';
    const dirVistas = join(assets, 'world-blocks', hashVistas);
    mkdirSync(dirVistas, { recursive: true });
    writeFileSync(
      join(dirVistas, 'block.json'),
      JSON.stringify({
        version: 3,
        hash: hashVistas,
        technique: 'rotate8-mould',
        description: 'bloco pago com geometria antiga, em vistas',
        geometry: geometriaGravada,
        views: 1,
      }),
    );
    writeFileSync(join(dirVistas, 'view-0.png'), 'png');

    const list = await listWorldBlocks(assets);
    const textura = list.find((b) => b.hash === hashTextura);
    const parado = list.find((b) => b.hash === hashParado);
    const vistas = list.find((b) => b.hash === hashVistas);
    assert.ok(textura && parado && vistas);

    assert.deepEqual(vistas.geometry, geometriaGravada, 'ramo views (nunca teve o bug)');
    assert.deepEqual(textura.geometry, geometriaGravada, 'ramo texture ANIMADO');
    assert.deepEqual(parado.geometry, geometriaGravada, 'ramo texture ESTÁTICO');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Manifesto SEM geometria continua caindo na constante — o `??` é piso, não
 * substituição. Blocos de gerações anteriores existem em disco assim.
 */
test('manifesto de textura sem geometria cai na constante do módulo', async () => {
  const dir = tmpDir();
  try {
    const assets = join(dir, 'assets');
    const hash = 'abababababababab';
    const blockPath = join(assets, 'world-blocks', hash);
    mkdirSync(blockPath, { recursive: true });
    writeFileSync(
      join(blockPath, 'block.json'),
      JSON.stringify({
        version: 3,
        hash,
        technique: 'texture',
        description: 'bloco antigo sem geometria no manifesto',
        action: 'x',
        animated: true,
        frameCount: 4,
        fps: 8,
      }),
    );
    writeFileSync(join(blockPath, 'spritesheet.png'), 'png');

    const list = await listWorldBlocks(assets);
    const bloco = list.find((b) => b.hash === hash);
    assert.ok(bloco);
    assert.equal(bloco.geometry.spriteWidth, BLOCK_GEOMETRY.spriteWidth);
    assert.equal(bloco.geometry.spriteHeight, BLOCK_GEOMETRY.spriteHeight);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// COEXISTÊNCIA DE FOLHAS ANTIGAS E NOVAS
// ============================================================================

/**
 * A decisão de re-empacotar é PURA e por conteúdo — nada de flag de migração.
 *
 * O caso real: `a880b32d82456c4e` tem 9 frames de 48×53 em disco e uma folha
 * 432×48 declarando quadro 48×48, gravada pelo código antigo que assumia o
 * quadro quadrado.
 */
test('sheetNeedsRepack detecta a folha que discorda dos frames, e só ela', () => {
  // Nove PNGs em frames/, o primeiro deles 48×53. A função não pergunta mais
  // nada sobre os outros oito — e nunca perguntou.
  const frames53 = { count: 9, first: { width: 48, height: 53 } };
  const semFrames = { count: 0, first: null };

  // O caso real em disco: quadro 48×48 declarado sobre frames 48×53.
  assert.match(
    sheetNeedsRepack(
      { frameWidth: 48, frameHeight: 48, frameCount: 9, sheetWidth: 432, sheetHeight: 48 },
      frames53,
    ) ?? '',
    /não bate com o dos frames/,
  );

  // A folha correta: nada a fazer. É isto que torna o conserto idempotente.
  assert.equal(
    sheetNeedsRepack(
      { frameWidth: 48, frameHeight: 53, frameCount: 9, sheetWidth: 432, sheetHeight: 53 },
      frames53,
    ),
    null,
  );

  // Contagem divergente (a API devolveu menos quadros do que a folha declara).
  assert.match(
    sheetNeedsRepack(
      { frameWidth: 48, frameHeight: 53, frameCount: 8, sheetWidth: 384, sheetHeight: 53 },
      frames53,
    ) ?? '',
    /declara 8 quadros e há 9/,
  );

  // Atlas ilegível, com frames presentes: reescreve.
  assert.match(sheetNeedsRepack(null, frames53) ?? '', /não há spritesheet\.json/);

  // SEM frames em disco não há de onde re-empacotar: não mexe em nada. Refazer
  // a folha a partir dela mesma seria apagar arte paga.
  assert.equal(sheetNeedsRepack(null, semFrames), null);
  assert.equal(
    sheetNeedsRepack(
      { frameWidth: 48, frameHeight: 48, frameCount: 9, sheetWidth: 432, sheetHeight: 48 },
      semFrames,
    ),
    null,
  );
  // Frames contados mas nenhum legível: mesma degradação — não se toca em nada.
  assert.equal(
    sheetNeedsRepack(
      { frameWidth: 48, frameHeight: 48, frameCount: 9, sheetWidth: 432, sheetHeight: 48 },
      { count: 9, first: null },
    ),
    null,
  );
});

/**
 * O re-empacotamento de verdade, na forma exata das duas folhas legadas: 9
 * quadros de 48×53 em `frames/`, folha 432×48 ao lado.
 *
 * Prova quatro coisas: a folha volta a 432×53, o atlas volta a declarar o
 * quadro certo, `animation.json` e os PNGs de `frames/` NÃO são tocados, e uma
 * segunda passada não escreve nada.
 */
test('a folha legada é re-empacotada a partir de frames/, sem tocar no que já está certo', async () => {
  const dir = tmpDir();
  try {
    const assets = join(dir, 'assets');
    const hash = 'a880b32d82456c4e';
    const blockPath = join(assets, 'world-blocks', hash);
    const framesPath = join(blockPath, 'frames');
    mkdirSync(framesPath, { recursive: true });

    const w = BLOCK_GEOMETRY.spriteWidth;
    const h = BLOCK_GEOMETRY.spriteHeight;
    const contagem = 9;
    for (let i = 0; i < contagem; i += 1) {
      writeFileSync(join(framesPath, `frame_${String(i).padStart(3, '0')}.png`), makePNGRect(w, h, i + 1));
    }
    const framesAntes = Array.from({ length: contagem }, (_, i) =>
      readFileSync(join(framesPath, `frame_${String(i).padStart(3, '0')}.png`)),
    );

    // A folha do código antigo: quadro quadrado, cinco linhas da base cortadas.
    writeFileSync(join(blockPath, 'spritesheet.png'), makePNGRect(w * contagem, w, 9));
    writeFileSync(
      join(blockPath, 'spritesheet.json'),
      JSON.stringify({
        frames: Object.fromEntries(
          Array.from({ length: contagem }, (_, i) => [
            `frame_${String(i).padStart(3, '0')}`,
            { frame: { x: i * w, y: 0, w, h: w }, rotated: false, trimmed: false },
          ]),
        ),
        meta: { image: 'spritesheet.png', size: { w: w * contagem, h: w } },
      }),
    );
    const sidecar = JSON.stringify({ fps: 8, frameCount: contagem, action: 'gotas', pingPong: true });
    writeFileSync(join(blockPath, 'animation.json'), sidecar);
    writeFileSync(join(blockPath, 'base.png'), makePNGRect(w, h, 42));
    writeFileSync(
      join(blockPath, 'block.json'),
      JSON.stringify({
        version: 3,
        hash,
        technique: 'texture',
        description: 'bloco de gero',
        geometry: {
          tileWidth: BLOCK_GEOMETRY.tileWidth,
          tileHeight: BLOCK_GEOMETRY.tileHeight,
          cubeHeight: BLOCK_GEOMETRY.cubeHeight,
          spriteWidth: w,
          spriteHeight: h,
        },
        action: 'gotas',
        animated: true,
        frameCount: contagem,
        fps: 8,
      }),
    );

    const logs: string[] = [];
    const list = await listWorldBlocks(assets, (m) => logs.push(m));
    assert.equal(list.length, 1, 'o bloco continua no catálogo');
    assert.equal(list[0]?.spritesheetUrl, `/world-blocks/${hash}/spritesheet.png`);

    // A folha agora tem a altura REAL do quadro.
    const folha = readPngHeader(readFileSync(join(blockPath, 'spritesheet.png')));
    assert.equal(folha.width, w * contagem);
    assert.equal(folha.height, h, 'as cinco linhas da base voltaram para a folha');

    const atlas = JSON.parse(readFileSync(join(blockPath, 'spritesheet.json'), 'utf-8')) as {
      frames: Record<string, { frame: { w: number; h: number } }>;
      meta: { size: { w: number; h: number } };
    };
    assert.deepEqual(atlas.meta.size, { w: w * contagem, h });
    assert.deepEqual(atlas.frames['frame_000']?.frame, { x: 0, y: 0, w, h });
    assert.equal(Object.keys(atlas.frames).length, contagem);

    // O que já estava certo não foi tocado — arte paga não se reescreve.
    assert.equal(readFileSync(join(blockPath, 'animation.json'), 'utf-8'), sidecar);
    for (let i = 0; i < contagem; i += 1) {
      assert.deepEqual(
        readFileSync(join(framesPath, `frame_${String(i).padStart(3, '0')}.png`)),
        framesAntes[i],
        `frame_${i} não pode ser reescrito`,
      );
    }
    assert.ok(
      logs.some((l) => l.includes('re-empacotada')),
      'o re-empacotamento tem de aparecer no log',
    );

    // IDEMPOTENTE: a segunda passada não reescreve nada.
    const folhaBytes = readFileSync(join(blockPath, 'spritesheet.png'));
    const atlasBytes = readFileSync(join(blockPath, 'spritesheet.json'));
    const logs2: string[] = [];
    await listWorldBlocks(assets, (m) => logs2.push(m));
    assert.deepEqual(readFileSync(join(blockPath, 'spritesheet.png')), folhaBytes);
    assert.deepEqual(readFileSync(join(blockPath, 'spritesheet.json')), atlasBytes);
    assert.ok(
      !logs2.some((l) => l.includes('re-empacotada')),
      'a segunda passada não pode re-empacotar nada',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Bloco de textura SEM `frames/` (ou com folha ilegível) não pode derrubar o
 * catálogo: ele continua listado, e quem degrada para o quadro parado é o
 * editor.
 */
test('bloco de textura sem frames/ não é re-empacotado nem some do catálogo', async () => {
  const dir = tmpDir();
  try {
    const assets = join(dir, 'assets');
    const hash = 'fefefefefefefefe';
    const blockPath = join(assets, 'world-blocks', hash);
    mkdirSync(blockPath, { recursive: true });
    const folhaOriginal = Buffer.from('nem PNG isto é');
    writeFileSync(join(blockPath, 'spritesheet.png'), folhaOriginal);
    writeFileSync(
      join(blockPath, 'block.json'),
      JSON.stringify({
        version: 3,
        hash,
        technique: 'texture',
        description: 'bloco sem frames em disco',
        action: 'x',
        animated: true,
        frameCount: 4,
        fps: 8,
      }),
    );

    const list = await listWorldBlocks(assets);
    assert.equal(list.length, 1, 'o bloco continua listado');
    assert.deepEqual(
      readFileSync(join(blockPath, 'spritesheet.png')),
      folhaOriginal,
      'sem frames não há o que re-empacotar: a folha fica como está',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Depois de uma geração normal a folha já nasce coerente com os frames — o
 * re-empacotamento não tem o que fazer. É o teste que impede a checagem de
 * virar reescrita a cada leitura do catálogo.
 */
test('folha recém-gerada não é re-empacotada', async () => {
  const dir = tmpDir();
  try {
    const result = await withFallbackAction(() =>
      runWorldBlock(new FakeClient(), textureConfig(), opts(dir)),
    );
    const assets = join(dir, 'assets');
    const antes = readFileSync(blockFile(dir, result.hash, 'spritesheet.png'));
    const logs: string[] = [];
    await listWorldBlocks(assets, (m) => logs.push(m));
    assert.deepEqual(readFileSync(blockFile(dir, result.hash, 'spritesheet.png')), antes);
    assert.ok(!logs.some((l) => l.includes('re-empacotada')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- concorrência

const FRAME_W = BLOCK_GEOMETRY.spriteWidth;
const FRAME_H = BLOCK_GEOMETRY.spriteHeight;

/** Grava como o código de produção grava: temporário + rename, nunca truncando. */
function escreveAtomico(path: string, data: Buffer | string): void {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function atlasJson(frameW: number, frameH: number, count: number): string {
  return JSON.stringify({
    frames: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `frame_${String(i).padStart(3, '0')}`,
        {
          frame: { x: i * frameW, y: 0, w: frameW, h: frameH },
          rotated: false,
          trimmed: false,
        },
      ]),
    ),
    meta: { image: 'spritesheet.png', size: { w: frameW * count, h: frameH } },
  });
}

/**
 * Um bloco de textura pronto em disco, com `frames/` íntegros e a folha no
 * estado que o teste pedir.
 */
function montaBlocoDeTextura(
  assets: string,
  hash: string,
  opcoes: {
    readonly count?: number;
    readonly frames?: (i: number) => Buffer;
    readonly sidecarFrameCount?: number | null;
  } = {},
): { blockPath: string; framesPath: string } {
  const count = opcoes.count ?? 9;
  const blockPath = join(assets, 'world-blocks', hash);
  const framesPath = join(blockPath, 'frames');
  mkdirSync(framesPath, { recursive: true });
  for (let i = 0; i < count; i += 1) {
    writeFileSync(
      join(framesPath, `frame_${String(i).padStart(3, '0')}.png`),
      opcoes.frames ? opcoes.frames(i) : makePNGRect(FRAME_W, FRAME_H, i + 1),
    );
  }
  const sidecarCount =
    opcoes.sidecarFrameCount === undefined ? count : opcoes.sidecarFrameCount;
  if (sidecarCount !== null) {
    writeFileSync(
      join(blockPath, 'animation.json'),
      JSON.stringify({ fps: 8, frameCount: sidecarCount, action: 'pulsa', pingPong: true }),
    );
  }
  writeFileSync(join(blockPath, 'base.png'), makePNGRect(FRAME_W, FRAME_H, 42));
  writeFileSync(
    join(blockPath, 'block.json'),
    JSON.stringify({
      version: 3,
      hash,
      technique: 'texture',
      description: 'bloco de teste de concorrência',
      geometry: {
        tileWidth: BLOCK_GEOMETRY.tileWidth,
        tileHeight: BLOCK_GEOMETRY.tileHeight,
        cubeHeight: BLOCK_GEOMETRY.cubeHeight,
        spriteWidth: FRAME_W,
        spriteHeight: FRAME_H,
      },
      action: 'pulsa',
      animated: true,
      frameCount: sidecarCount ?? count,
      fps: 8,
    }),
  );
  return { blockPath, framesPath };
}

/** Devolve a folha ao estado LEGADO (quadro quadrado), sem nunca truncar. */
function deixaFolhaObsoleta(blockPath: string, count: number): void {
  escreveAtomico(join(blockPath, 'spritesheet.png'), makePNGRect(FRAME_W * count, FRAME_W, 9));
  escreveAtomico(join(blockPath, 'spritesheet.json'), atlasJson(FRAME_W, FRAME_W, count));
}

/**
 * DEFEITO 1 — a escrita da folha acontece dentro de um caminho de LEITURA, e
 * até 2026-08-04 era um `writeFile` puro.
 *
 * `repackSpritesheetIfStale` roda dentro de `listWorldBlocks`, que atende
 * `GET /api/world-blocks`; ao mesmo tempo, `GET /world-blocks/<hash>/spritesheet.png`
 * lê o MESMO arquivo com um `readFile` simples. Numa medição de 40 rodadas com
 * um leitor concorrente, 153 de 1372 leituras vieram truncadas — tamanhos 0
 * (a janela do `O_TRUNC`), 7965 e 8192, para um arquivo final de 8296. Onze por
 * cento das leituras entregavam ao navegador um PNG quebrado, `img.onerror`
 * disparava e o bloco degradava para quadro parado.
 *
 * O leitor aqui é o mesmo `readFile` do servidor. A asserção não é sobre
 * tamanho: cada leitura é DECODIFICADA. Um PNG cortado no meio estoura no
 * inflate, e é isso que se conta.
 */
test('DEFEITO 1: leitor concorrente nunca pega a folha pela metade', async () => {
  const dir = tmpDir();
  try {
    const assets = join(dir, 'assets');
    const hash = 'c0ffee0000000001';
    const count = 9;
    const { blockPath } = montaBlocoDeTextura(assets, hash, { count });
    const sheetFile = join(blockPath, 'spritesheet.png');
    deixaFolhaObsoleta(blockPath, count);

    const tamanhos = new Set<number>();
    let leituras = 0;
    let quebradas = 0;
    let ausentes = 0;
    let lendo = true;

    const leitor = (async () => {
      while (lendo && leituras < 4_000) {
        let bytes: Buffer;
        try {
          bytes = await readFile(sheetFile);
        } catch {
          // Com rename o arquivo NUNCA some: o alvo já existe e é substituído
          // num passo só. Um ENOENT aqui já seria o defeito.
          ausentes += 1;
          continue;
        }
        leituras += 1;
        tamanhos.add(bytes.length);
        try {
          decodePngToRgba(bytes);
        } catch {
          quebradas += 1;
        }
      }
    })();

    // 30 rodadas de re-empacotamento, cada uma precedida de um retorno ao
    // estado obsoleto (também atômico — um writeFile aqui faria o teste acusar
    // a si mesmo).
    for (let rodada = 0; rodada < 30; rodada += 1) {
      deixaFolhaObsoleta(blockPath, count);
      const reescreveu = await repackSpritesheetIfStale(assets, hash);
      assert.equal(reescreveu, true, `rodada ${rodada}: a folha obsoleta tinha de ser reescrita`);
    }
    lendo = false;
    await leitor;

    assert.ok(leituras > 50, `o leitor precisa ter observado a janela de escrita (${leituras})`);
    assert.equal(ausentes, 0, 'a folha nunca pode sumir do disco: rename substitui em um passo');
    assert.equal(quebradas, 0, `nenhuma leitura pode vir truncada (${quebradas}/${leituras})`);
    // Sem rename, o `O_TRUNC` deixa aparecer 0 e os tamanhos parciais. Com
    // rename só existem os dois arquivos INTEIROS: o obsoleto e o corrigido.
    assert.ok(
      tamanhos.size <= 2,
      `só o arquivo antigo e o novo podem ser observados, vieram ${[...tamanhos].join(', ')}`,
    );
    assert.ok(!tamanhos.has(0), 'tamanho 0 é a janela do O_TRUNC, e ela não pode existir');

    const folha = readPngHeader(readFileSync(sheetFile));
    assert.deepEqual({ w: folha.width, h: folha.height }, { w: FRAME_W * count, h: FRAME_H });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * DEFEITO 1, segunda metade — `rename` deixa cada arquivo íntegro, mas não
 * impede dois re-empacotamentos SIMULTÂNEOS do mesmo bloco de decidirem sobre o
 * mesmo estado obsoleto e escreverem um por cima do outro.
 *
 * Dois `GET /api/world-blocks` sobrepostos são o caso normal, não o exótico:
 * duas abas, ou o poll de 3 s do painel de blocos cruzando com o `loadPalette()`
 * do editor de mapa. Com a serialização por bloco, o segundo espera, relê o
 * atlas já corrigido e conclui — corretamente — que não há nada a fazer.
 */
test('DEFEITO 1: re-empacotamentos concorrentes do mesmo bloco são serializados', async () => {
  const dir = tmpDir();
  try {
    const assets = join(dir, 'assets');
    const hash = 'c0ffee0000000002';
    const count = 9;
    const { blockPath } = montaBlocoDeTextura(assets, hash, { count });
    deixaFolhaObsoleta(blockPath, count);

    const resultados = await Promise.all(
      Array.from({ length: 8 }, () => repackSpritesheetIfStale(assets, hash)),
    );
    assert.equal(
      resultados.filter(Boolean).length,
      1,
      'exatamente UM dos oito pode ter reescrito a folha; os outros releem e desistem',
    );

    const folha = readPngHeader(readFileSync(join(blockPath, 'spritesheet.png')));
    assert.deepEqual({ w: folha.width, h: folha.height }, { w: FRAME_W * count, h: FRAME_H });
    const atlas = JSON.parse(
      readFileSync(join(blockPath, 'spritesheet.json'), 'utf-8'),
    ) as { meta: { size: { w: number; h: number } } };
    assert.deepEqual(atlas.meta.size, { w: FRAME_W * count, h: FRAME_H });

    // O mesmo pelo caminho por onde o servidor de fato passa.
    deixaFolhaObsoleta(blockPath, count);
    const listas = await Promise.all(Array.from({ length: 6 }, () => listWorldBlocks(assets)));
    for (const l of listas) assert.equal(l.length, 1);
    const depois = readPngHeader(readFileSync(join(blockPath, 'spritesheet.png')));
    assert.deepEqual({ w: depois.width, h: depois.height }, { w: FRAME_W * count, h: FRAME_H });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * DEFEITO 2 — a checagem decodificava os pixels de TODOS os quadros só para
 * comparar dimensões.
 *
 * Medido: 50 blocos de 9 quadros com o catálogo já correto levaram o
 * `GET /api/world-blocks` de 8,7–13,4 ms para 130–147 ms; dos 450 quadros,
 * `decodePngToRgba` custava 89 ms contra 2,5 ms de `readPngHeader`.
 *
 * Aqui a prova não é cronômetro — é comportamento. Os frames têm cabeçalho
 * válido e pixels podres: quem só lê o cabeçalho passa em silêncio, quem infla
 * estoura. As duas metades do teste são o par:
 *   - folha COERENTE  → nada a fazer, nenhum log: não decodificou.
 *   - folha OBSOLETA  → precisa reescrever, aí sim decodifica, e o erro aparece.
 */
test('DEFEITO 2: a checagem lê o cabeçalho, e só decodifica quando vai reescrever', async () => {
  const dir = tmpDir();
  try {
    const assets = join(dir, 'assets');
    const hash = 'c0ffee0000000003';
    const count = 9;
    const { blockPath } = montaBlocoDeTextura(assets, hash, {
      count,
      frames: () => makePNGCabecalhoValidoPixelsPodres(FRAME_W, FRAME_H),
    });

    // Folha e atlas COERENTES com o que os cabeçalhos declaram.
    const folhaBoa = makePNGRect(FRAME_W * count, FRAME_H, 3);
    escreveAtomico(join(blockPath, 'spritesheet.png'), folhaBoa);
    escreveAtomico(join(blockPath, 'spritesheet.json'), atlasJson(FRAME_W, FRAME_H, count));

    const logs: string[] = [];
    const reescreveu = await repackSpritesheetIfStale(assets, hash, (m) => logs.push(m));
    assert.equal(reescreveu, false, 'não há nada a fazer: a folha já bate com os frames');
    assert.deepEqual(
      logs,
      [],
      'nenhum log significa que os pixels NÃO foram inflados — se fossem, o ' +
        'IDAT podre teria estourado e reclamado',
    );
    assert.deepEqual(
      readFileSync(join(blockPath, 'spritesheet.png')),
      folhaBoa,
      'a folha não pode ser tocada',
    );

    // Agora a folha discorda: o caminho raro precisa dos pixels, e aí o IDAT
    // podre é descoberto — com log, e sem destruir a folha que existe.
    deixaFolhaObsoleta(blockPath, count);
    const folhaObsoleta = readFileSync(join(blockPath, 'spritesheet.png'));
    const logs2: string[] = [];
    const reescreveu2 = await repackSpritesheetIfStale(assets, hash, (m) => logs2.push(m));
    assert.equal(reescreveu2, false, 'frames ilegíveis não viram folha');
    assert.ok(
      logs2.some((l) => l.includes('não se deixam decodificar')),
      `o caminho de reescrita TEM de decodificar e reclamar: ${logs2.join(' | ')}`,
    );
    assert.deepEqual(
      readFileSync(join(blockPath, 'spritesheet.png')),
      folhaObsoleta,
      'falhar ao decodificar não pode apagar a folha que estava lá',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * DEFEITO 3 — `api.ts` chama `listWorldBlocks(ASSETS)` sem `onLog`, então a
 * mensagem do re-empacotamento não chegava a lugar nenhum. É o ÚNICO rastro de
 * que uma folha derivada de arte paga foi reescrita, e a doc da função dizia
 * "falha em silêncio (com log)" sobre um log que em produção não existia.
 *
 * `console.warn` sai por stderr — fd separado do protocolo v8 com prefixo de
 * tamanho pelo qual o `node --test` transporta os resultados —, então gritar
 * aqui não corrompe o stream de nenhum arquivo de teste.
 */
test('DEFEITO 3: o re-empacotamento grita no stderr mesmo sem onLog', async () => {
  const dir = tmpDir();
  const original = console.warn;
  try {
    const assets = join(dir, 'assets');
    const hash = 'c0ffee0000000004';
    const count = 5;
    const { blockPath } = montaBlocoDeTextura(assets, hash, { count });
    deixaFolhaObsoleta(blockPath, count);

    const avisos: string[] = [];
    console.warn = (...args: unknown[]): void => {
      avisos.push(args.map((a) => String(a)).join(' '));
    };
    // Exatamente como `api.ts` chama: sem onLog.
    const list = await listWorldBlocks(assets);
    console.warn = original;

    assert.equal(list.length, 1);
    assert.ok(
      avisos.some((a) => a.includes('folha re-empacotada a partir de frames/')),
      `o re-empacotamento tem de aparecer sem onLog: ${avisos.join(' | ')}`,
    );
    assert.ok(
      avisos.some((a) => a.includes('Nenhuma chamada à API')),
      'o aviso tem de dizer que nada foi pago de novo',
    );

    // E o caminho normal continua mudo: gritar a cada leitura do catálogo
    // treinaria qualquer um a ignorar o aviso.
    const avisos2: string[] = [];
    console.warn = (...args: unknown[]): void => {
      avisos2.push(args.map((a) => String(a)).join(' '));
    };
    await listWorldBlocks(assets);
    console.warn = original;
    assert.deepEqual(avisos2, [], 'a segunda passada não tem nada a dizer');
  } finally {
    console.warn = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * MENOR 2 — `frames/` é o que o `readdir` encontrar, e isso não é a mesma coisa
 * que o número de quadros pagos. Um `frame_009.png` órfão, deixado por uma
 * execução interrompida, faria a folha nascer com 10 quadros enquanto o
 * `animation.json` declara 9; o editor recusaria a folha no `checkSheet` e o
 * bloco pararia de animar. O sidecar é escrito pela mesma função que grava os
 * frames, então é ele a autoridade sobre a contagem.
 */
test('MENOR: frame órfão não entra na folha — o animation.json manda na contagem', async () => {
  const dir = tmpDir();
  try {
    const assets = join(dir, 'assets');
    const hash = 'c0ffee0000000005';
    // 10 PNGs em disco, sidecar declarando 9.
    const { blockPath, framesPath } = montaBlocoDeTextura(assets, hash, {
      count: 10,
      sidecarFrameCount: 9,
    });
    deixaFolhaObsoleta(blockPath, 10);

    const logs: string[] = [];
    assert.equal(await repackSpritesheetIfStale(assets, hash, (m) => logs.push(m)), true);

    const folha = readPngHeader(readFileSync(join(blockPath, 'spritesheet.png')));
    assert.deepEqual(
      { w: folha.width, h: folha.height },
      { w: FRAME_W * 9, h: FRAME_H },
      'a folha tem os 9 quadros que o sidecar declara, não os 10 arquivos',
    );
    const atlas = JSON.parse(
      readFileSync(join(blockPath, 'spritesheet.json'), 'utf-8'),
    ) as { frames: Record<string, unknown> };
    assert.equal(Object.keys(atlas.frames).length, 9);
    assert.ok(
      logs.some((l) => l.includes('animation.json declara 9')),
      `a divergência tem de aparecer: ${logs.join(' | ')}`,
    );
    assert.ok(
      existsSync(join(framesPath, 'frame_009.png')),
      'o PNG sobrando fica em disco: arte paga não se apaga por conta própria',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * MENOR 3 — até 2026-08-04 `sheetNeedsRepack` só comparava o `.json` com os
 * frames. Uma folha com os PIXELS corrompidos ao lado de um atlas coerente era
 * invisível para sempre: o editor recusava a animação e nada nunca reescrevia a
 * folha. Ler o cabeçalho dela custa o mesmo que já se paga por cada frame.
 */
test('MENOR: folha corrompida com atlas coerente é detectada e reescrita', async () => {
  const dir = tmpDir();
  try {
    const assets = join(dir, 'assets');
    const hash = 'c0ffee0000000006';
    const count = 9;
    const { blockPath } = montaBlocoDeTextura(assets, hash, { count });

    // Atlas PERFEITO; folha que não é PNG nenhum.
    escreveAtomico(join(blockPath, 'spritesheet.json'), atlasJson(FRAME_W, FRAME_H, count));
    escreveAtomico(join(blockPath, 'spritesheet.png'), Buffer.from('bytes que já foram um PNG'));

    const logs: string[] = [];
    assert.equal(await repackSpritesheetIfStale(assets, hash, (m) => logs.push(m)), true);
    assert.ok(
      logs.some((l) => l.includes('não se deixa ler como PNG')),
      `o motivo tem de nomear a folha ilegível: ${logs.join(' | ')}`,
    );
    const folha = readPngHeader(readFileSync(join(blockPath, 'spritesheet.png')));
    assert.deepEqual({ w: folha.width, h: folha.height }, { w: FRAME_W * count, h: FRAME_H });

    // E a folha de tamanho ERRADO com atlas coerente também: os dois discordam
    // do disco, não um do outro.
    assert.match(
      sheetNeedsRepack(
        { frameWidth: 48, frameHeight: 53, frameCount: 9, sheetWidth: 432, sheetHeight: 53 },
        { count: 9, first: { width: 48, height: 53 } },
        { width: 432, height: 48 },
      ) ?? '',
      /em disco é 432×48 e o atlas declara 432×53/,
    );
    // Sem o terceiro argumento nada muda: quem não quis olhar os bytes continua
    // decidindo só pelo JSON.
    assert.equal(
      sheetNeedsRepack(
        { frameWidth: 48, frameHeight: 53, frameCount: 9, sheetWidth: 432, sheetHeight: 53 },
        { count: 9, first: { width: 48, height: 53 } },
      ),
      null,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * MENOR 1 — `ANIMATION_PIXEL_BUDGET` era exportado e não tinha um único uso no
 * repositório. Agora ele é o teto que a submissão da animação confere, e este
 * teste é quem o mantém honesto: se a geometria do projeto crescer, ou se
 * `ANIMATION_FRAME_COUNTS` ganhar um valor maior, é aqui que se descobre — e
 * não num 4xx opaco do fornecedor depois de o cubo já ter sido pago.
 */
test('MENOR: todo frameCount do projeto cabe no teto de pixels do endpoint', () => {
  for (const n of [0, 4, 8, 16] as const) {
    const usado = animationPixelBudget(FRAME_W, FRAME_H, n);
    assert.ok(
      usado <= ANIMATION_PIXEL_BUDGET,
      `frameCount ${n}: ${usado} px passa do teto ${ANIMATION_PIXEL_BUDGET}`,
    );
  }
  // O teto não é decorativo: o limite de 256×256 do próprio endpoint o estoura.
  assert.ok(animationPixelBudget(256, 256, 16) > ANIMATION_PIXEL_BUDGET);
  assert.equal(ANIMATION_PIXEL_BUDGET, 524_288, 'o número é do spec vendorizado');
});
