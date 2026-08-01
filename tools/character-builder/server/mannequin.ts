/**
 * Fluxo do wizard do manequim (studio.json v2).
 *
 * Cadeia derivativa v3, na ordem em que o dinheiro sai:
 *   1. generateSouthFromText — sul por texto via /create-image-bitforge.
 *   2. editSouth           — edição iterativa da sul ativa via /edit-image.
 *   3. undoSouth           — volta uma versão, SEM chamada de API.
 *   4. generateDirections8 — /create-character-v3 com o sprite sul como
 *      reference_image: o modelo v3 rotaciona sozinho para as 8 direções.
 *      O passo de cardeais (/rotate) foi removido com a migração para v3.
 *
 * Regras que valem para todo o módulo:
 *   - PNG gravado em disco ANTES de qualquer pós-processamento: depois da
 *     cobrança, perder a imagem é dinheiro perdido.
 *   - Guard de orçamento (ADR 0012): estima, loga, escreve ledger — nunca recusa.
 *   - Idempotência: célula `pronto` = não gera de novo.
 *   - isometric é OMITIDO do request quando false (F0-09) — preserva specHash.
 *   - view 'low top-down' em tudo (ADR 0005).
 *
 * Decisões de API confirmadas no spec vendorizado
 * (tools/pixellab-pipeline/openapi/openapi-v2.json, capturado 2026-07-29):
 *   - /create-image-bitforge: SÍNCRONO (200 {image, usage}), required
 *     description+image_size, tamanho 16–200, aceita view/direction/no_background/seed.
 *   - /edit-image: ASSÍNCRONO (202 {background_job_id}), required
 *     image+image_size+description+width+height. image_size é o tamanho da
 *     imagem de REFERÊNCIA; width/height são o canvas ALVO — não são
 *     intercambiáveis. Resultado chega em last_response do background job.
 *   - /rotate: SÍNCRONO, pode responder 529 (o PixelLabClient já trata 429/529).
 *   - /create-character-v3: ASSÍNCRONO (200 {background_job_id, character_id}).
 *     Dois modos: reference_image (sprite sul, máx 256×256 — o modelo rotaciona
 *     para 8 direções) e from-scratch (description + outline/detail opcionais).
 *     Custo reference: ceil(w×h×8 / 65536) gerações. image_size é advisory em
 *     modo reference. outline/detail são IGNORADOS com reference_image.
 *     template_id define o template de esqueleto (mannequin/bear/cat/dog/horse/lion).
 *   - color_image (paleta forçada / referência de cor) existe em
 *     /create-image-bitforge — é o mecanismo que prende um personagem derivado
 *     à paleta do manequim. /create-character-v3 não tem color_image.
 *   - Qualidade (detail/outline): o bitforge aceita; o v3 reference mode ignora.
 *     shading e text_guidance_scale NÃO EXISTEM no v3.
 *     init_image + init_image_strength (inteiro 1–999, default 300) existem
 *     SÓ no bitforge.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PixelLabClient } from '../../pixellab-pipeline/src/api.ts';
import { pollJob } from '../../pixellab-pipeline/src/api.ts';
import {
  COST_TABLE, estimateByArea, checkBudget,
  type BudgetReport, type CostEstimate,
} from '../../pixellab-pipeline/src/cost.ts';
import { trackSpend } from './estimate.ts';
import { parseAndWriteFrames } from './frames.ts';
// verifyFreezing removido com migração para v3 — o endpoint não tem mapa directions.

import { validateImport } from '../src/import.ts';
import {
  cardinalKey, directions8Key, southKey,
  type Cell, type Character, type MannequinLock, type Studio, type WizardState,
} from './model.ts';

// ------------------------------------------------------------------ tipos públicos

/** Persistência do studio.json — implementada por api.ts na fase 3. */
export interface StudioStore {
  load(): Promise<Studio>;
  save(s: Studio): Promise<void>;
}

export interface WizardOpts {
  /** Raiz dos assets (onde ficam wizard/ e o ledger). */
  readonly assetsDir: string;
  /** Caminho do ledger ndjson. */
  readonly ledgerPath: string;
  readonly onLog?: (msg: string) => void;
  /**
   * Referência do manequim para personagens derivados (api.ts preenche com o
   * PNG da sul do manequim, lido do disco). Quando `colorImageB64` está
   * presente, ele vai como `color_image` nos dois endpoints do fluxo que o
   * aceitam no spec vendorizado — /create-image-bitforge ("forced color
   * palette") e /create-character-with-8-directions ("color palette
   * reference") — prendendo a paleta do derivado à do manequim. Enviado como
   * b64 puro, mesmo formato que o módulo já usa para from_image/directions.
   * Ausente no wizard do próprio manequim.
   */
  readonly reference?: { readonly colorImageB64?: string };
}

// ------------------------------------------------------------------ paths

function wizardDir(assetsDir: string, characterId: string): string {
  return join(assetsDir, 'wizard', characterId);
}

function southPath(assetsDir: string, characterId: string, version: number): string {
  return join(wizardDir(assetsDir, characterId), `south-v${version}.png`);
}

function cardinalPath(
  assetsDir: string,
  characterId: string,
  direction: 'east' | 'north' | 'west',
): string {
  return join(wizardDir(assetsDir, characterId), `cardinal-${direction}.png`);
}

/** Referência visual da sul (upload do usuário) — lida por generateSouthFromText. */
function referencePath(assetsDir: string, characterId: string): string {
  return join(wizardDir(assetsDir, characterId), 'reference.png');
}

/** Path público servido pela UI, no mesmo formato que parseAndWriteFrames devolve. */
function publicPath(characterId: string, fileName: string): string {
  return `/assets/wizard/${characterId}/${fileName}`;
}

// ------------------------------------------------------------------ helpers

function requireCharacter(s: Studio, characterId: string): Character {
  const ch = s.characters.find((c) => c.id === characterId);
  if (!ch) throw new Error(`personagem "${characterId}" não encontrado`);
  return ch;
}

function requireWizard(ch: Character): WizardState {
  if (!ch.wizard) {
    throw new Error(
      `o personagem "${ch.id}" não está no fluxo do wizard (sem wizard state)`,
    );
  }
  return ch.wizard;
}

/** Lê um PNG do disco como base64, com erro nomeado quando falta. */
async function readB64(path: string, label: string): Promise<string> {
  try {
    return (await readFile(path)).toString('base64');
  } catch {
    throw new Error(`arquivo da ${label} não encontrado no disco: ${path}`);
  }
}

/** Extrai b64 puro de uma imagem que pode vir como string ou objeto {type, base64}. */
function extractBase64(image: unknown): string {
  if (typeof image === 'string') return image.replace(/^data:image\/\w+;base64,/, '');
  if (image && typeof image === 'object' && 'base64' in image) {
    const b = (image as Record<string, unknown>)['base64'];
    if (typeof b === 'string') return b;
  }
  return '';
}

/** Envolve b64 puro no formato de objeto que a API espera (>= 2026-08). */
function asBase64Image(raw: string): { type: 'base64'; base64: string } {
  return { type: 'base64', base64: raw };
}

/** @deprecated use extractBase64 */
function stripDataUri(b64: string): string {
  return b64.replace(/^data:image\/\w+;base64,/, '');
}

function appendLedger(path: string, line: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`);
}

/** O guard informa e nunca recusa (ADR 0012): estimativa vai para o log. */
function logGuard(
  label: string,
  report: BudgetReport,
  onLog?: (msg: string) => void,
): void {
  const e = report.estimate;
  onLog?.(
    `[guard] ${label}: ${e.point.toFixed(4)} USD ` +
      `(faixa ${e.low.toFixed(4)}–${e.high.toFixed(4)}, confiança ${e.confidence})`,
  );
  for (const a of report.avisos) {
    onLog?.(`[guard]   aviso [${a.code}]: ${a.text}`);
  }
}

/**
 * Threading dos campos de qualidade do lock para o corpo do request:
 * detail/shading/outline vão com o nome próprio e guidanceScale vira
 * text_guidance_scale. Cada campo é OMITIDO quando ausente no lock (F0-09) —
 * ausente = default da API. extra_guidance_scale NUNCA é enviado: o spec o
 * marca como deprecated.
 *
 * Vale para /create-image-bitforge (enums estritos) e para
 * /create-character-with-8-directions (string livre, "soft guidance" — o
 * modelo pode não seguir à risca, e o mode 'pro' os ignora; o wizard usa
 * 'standard').
 */
function threadQuality(
  lock: MannequinLock | undefined,
  body: Record<string, unknown>,
): void {
  if (!lock) return;
  if (lock.detail !== undefined) body['detail'] = lock.detail;
  if (lock.shading !== undefined) body['shading'] = lock.shading;
  if (lock.outline !== undefined) body['outline'] = lock.outline;
  if (lock.guidanceScale !== undefined) body['text_guidance_scale'] = lock.guidanceScale;
}

function guardFor(estimate: CostEstimate, maxSingleAssetUsd: number): BudgetReport {
  return checkBudget({
    estimate,
    maxSingleAssetUsd,
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: undefined,
  });
}

/** Valida o PNG retornado contra o tamanho esperado do personagem. */
function validateGeneratedPng(rawB64: string, size: number, label: string): void {
  const buf = Buffer.from(rawB64, 'base64');
  const validation = validateImport(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    size,
  );
  if (!validation.ok) {
    throw new Error(`${label} gerada é inválida: ${validation.error}`);
  }
  if (validation.width !== size) {
    throw new Error(
      `${label} gerada tem ${validation.width}×${validation.height} px, ` +
        `mas o personagem espera ${size}×${size}. ` +
        `O mapa directions exige que todas as imagens tenham as dimensões de image_size.`,
    );
  }
}

/** Atualiza a célula da sul para apontar a versão ativa e persiste. */
async function pointSouthCell(
  store: StudioStore,
  s: Studio,
  characterId: string,
  version: number,
  costUsd?: number,
): Promise<void> {
  const key = southKey(characterId);
  const prev = s.cells[key];
  const cell: Cell = {
    ...(prev ?? { key }),
    key,
    status: 'pronto',
    frames: { south: [publicPath(characterId, `south-v${version}.png`)] },
    updatedAt: new Date().toISOString(),
    ...(costUsd != null ? { costUsd } : {}),
  };
  s.cells[key] = cell;
  await store.save(s);
}

// ------------------------------------------------------------------ 1. sul por texto

/** Resposta síncrona com uma imagem única (bitforge, rotate). */
interface ImageResponse {
  readonly image?: string;
}

/**
 * Gera a face sul por texto via /create-image-bitforge (síncrono).
 *
 * Gerar do zero REINICIA o ciclo de edições: southVersions vira uma lista de
 * um elemento e activeSouth volta a 0 — por isso o arquivo é sempre south-v0.png.
 *
 * Idempotência: célula pronta cujo prompt da versão ativa é este mesmo →
 * nenhuma chamada sai.
 */
export async function generateSouthFromText(
  client: PixelLabClient,
  store: StudioStore,
  characterId: string,
  description: string,
  opts: WizardOpts,
): Promise<void> {
  const s = await store.load();
  const ch = requireCharacter(s, characterId);
  const wiz = requireWizard(ch);
  const key = southKey(characterId);

  const existing = s.cells[key];
  if (
    existing?.status === 'pronto' &&
    wiz.southVersions[wiz.activeSouth]?.prompt === description
  ) {
    opts.onLog?.('[wizard] sul já gerada para este prompt — idempotente, pulando.');
    return;
  }

  const size = ch.size;

  // Guard: informa, nunca recusa.
  const estimate = estimateByArea(COST_TABLE['create-image-bitforge'], size * size);
  logGuard('create-image-bitforge (sul por texto)', guardFor(estimate, estimate.point), opts.onLog);

  const body: Record<string, unknown> = {
    description,
    image_size: { width: size, height: size },
    view: 'low top-down',
    direction: 'south',
    no_background: true,
    seed: ch.seed,
  };
  // isometric: OMITIDO quando false (F0-09).
  if (ch.isometric) body['isometric'] = true;
  // color_image: OMITIDO sem referência (wizard do manequim). Com referência,
  // prende a paleta do derivado à do manequim (spec: "forced color palette").
  const colorImage = opts.reference?.colorImageB64;
  if (colorImage) body['color_image'] = asBase64Image(colorImage);
  // Qualidade do lock (detail/shading/outline/text_guidance_scale) — cada
  // campo omitido quando ausente (F0-09).
  threadQuality(s.lock, body);
  // Referência visual da sul (upload do usuário em reference.png): vai como
  // init_image com strength 500 — a faixa oficial 400–600 é a de "variações
  // fiéis de uma imagem existente"; o default 300 só transfere cor grosseira.
  // Mesmo formato de objeto base64 que color_image já usa. OMITIDO sem o
  // arquivo: a sul volta ao modo texto puro.
  const refPath = referencePath(opts.assetsDir, characterId);
  if (existsSync(refPath)) {
    const refB64 = await readFile(refPath, 'base64');
    body['init_image'] = asBase64Image(refB64);
    body['init_image_strength'] = 500;
  }

  const res = await client.submit<ImageResponse>('create-image-bitforge', body);

  // Gravar PNG ANTES de qualquer pós-processamento — a cobrança já aconteceu.
  const raw = extractBase64(res.data?.image);
  if (!raw) {
    throw new Error(
      `/create-image-bitforge não devolveu campo "image". Resposta: ${res.raw.slice(0, 200)}`,
    );
  }
  const filePath = southPath(opts.assetsDir, characterId, 0);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(raw, 'base64'));
  opts.onLog?.(`[wizard] sul v0 → ${filePath} (${raw.length} chars b64)`);

  // Só depois de gravado: validar dimensões contra character.size.
  validateGeneratedPng(raw, size, 'sul');

  if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);
  const usage = res.usage;
  appendLedger(opts.ledgerPath, {
    at: new Date().toISOString(),
    characterId,
    endpoint: 'create-image-bitforge',
    usd: usage?.usd ?? null,
    generations: usage?.generations ?? null,
    unit: usage?.type ?? 'unknown',
  });

  // Gerar do zero reinicia o histórico de edições: versão única, activeSouth = 0.
  const at = new Date().toISOString();
  ch.wizard = {
    etapa: 'cardeais',
    southVersions: [{ prompt: description, at }],
    activeSouth: 0,
  };
  // Character.description é readonly: grava substituindo o elemento no array.
  const idx = s.characters.findIndex((c) => c.id === characterId);
  if (idx >= 0) s.characters[idx] = { ...ch, description };
  await pointSouthCell(store, s, characterId, 0, usage?.usd ?? undefined);
}

// ------------------------------------------------------------------ 2. editar a sul

interface EditImageSubmitResponse {
  readonly background_job_id?: string;
  readonly status?: string;
}

/** Extrai a imagem editada do last_response do job (campo `image`, padrão da família). */
function extractEditedImage(lastResponse: unknown): string | null {
  if (!lastResponse || typeof lastResponse !== 'object') return null;
  const v = (lastResponse as Record<string, unknown>)['image'];
  if (!v) return null;
  const raw = extractBase64(v);
  return raw || null;
}

/**
 * Edita a sul ATIVA por prompt puro via /edit-image (assíncrono, 202).
 *
 * Preferência pelo /edit-image sobre /inpaint: edição por prompt puro não tem
 * máscara — e máscara tem polaridade (branco = onde edita) para errar em silêncio.
 * /edit-image NÃO está em EndpointId (o pipeline modela só o que usa), então a
 * chamada vai por client.request com o path literal.
 *
 * Cada edição grava south-v<N+1>.png, empurra uma SouthVersion e avança
 * activeSouth. Editar depois de um undo descarta o ramo de redo à frente
 * (como todo editor). Se a versão seguinte já existir com ESTE prompt, a
 * edição já foi feita — vira redo de graça, sem API.
 *
 * Idempotência: mesmo prompt que gerou a versão ativa → nenhuma chamada sai.
 */
export async function editSouth(
  client: PixelLabClient,
  store: StudioStore,
  characterId: string,
  prompt: string,
  opts: WizardOpts,
): Promise<void> {
  const s = await store.load();
  const ch = requireCharacter(s, characterId);
  const wiz = requireWizard(ch);
  const key = southKey(characterId);

  if (s.cells[key]?.status !== 'pronto') {
    throw new Error('gere a sul antes de editar — não há versão ativa');
  }
  const active = wiz.activeSouth;
  const current = wiz.southVersions[active];
  if (!current) {
    throw new Error(`versão ativa da sul (índice ${active}) não existe no histórico`);
  }

  // Redo de graça: a versão seguinte já existe com este mesmo prompt.
  const next = wiz.southVersions[active + 1];
  if (next && next.prompt === prompt) {
    if (!existsSync(southPath(opts.assetsDir, characterId, active + 1))) {
      throw new Error(
        `arquivo da versão ${active + 1} da sul não existe no disco — não dá para refazer sem regenerar`,
      );
    }
    ch.wizard = { ...wiz, activeSouth: active + 1 };
    await pointSouthCell(store, s, characterId, active + 1);
    opts.onLog?.(`[wizard] edição já existia como v${active + 1} — redo sem chamar a API.`);
    return;
  }

  // Idempotência: a versão ativa já foi criada por este prompt (edições vêm de v1 em diante).
  if (active > 0 && current.prompt === prompt) {
    opts.onLog?.('[wizard] mesmo prompt sobre a mesma versão ativa — idempotente, pulando.');
    return;
  }

  const size = ch.size;
  const activeB64 = await readB64(
    southPath(opts.assetsDir, characterId, active),
    `sul v${active}`,
  );

  // Guard: a COST_TABLE não modela /edit-image; usamos bitforge como proxy de
  // preço estimado (mesma família de imagem única). Marcado como estimativa.
  const estimate = estimateByArea(COST_TABLE['create-image-bitforge'], size * size);
  logGuard(
    'edit-image (edição da sul; estimativa por proxy bitforge)',
    guardFor(estimate, estimate.point),
    opts.onLog,
  );

  // image_size = tamanho da referência enviada; width/height = canvas alvo.
  // NÃO são intercambiáveis — é o único endpoint da API com as duas coisas.
  const body: Record<string, unknown> = {
    image: activeB64,
    image_size: { width: size, height: size },
    description: prompt,
    width: size,
    height: size,
    seed: ch.seed,
    no_background: true,
  };

  const res = await client.request<EditImageSubmitResponse>('POST', '/edit-image', body);

  // O dinheiro sai na submissão: tracking e ledger antes do poll.
  if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);
  const usage = res.usage;
  appendLedger(opts.ledgerPath, {
    at: new Date().toISOString(),
    characterId,
    endpoint: 'edit-image',
    usd: usage?.usd ?? null,
    generations: usage?.generations ?? null,
    unit: usage?.type ?? 'unknown',
  });

  const jobId = res.data?.background_job_id;
  if (!jobId) throw new Error('a API não devolveu background_job_id para /edit-image');

  const polled = await pollJob(client, jobId, { timeoutMs: 900_000 });
  if (!polled.ok) {
    throw new Error(
      polled.reason === 'timeout' ? 'tempo esgotado' : (polled.detail ?? 'falhou'),
    );
  }

  const raw = extractEditedImage(polled.job.last_response);
  if (!raw) {
    throw new Error('last_response do /edit-image não contém o campo "image"');
  }

  // Gravar PNG ANTES de qualquer pós-processamento.
  const newIndex = active + 1;
  const filePath = southPath(opts.assetsDir, characterId, newIndex);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(raw, 'base64'));
  opts.onLog?.(`[wizard] sul v${newIndex} → ${filePath} (${raw.length} chars b64)`);

  // Só depois de gravado: validar dimensões contra character.size.
  validateGeneratedPng(raw, size, `sul v${newIndex}`);

  // Nova edição descarta o ramo de redo à frente da versão ativa.
  const at = new Date().toISOString();
  ch.wizard = {
    ...wiz,
    southVersions: [...wiz.southVersions.slice(0, active + 1), { prompt, at }],
    activeSouth: newIndex,
  };
  await pointSouthCell(store, s, characterId, newIndex, usage?.usd ?? undefined);
}

// ------------------------------------------------------------------ 3. desfazer

/**
 * Volta uma versão da sul. NENHUMA chamada de API: só move activeSouth e
 * reaponta a célula. Erro se já estiver na v0. Caminho inverso (redo) não
 * existe como operação — editSouth com o mesmo prompt cobre o caso de graça.
 */
export async function undoSouth(
  store: StudioStore,
  characterId: string,
  opts: WizardOpts,
): Promise<void> {
  const s = await store.load();
  const ch = requireCharacter(s, characterId);
  const wiz = requireWizard(ch);
  const key = southKey(characterId);

  if (wiz.activeSouth <= 0) {
    throw new Error('não há versão anterior da sul para voltar — já está na v0');
  }
  if (s.cells[key]?.status !== 'pronto') {
    throw new Error('a célula da sul não está pronta — nada a desfazer');
  }

  const target = wiz.activeSouth - 1;
  if (!existsSync(southPath(opts.assetsDir, characterId, target))) {
    throw new Error(
      `arquivo da versão ${target} da sul não existe no disco — não dá para voltar sem regenerar`,
    );
  }

  ch.wizard = { ...wiz, activeSouth: target };
  await pointSouthCell(store, s, characterId, target);
  opts.onLog?.(`[wizard] sul voltou para v${target} (sem chamar a API).`);
}

// ------------------------------------------------------------------ 4. cardeais

const CARDINAL_DIRECTIONS = ['east', 'north', 'west'] as const;
type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];

/**
 * Deriva as três cardeais a partir da sul ativa via /rotate (síncrono).
 *
 * Ordem: south→east e south→north EM PARALELO (Promise.all); quando as duas
 * terminam, south→west. Cada chamada grava cardinal-<dir>.png imediatamente e
 * escreve no ledger — uma falha numa direção não derruba as que já completaram,
 * e a re-execução pula o que já está pronto.
 *
 * Idempotência POR DIREÇÃO: célula cardinalKey(charId, dir) pronta → pula.
 */
export async function rotateCardinals(
  client: PixelLabClient,
  store: StudioStore,
  characterId: string,
  opts: WizardOpts,
): Promise<void> {
  const s = await store.load();
  const ch = requireCharacter(s, characterId);
  const wiz = requireWizard(ch);

  if (s.cells[southKey(characterId)]?.status !== 'pronto') {
    throw new Error('gere a sul antes de derivar as cardeais');
  }

  const pending = CARDINAL_DIRECTIONS.filter(
    (d) => s.cells[cardinalKey(characterId, d)]?.status !== 'pronto',
  );
  if (pending.length === 0) {
    opts.onLog?.('[wizard] as três cardeais já estão prontas — idempotente, pulando.');
    return;
  }

  const size = ch.size;

  // Guard: informa, nunca recusa. Uma chamada /rotate por direção pendente.
  const single = estimateByArea(COST_TABLE['rotate'], size * size);
  const estimate: CostEstimate = {
    low: single.low * pending.length,
    point: single.point * pending.length,
    high: single.high * pending.length,
    confidence: single.confidence,
  };
  logGuard(
    `rotate (${pending.length}× south→cardeal)`,
    guardFor(estimate, single.point),
    opts.onLog,
  );

  const southB64 = await readB64(
    southPath(opts.assetsDir, characterId, wiz.activeSouth),
    `sul v${wiz.activeSouth}`,
  );

  const runOne = async (to: CardinalDirection): Promise<void> => {
    const cKey = cardinalKey(characterId, to);
    if (s.cells[cKey]?.status === 'pronto') {
      opts.onLog?.(`[wizard] cardeal ${to} já pronta — pulando.`);
      return;
    }

    opts.onLog?.(`[wizard] rotate south→${to}...`);
    const body: Record<string, unknown> = {
      from_image: asBase64Image(southB64),
      from_direction: 'south',
      to_direction: to,
      image_size: { width: size, height: size },
      seed: ch.seed,
      from_view: 'low top-down',
      to_view: 'low top-down',
    };
    // isometric: OMITIDO quando false (F0-09).
    if (ch.isometric) body['isometric'] = true;

    const res = await client.submit<ImageResponse>('rotate', body);

    // Gravar PNG ANTES de qualquer pós-processamento — /rotate é síncrono:
    // se o processo morrer aqui, o dinheiro já foi gasto e a imagem se perde.
    const raw = extractBase64(res.data?.image);
    if (!raw) {
      throw new Error(
        `/rotate south→${to} não devolveu campo "image". Resposta: ${res.raw.slice(0, 200)}`,
      );
    }
    const filePath = cardinalPath(opts.assetsDir, characterId, to);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(raw, 'base64'));
    opts.onLog?.(`[wizard] cardinal ${to} → ${filePath} (${raw.length} chars b64)`);

    if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);
    const usage = res.usage;
    appendLedger(opts.ledgerPath, {
      at: new Date().toISOString(),
      characterId,
      direction: to,
      endpoint: 'rotate',
      usd: usage?.usd ?? null,
      generations: usage?.generations ?? null,
      unit: usage?.type ?? 'unknown',
    });

    // Persiste ESTA direção imediatamente — um erro na irmã não a derruba.
    s.cells[cKey] = {
      key: cKey,
      status: 'pronto',
      frames: { [to]: [publicPath(characterId, `cardinal-${to}.png`)] },
      updatedAt: new Date().toISOString(),
      ...(usage?.usd != null ? { costUsd: usage.usd } : {}),
    };
    await store.save(s);
  };

  // E ∥ N concorrentes; W só depois que as duas terminam.
  await Promise.all([runOne('east'), runOne('north')]);
  await runOne('west');

  // Com as três prontas, o wizard avança para as 8 direções.
  if (
    CARDINAL_DIRECTIONS.every(
      (d) => s.cells[cardinalKey(characterId, d)]?.status === 'pronto',
    )
  ) {
    ch.wizard = { ...requireWizard(ch), etapa: 'direcoes8' };
    await store.save(s);
  }
}

// ------------------------------------------------------------------ 5. oito direções

interface CreateCharacterResponse {
  readonly background_job_id?: string;
  readonly character_id?: string;
}

/**
 * Gera as 8 direções via /create-character-v3 (modo reference_image):
 * o sprite sul vai como `reference_image` e o modelo v3 rotaciona sozinho
 * para as 8 direções — sem cardeais intermediárias, sem mapa `directions`,
 * sem prova de congelamento.
 *
 * Com a migração para v3 (2026-07-31):
 * - O endpoint `create-character-v3` aceita `reference_image` (base64 do sprite
 *   sul, máx 256×256) e devolve `character_id` + `background_job_id`.
 * - `image_size` é advisory em modo reference — o modelo escolhe o tamanho.
 * - `outline`/`detail` são IGNORADOS quando `reference_image` está presente.
 * - Custo: ceil(w×h×8 / 65536) gerações. Para 64×64 = 1 geração;
 *   para 128×128 = 2 gerações.
 *
 * EXIGE studio.lock — a config do wizard (frameCount/fps/size) trava ANTES da
 * base, e gerar as 8 direções sem lock significaria uma base sem contrato de
 * frames. Erro explícito se ausente.
 *
 * Pré-condição: célula da sul pronta.
 * Idempotência: célula directions8Key pronta → nenhuma chamada sai.
 */
export async function generateDirections8(
  client: PixelLabClient,
  store: StudioStore,
  characterId: string,
  opts: WizardOpts,
): Promise<void> {
  const s = await store.load();
  const ch = requireCharacter(s, characterId);
  const wiz = requireWizard(ch);

  if (!s.lock) {
    throw new Error(
      'o wizard precisa da config travada (frameCount/fps/size) antes de gerar as 8 direções — ' +
        'trave a config primeiro (POST /api/wizard/config)',
    );
  }

  const dKey = directions8Key(characterId);
  if (s.cells[dKey]?.status === 'pronto') {
    opts.onLog?.('[wizard] as 8 direções já estão prontas — idempotente, pulando.');
    return;
  }

  // Pré-condição: sul pronta (reference_image do v3).
  const southCell = s.cells[southKey(characterId)];
  if (southCell?.status !== 'pronto') {
    throw new Error('a face sul precisa estar pronta antes das 8 direções');
  }

  const southRaw = await readB64(southPath(opts.assetsDir, characterId, wiz.activeSouth), `sul v${wiz.activeSouth}`);
  const size = ch.size;

  // Guard: v3 reference mode custa ceil(w×h×8 / 65536) gerações.
  const estimate = estimateByArea(
    COST_TABLE['create-character-v3'],
    size * size,
  );
  logGuard(
    'create-character-v3 (8 direções via reference_image)',
    guardFor(estimate, estimate.point),
    opts.onLog,
  );

  const body: Record<string, unknown> = {
    description: ch.description,
    reference_image: { base64: southRaw },
    template_id: 'mannequin',
    view: 'low top-down',
    seed: ch.seed,
    no_background: true,
    image_size: { width: size, height: size },
  };

  const res = await client.submit<CreateCharacterResponse>(
    'create-character-v3',
    body,
  );

  // O dinheiro sai na submissão: tracking, ledger e remoteId ANTES do poll.
  if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);
  const usage = res.usage;
  appendLedger(opts.ledgerPath, {
    at: new Date().toISOString(),
    characterId,
    endpoint: 'create-character-v3',
    usd: usage?.usd ?? null,
    generations: usage?.generations ?? null,
    unit: usage?.type ?? 'unknown',
  });

  // Persistir character_id IMEDIATAMENTE — é o único caminho de volta ao artefato.
  const remoteId = res.data?.character_id;
  if (remoteId) {
    ch.remoteId = remoteId;
    await store.save(s);
  }
  const jobId = res.data?.background_job_id;
  if (!jobId) throw new Error('a API não devolveu background_job_id');

  const polled = await pollJob(client, jobId, { timeoutMs: 900_000 });
  if (!polled.ok) {
    throw new Error(
      polled.reason === 'timeout' ? 'tempo esgotado' : (polled.detail ?? 'falhou'),
    );
  }

  const response = polled.job.last_response ?? polled.job;

  // v3 não tem mapa directions — sem prova de congelamento.

  // Extrair frames POR CHAVE, nunca por índice.
  const { frames, hasSkeletons } = await parseAndWriteFrames(
    response,
    'wizard',
    dKey,
    opts.assetsDir,
  );
  if (Object.keys(frames).length === 0) throw new Error('resposta sem imagem');

  const at = new Date().toISOString();
  s.cells[dKey] = {
    key: dKey,
    status: 'pronto',
    frames,
    updatedAt: at,
    ...(jobId ? { jobId } : {}),
    ...(remoteId ? { remoteId } : {}),
    ...(usage?.usd != null ? { costUsd: usage.usd } : {}),
  };
  ch.wizard = { ...requireWizard(ch), etapa: 'pronto' };
  await store.save(s);

  if (hasSkeletons) {
    opts.onLog?.(`[skeletons] resposta com skeletons populado para ${dKey}`);
  }
  opts.onLog?.('[wizard] 8 direções prontas — wizard.etapa = pronto.');
}
