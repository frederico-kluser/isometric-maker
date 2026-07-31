/**
 * animateCharacter — geração de animação com guard, ledger e idempotência (F1-07).
 *
 * animate-character cobra POR DIREÇÃO. Cada uma das 8 direcções gera uma
 * requisição assíncrona. Este módulo submete, espera (poll), grava os frames
 * e escreve uma linha de ledger por direcção com usage cru.
 *
 * ## Modos
 *
 *   • `mode:'template'` com `template_animation_id` — 1 gen/direcção.
 *     Usado para andar (`walking-4-frames`, confirmado por E2).
 *   • `mode:'v3'` com `action_description` + `frame_count` — 1-40 gen/direcção.
 *     Usado para correr e pular. `keep_first_frame: true` é sempre enviado
 *     neste modo.
 *
 * ## Teto (ceiling)
 *
 * `animateCeiling(input)` devolve o pior caso: "até N gerações · até US$ X".
 * Usado para mostrar o custo máximo ANTES do botão de confirmação.
 *
 * ## Idempotência
 *
 * Hash determinístico sobre (characterId, seed, mode, templateId/action,
 * frameCount). Se os PNGs já existirem no outputDir, NENHUMA chamada é feita.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PixelLabClient, pollJob, type ApiResult } from '../../pixellab-pipeline/src/api.ts';
import {
  COST_TABLE, estimateByArea, checkBudget,
  type BudgetReport,
} from '../../pixellab-pipeline/src/cost.ts';
import { DIRECTIONS } from './model.ts';
import { trackSpend } from './estimate.ts';

// ------------------------------------------------------------------ tipos

export interface AnimateInput {
  /** ID remoto do personagem (character_id da API). */
  readonly characterId: string;
  readonly seed: number;
  readonly imageSize: { readonly width: number; readonly height: number };
  /** 'template' para walking-4-frames, 'v3' para correr/pular. */
  readonly mode: 'template' | 'v3';
  /** ID do template (ex.: 'walking-4-frames'). Só usado com mode='template'. */
  readonly templateAnimationId?: string;
  /** Descrição da acção (ex.: 'running forward'). Só usado com mode='v3'. */
  readonly actionDescription?: string;
  /** Número de frames. Obrigatório com mode='v3'. */
  readonly frameCount?: number;
  /** true só com mode='v3'. Congela o primeiro frame. */
  readonly keepFirstFrame?: boolean;
  /** Directório onde as PNGs serão escritas. */
  readonly outputDir: string;
}

export interface AnimateResult {
  /** Mapa direcção → caminhos relativos dos ficheiros PNG. */
  readonly frames: Record<string, string[]>;
}

export interface AnimateCeiling {
  /** Pior caso de gerações. */
  readonly maxGenerations: number;
  /** Pior caso de custo em USD. */
  readonly maxCostUsd: number;
  /** String formatada para mostrar na UI: "até N gerações · até US$ X". */
  readonly label: string;
}

// ------------------------------------------------------------------ idempotência

function idempotencyHash(input: AnimateInput): string {
  const h = createHash('sha256');
  h.update(`characterId=${input.characterId}`);
  h.update(`|seed=${input.seed}`);
  h.update(`|mode=${input.mode}`);
  if (input.mode === 'template') {
    h.update(`|template=${input.templateAnimationId ?? ''}`);
  } else {
    h.update(`|action=${input.actionDescription ?? ''}`);
    h.update(`|frameCount=${input.frameCount ?? 4}`);
    h.update(`|keepFirst=${input.keepFirstFrame ?? false}`);
  }
  return h.digest('hex').slice(0, 16);
}

function outputDirForHash(hash: string, baseDir: string): string {
  return join(baseDir, hash);
}

function allFramesExist(hash: string, baseDir: string): boolean {
  const dir = outputDirForHash(hash, baseDir);
  if (!existsSync(dir)) return false;
  // Verifica que todas as 8 direcções têm pelo menos um frame.
  for (const d of DIRECTIONS) {
    const pattern = `${d}-00.png`;
    if (!existsSync(join(dir, pattern))) return false;
  }
  return true;
}

// ------------------------------------------------------------------ teto (ceiling)

/**
 * Devolve o pior caso de custo para a animação.
 *
 * O pior caso usa o limite superior do intervalo de gerações e de USD.
 * Template: 1 gen/direcção. v3: até 40 gen/direcção (pior caso).
 */
export function animateCeiling(input: AnimateInput): AnimateCeiling {
  const area = input.imageSize.width * input.imageSize.height;
  const costRule = COST_TABLE['animate-character'];
  const single = estimateByArea(costRule, area);

  const gensPerDir =
    input.mode === 'template'
      ? 1
      : (costRule.generations?.[1] ?? 40); // pior caso do v3

  const maxGenerations = gensPerDir * 8;
  const maxCostUsd = single.high * 8;

  const label = `até ${maxGenerations} gerações · até US$ ${maxCostUsd.toFixed(2)}`;

  return { maxGenerations, maxCostUsd, label };
}

// ------------------------------------------------------------------ estimativa (guard)

/**
 * Estima o custo da animação e devolve o relatório do guard.
 * Não faz chamada de rede — pode ser chamado antes da confirmação.
 */
export function estimateAnimate(input: AnimateInput, monthSpent: number, sessionSpent: number): BudgetReport {
  const area = input.imageSize.width * input.imageSize.height;
  const costRule = COST_TABLE['animate-character'];
  const single = estimateByArea(costRule, area);

  // 8 direcções
  const estimate = {
    low: single.low * 8,
    point: single.point * 8,
    high: single.high * 8,
    confidence: single.confidence,
  };

  return checkBudget({
    estimate,
    maxSingleAssetUsd: single.point,
    spentThisMonthUsd: monthSpent,
    spentThisSessionUsd: sessionSpent,
    balanceUsd: undefined,
  });
}

// ------------------------------------------------------------------ execução

function appendLedger(path: string, line: Record<string, unknown>): void {
  mkdirSync(join(path, '..'), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`);
}

/** Extrai imagens de um payload de resposta da API (qualquer formato). */
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

/** Extrai todos os job IDs de um payload aninhado. */
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

/**
 * Submete a animação, faz poll de todos os jobs, grava frames e ledger.
 *
 * PRÉ-CONDIÇÃO: o caller já deve ter mostrado o ceiling e obtido confirmação.
 *
 * @param client PixelLabClient (real ou falso para teste).
 * @param input Parâmetros da animação.
 * @param opts.ledgerPath Caminho para o ledger ndjson.
 * @param opts.onLog Callback de progresso.
 */
export async function animateCharacter(
  client: PixelLabClient,
  input: AnimateInput,
  opts?: {
    readonly ledgerPath?: string;
    readonly onLog?: (msg: string) => void;
    /** Poll inicial (ms). Default: 5000. Use 0 em testes com cliente falso. */
    readonly pollInitialMs?: number;
    /** Poll steady (ms). Default: 10000. */
    readonly pollSteadyMs?: number;
    /** Timeout total (ms). Default: 900000. */
    readonly pollTimeoutMs?: number;
  },
): Promise<AnimateResult> {
  const hash = idempotencyHash(input);
  const frameDir = outputDirForHash(hash, input.outputDir);

  // Idempotência: frames já existentes = não gasta.
  if (allFramesExist(hash, input.outputDir)) {
    opts?.onLog?.(`[animate] Frames já existem para hash=${hash}. Pulando.`);
    const frames = readExistingFrames(frameDir);
    return { frames };
  }

  await mkdir(frameDir, { recursive: true });

  // Monta o corpo da requisição.
  const body: Record<string, unknown> = {
    character_id: input.characterId,
    seed: input.seed,
    directions: [...DIRECTIONS], // SEMPRE explícito com as 8
  };

  if (input.mode === 'template') {
    body['mode'] = 'template';
    body['template_animation_id'] = input.templateAnimationId;
  } else {
    body['mode'] = 'v3';
    body['action_description'] = input.actionDescription;
    body['frame_count'] = input.frameCount ?? 4;
    // keep_first_frame: mode='v3' APENAS
    body['keep_first_frame'] = input.keepFirstFrame ?? true;
  }

  opts?.onLog?.(`[animate] Submetendo animate-character (mode=${input.mode})...`);

  const res = await client.submit<Record<string, unknown>>('animate-character', body);

  // Tracking de sessão: o dinheiro já saiu na submissão.
  if (typeof res.usage?.usd === 'number') {
    trackSpend(res.usage.usd);
  }

  // Ledger da submissão principal.
  if (opts?.ledgerPath) {
    const usage = res.usage;
    appendLedger(opts.ledgerPath, {
      at: new Date().toISOString(),
      endpoint: 'animate-character',
      mode: input.mode,
      usd: usage?.usd ?? null,
      generations: usage?.generations ?? null,
      unit: usage?.type ?? 'unknown',
    });
  }

  // Extrai job IDs. animate-character devolve um job POR DIREÇÃO.
  const ids = collectJobIds(res.data);
  if (ids.length === 0) {
    opts?.onLog?.('[animate] Nenhum job_id encontrado. Tentando extrair imagens da resposta directa...');
    // Pode ser que seja síncrono em alguns modos.
    const images = extractImages(res.data);
    if (images.length > 0) {
      return writeAnimateFrames(frameDir, images);
    }
    throw new Error('a API não devolveu nenhum job id nem imagens');
  }

  opts?.onLog?.(`[animate] ${ids.length} jobs para fazer poll...`);

  // Poll de cada job.
  const allImages: string[] = [];
  for (const id of ids) {
    opts?.onLog?.(`[animate] Polling job ${id}...`);
    const polled = await pollJob(client, id, {
      timeoutMs: opts?.pollTimeoutMs ?? 900_000,
      initialMs: opts?.pollInitialMs ?? 5_000,
      steadyMs: opts?.pollSteadyMs ?? 10_000,
    });
    if (!polled.ok) {
      opts?.onLog?.(`[animate] Job ${id} falhou: ${polled.reason}`);
      continue;
    }

    const response = polled.job.last_response ?? polled.job;
    const images = extractImages(response);
    allImages.push(...images);

    // Ledger por direcção (uma linha por job).
    if (opts?.ledgerPath) {
      const jobUsage = (polled.job as { usage?: { usd?: number; generations?: number; type?: string } }).usage;
      appendLedger(opts.ledgerPath, {
        at: new Date().toISOString(),
        jobId: id,
        endpoint: 'animate-character',
        poll: 'ok',
        usd: jobUsage?.usd ?? null,
        generations: jobUsage?.generations ?? null,
        unit: jobUsage?.type ?? 'unknown',
      });
    }
  }

  if (allImages.length === 0) {
    throw new Error('nenhuma direcção retornou imagem');
  }

  return writeAnimateFrames(frameDir, allImages);
}

// ------------------------------------------------------------------ gravação de frames

/**
 * Escreve os frames em disco e devolve o mapa direcção → paths.
 *
 * Os frames chegam em ordem canónica (8 direcções), com N frames por direcção.
 */
async function writeAnimateFrames(
  dir: string,
  images: string[],
): Promise<AnimateResult> {
  const frames: Record<string, string[]> = {};
  const perDir = Math.max(1, Math.floor(images.length / DIRECTIONS.length));

  for (const [di, dir8] of DIRECTIONS.entries()) {
    const list: string[] = [];
    for (let f = 0; f < perDir; f += 1) {
      const idx = di * perDir + f;
      const b64 = images[idx];
      if (!b64) continue;
      const name = `${dir8}-${String(f).padStart(2, '0')}.png`;
      await writeFile(join(dir, name), Buffer.from(b64, 'base64'));
      list.push(join(dir, name));
    }
    if (list.length > 0) frames[dir8] = list;
  }

  return { frames };
}

/** Lê frames já existentes para devolver o resultado na idempotência. */
function readExistingFrames(dir: string): AnimateResult {
  const frames: Record<string, string[]> = {};
  for (const d of DIRECTIONS) {
    const list: string[] = [];
    for (let f = 0; f < 99; f += 1) {
      const name = `${d}-${String(f).padStart(2, '0')}.png`;
      if (existsSync(join(dir, name))) {
        list.push(join(dir, name));
      }
    }
    if (list.length > 0) frames[d] = list;
  }
  return { frames };
}
