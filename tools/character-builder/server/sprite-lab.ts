/**
 * Sprite Studio — bancada livre do create-character-v3.
 *
 * Diferente de mannequin.ts (wizard com estado por personagem), aqui a tela
 * escolhe TODAS as configs do endpoint e recebe N candidatos em paralelo; a
 * bancada extrai só o frame `south` de cada um — o endpoint SEMPRE produz as
 * 8 direções, e os outros 7 frames ficam em disco como subproduto.
 *
 * Regras que valem para todo o módulo:
 *   - Validação TOTAL antes de gastar: qualquer config inválida vira
 *     SpriteLabValidationError nomeado, com zero chamadas à API.
 *   - PNG gravado em disco ANTES de qualquer pós-processamento (o dinheiro sai
 *     na submissão — perder a imagem é dinheiro perdido).
 *   - Guard de orçamento (ADR 0012): estima, loga, escreve ledger — nunca recusa.
 *   - Idempotência POR CANDIDATO: PNG de `${hash}-cand${i}` existente = aquela
 *     posição não chama a API de novo.
 *   - Seeds determinísticas: base = seed informada ou derivada do hash;
 *     candidato i = base + i.
 *   - enhance_prompt é OMITIDO do request quando false (F0-09).
 *   - view 'low top-down' por default (ADR 0005).
 *
 * Decisões de API confirmadas no spec vendorizado
 * (tools/pixellab-pipeline/openapi/openapi-v2.json, capturado 2026-07-29):
 *   - /create-character-v3: ASSÍNCRONO, responde 200 (não 202) com
 *     {background_job_id, character_id, usage, enhanced_prompt?, enhance_usage?}.
 *     required = description (1–2000 chars). image_size = V3OutputImageSize,
 *     width/height inteiros 32–256 (advisory em modo reference). view enum
 *     [low top-down|high top-down|side], default 'low top-down'. seed inteiro
 *     >= 0. no_background default true. template_id enum
 *     [mannequin|bear|cat|dog|horse|lion], default 'mannequin'.
 *   - reference_image: Base64Image, máx 256×256 (a tela redimensiona antes).
 *     outline/detail são IGNORADOS quando reference_image está presente —
 *     por isso são OMITIDOS do request nesse modo (e a omissão é logada).
 *   - enhance_prompt: só vale em modo from-scratch; combinado com
 *     reference_image a API responde 422 — validado aqui ANTES de gastar.
 *     Custa 0.05 gerações extra e devolve enhanced_prompt + enhance_usage.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { PixelLabClient, Usage } from '../../pixellab-pipeline/src/api.ts';
import { pollJob } from '../../pixellab-pipeline/src/api.ts';
import {
  COST_TABLE, estimateByArea, checkBudget,
  type BudgetReport, type CostEstimate,
} from '../../pixellab-pipeline/src/cost.ts';
import { trackSpend } from './estimate.ts';
import { waitForCharacterRotations } from './character-detail.ts';
import { parseAndWriteFrames } from './frames.ts';
import {
  DETAIL_OPTIONS, OUTLINE_OPTIONS, TEMPLATE_OPTIONS, VIEW_OPTIONS,
  type DetailOption, type OutlineOption, type TemplateOption, type ViewOption,
} from './model.ts';

// ---- tipos (contrato estável — consumido por server/api.ts)

export interface SpriteLabConfig {
  /** Prompt do personagem. Obrigatória, 1–2000 caracteres (spec). */
  readonly description: string;
  /** CameraView do spec. Default 'low top-down' (ADR 0005). */
  readonly view?: ViewOption;
  /** Lado do frame quadrado, inteiro 32–256 (V3OutputImageSize do spec). */
  readonly size: number;
  /** Seed base; ausente, é derivada do hash do input. Candidato i = base + i. */
  readonly seed?: number;
  /** Default true (default do próprio spec). */
  readonly noBackground?: boolean;
  /** Soft hint de contorno — IGNORADO pela v3 com reference_image. */
  readonly outline?: OutlineOption;
  /** Soft hint de detalhe — IGNORADO pela v3 com reference_image. */
  readonly detail?: DetailOption;
  /** Omitido do request quando false (F0-09). Com reference_image é 422 na API. */
  readonly enhancePrompt?: boolean;
  readonly templateId?: TemplateOption;
  /** Sprite sul de referência (máx 256×256). Aceita b64 puro ou data URI. */
  readonly referenceImageBase64?: string;
  /** Número de candidatos em paralelo, inteiro 1–4 (teto do 429 da v3). */
  readonly outputs: number;
}

export interface SpriteLabCandidate {
  readonly index: number;
  /** Seed efetiva deste candidato (base + index). */
  readonly seed: number;
  /**
   * character_id da PixelLab. É o ÚNICO caminho de volta ao artefato pago —
   * sem ele, uma geração cobrada cujo download falhou vira dinheiro perdido
   * (foi o que aconteceu em 2026-08-01). Ausente num hit de cache antigo,
   * gravado no manifesto a partir daqui.
   */
  readonly characterId?: string;
  /** Frame `south` extraído da resposta, b64 puro (sem prefixo data URI). */
  readonly southB64: string;
  /** Usage cru da submissão. Ausente num hit de cache (não houve chamada). */
  readonly usage?: {
    readonly type: string;
    readonly usd?: number | null;
    readonly generations?: number | null;
  };
}

export interface SpriteLabResult {
  readonly hash: string;
  readonly candidates: readonly SpriteLabCandidate[];
  /** true quando NENHUMA submissão saiu — todos os candidatos vieram do disco. */
  readonly fromCache: boolean;
}

// ---- catálogo das corridas em disco (GET /api/sprite-lab)

/**
 * Config NORMALIZADA de uma corrida, gravada no manifesto a partir de 2026-08-04.
 *
 * Existe por um motivo só: o `hash` é sha256 da config feito NO SERVIDOR e é
 * irreversível — sem esta cópia, uma corrida em disco não tem como dizer o que
 * a gerou, e a tela que a recupera não consegue nem resumir a execução nem
 * remontar o bundle de export. Manifestos gravados antes disso não têm o campo,
 * e `SpriteLabRunSummary.config` fica ausente para eles: é dado que não existe,
 * não dado a adivinhar.
 *
 * Os bytes da `reference_image` ficam DE FORA de propósito — a config
 * normalizada é metadado leve, e o bundle de export
 * (`sprite-lab-south`) nunca carregou a referência.
 */
export interface SpriteLabRunConfig {
  readonly description: string;
  readonly view: ViewOption;
  readonly size: number;
  readonly outputs: number;
  readonly noBackground: boolean;
  readonly enhancePrompt: boolean;
  readonly seed?: number;
  readonly outline?: OutlineOption;
  readonly detail?: DetailOption;
  readonly templateId?: TemplateOption;
  /** true quando a corrida usou reference_image (os bytes não são guardados). */
  readonly hadReference: boolean;
}

export interface SpriteLabRunCandidate {
  readonly index: number;
  readonly seed: number;
  /**
   * Caminho servido por `serveGeneratedAsset` (api.ts) — o mesmo PNG que
   * `readSpriteLabResult` devolve em base64. É URL e não base64 porque o
   * catálogo pode listar dezenas de corridas e a miniatura de cada uma não
   * precisa trafegar embutida num JSON.
   */
  readonly southUrl: string;
}

/** Uma corrida COMPLETA em disco — só entra quando todo PNG do manifesto existe. */
export interface SpriteLabRunSummary {
  readonly hash: string;
  /**
   * ISO da última escrita do manifesto. O manifesto v1 não grava data própria,
   * então isto é o mtime do arquivo — derivado, não declarado.
   */
  readonly at: string;
  readonly candidateCount: number;
  readonly candidates: readonly SpriteLabRunCandidate[];
  /** Ausente nos manifestos gravados antes de a config passar a ser guardada. */
  readonly config?: SpriteLabRunConfig;
}

interface CreateCharacterV3Response {
  readonly background_job_id?: string;
  readonly character_id?: string;
  readonly enhanced_prompt?: string | null;
  readonly enhance_usage?: Usage | null;
}

// ---- erros nomeados (api.ts mapeia para HTTP 400)

export type SpriteLabErrorCode =
  | 'description-required'
  | 'description-too-long'
  | 'view-enum'
  | 'size-range'
  | 'seed-range'
  | 'outline-enum'
  | 'detail-enum'
  | 'template-enum'
  | 'reference-invalid'
  | 'enhance-with-reference'
  | 'outputs-range';

export class SpriteLabValidationError extends Error {
  readonly code: SpriteLabErrorCode;

  constructor(code: SpriteLabErrorCode, message: string) {
    super(message);
    this.name = 'SpriteLabValidationError';
    this.code = code;
  }
}

// ---- validação (SEMPRE antes de gastar)

function validate(config: SpriteLabConfig): void {
  // description chega de JSON na rota: pode vir ausente mesmo com o tipo
  // obrigatório — sem esta guarda o erro seria um TypeError em inglês.
  const rawDesc: unknown = config.description;
  if (typeof rawDesc !== 'string' || rawDesc.trim().length === 0) {
    throw new SpriteLabValidationError(
      'description-required',
      'description é obrigatória: o create-character-v3 não gera sem prompt.',
    );
  }
  if (rawDesc.length > 2000) {
    throw new SpriteLabValidationError(
      'description-too-long',
      `description tem ${rawDesc.length} caracteres; o teto do spec é 2000.`,
    );
  }

  if (config.view !== undefined && !(VIEW_OPTIONS as readonly string[]).includes(config.view)) {
    throw new SpriteLabValidationError(
      'view-enum',
      `view inválida: "${config.view}". O spec aceita: ${VIEW_OPTIONS.join(', ')}.`,
    );
  }

  const rawSize: unknown = config.size;
  if (
    typeof rawSize !== 'number' || !Number.isInteger(rawSize) || rawSize < 32 || rawSize > 256
  ) {
    throw new SpriteLabValidationError(
      'size-range',
      `size fora da faixa do create-character-v3: inteiro entre 32 e 256 (recebido ${String(rawSize)}).`,
    );
  }

  const rawOutputs: unknown = config.outputs;
  if (
    typeof rawOutputs !== 'number' || !Number.isInteger(rawOutputs) || rawOutputs < 1 || rawOutputs > 4
  ) {
    throw new SpriteLabValidationError(
      'outputs-range',
      `outputs fora da faixa da bancada: inteiro entre 1 e 4 (recebido ${String(rawOutputs)}). Acima de 4 a v3 responde 429 "Concurrency limit reached".`,
    );
  }

  if (
    config.seed !== undefined &&
    (!Number.isInteger(config.seed) || config.seed < 0)
  ) {
    throw new SpriteLabValidationError(
      'seed-range',
      `seed fora da faixa do spec: inteiro >= 0 (recebido ${config.seed}).`,
    );
  }

  if (config.outline !== undefined && !(OUTLINE_OPTIONS as readonly string[]).includes(config.outline)) {
    throw new SpriteLabValidationError(
      'outline-enum',
      `outline inválido: "${config.outline}". Opções: ${OUTLINE_OPTIONS.join(', ')}.`,
    );
  }
  if (config.detail !== undefined && !(DETAIL_OPTIONS as readonly string[]).includes(config.detail)) {
    throw new SpriteLabValidationError(
      'detail-enum',
      `detail inválido: "${config.detail}". Opções: ${DETAIL_OPTIONS.join(', ')}.`,
    );
  }
  if (config.templateId !== undefined && !(TEMPLATE_OPTIONS as readonly string[]).includes(config.templateId)) {
    throw new SpriteLabValidationError(
      'template-enum',
      `templateId inválido: "${config.templateId}". O spec aceita: ${TEMPLATE_OPTIONS.join(', ')}.`,
    );
  }

  if (config.referenceImageBase64 !== undefined && pngBytes(config.referenceImageBase64).length === 0) {
    throw new SpriteLabValidationError(
      'reference-invalid',
      'referenceImageBase64 não decodifica para uma imagem: envie b64 puro ou data URI de um PNG (máx 256×256).',
    );
  }

  // Spec: enhance_prompt + reference_image = 422 garantido. Falhar aqui
  // economiza a ida à API.
  if (config.enhancePrompt && config.referenceImageBase64 !== undefined) {
    throw new SpriteLabValidationError(
      'enhance-with-reference',
      'enhancePrompt não combina com referenceImageBase64: o spec só aceita enhance_prompt em modo from-scratch (422 na API).',
    );
  }
}

/**
 * Costura de integração para a rota POST /api/sprite-lab: valida ANTES de
 * responder (400 nomeado, sem job e sem tocar no disco). runSpriteLab
 * revalida no início — defesa em profundidade, não dupla fonte de regra.
 */
export function validateSpriteLabConfig(config: SpriteLabConfig): void {
  validate(config);
}

// ---- idempotência

function stripDataUri(b64: string): string {
  return b64.replace(/^data:image\/\w+;base64,/, '').replace(/\s+/g, '');
}

/**
 * Bytes decodificados do b64, não a string — data URI e b64 puro da mesma
 * imagem colidem. O repo não tem decoder de PNG, então bytes são o proxy
 * disponível dos pixels (a regra de "pixels, não bytes" do pipeline continua
 * valendo lá; aqui o input chega da tela como b64).
 */
function pngBytes(b64: string): Buffer {
  return Buffer.from(stripDataUri(b64), 'base64');
}

/** sha256 do input: TODA a config + outputs + bytes da referência. */
function inputHash(config: SpriteLabConfig): string {
  const h = createHash('sha256');
  h.update(`desc=${config.description}`);
  h.update(`|view=${config.view ?? 'low top-down'}`);
  h.update(`|size=${config.size}`);
  h.update(`|seed=${config.seed ?? ''}`);
  h.update(`|noBackground=${config.noBackground ?? true}`);
  h.update(`|outline=${config.outline ?? ''}|detail=${config.detail ?? ''}`);
  h.update(`|enhancePrompt=${config.enhancePrompt ?? false}`);
  h.update(`|templateId=${config.templateId ?? ''}`);
  h.update(`|outputs=${config.outputs}`);
  if (config.referenceImageBase64 !== undefined) {
    h.update('|ref=');
    h.update(pngBytes(config.referenceImageBase64));
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * O MESMO hash que runSpriteLab usa internamente — exposto para a rota
 * POST /api/sprite-lab montar a chave do job (`sprite-lab::<hash>`) e checar
 * o cache (readSpriteLabResult) ANTES de decidir entre 200 e 202.
 */
export function spriteLabHash(config: SpriteLabConfig): string {
  return inputHash(config);
}

/** Seed base: a informada, ou os 4 primeiros bytes do hash (determinística). */
function baseSeed(config: SpriteLabConfig, hash: string): number {
  return config.seed ?? Number.parseInt(hash.slice(0, 8), 16);
}

// ---- paths

function candidateDir(assetsDir: string, hash: string, index: number): string {
  return join(assetsDir, 'sprite-lab', `${hash}-cand${index}`);
}

/** parseAndWriteFrames grava o primeiro frame de cada direção como `<dir>-00.png`. */
function southPngPath(assetsDir: string, hash: string, index: number): string {
  return join(candidateDir(assetsDir, hash, index), 'south-00.png');
}

function manifestPath(assetsDir: string, hash: string): string {
  return join(assetsDir, 'sprite-lab', `${hash}.json`);
}

// ---- ledger (usage cru, como rotate-lab.ts)

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

function guardFor(estimate: CostEstimate, maxSingleAssetUsd: number): BudgetReport {
  return checkBudget({
    estimate,
    maxSingleAssetUsd,
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: undefined,
  });
}

// ---- manifesto (lido por readSpriteLabResult / GET /api/sprite-lab/{hash})

interface SpriteLabManifest {
  readonly version: 1;
  readonly hash: string;
  readonly candidates: ReadonlyArray<{
    readonly index: number;
    readonly seed: number;
    /** Ver SpriteLabCandidate.characterId — o caminho de volta ao artefato pago. */
    readonly characterId?: string;
    readonly usage?: SpriteLabCandidate['usage'];
  }>;
  /** Ausente nos manifestos anteriores a 2026-08-04. Ver SpriteLabRunConfig. */
  readonly config?: SpriteLabRunConfig;
}

/** Manifesto do hash, ou null quando não existe, não é JSON ou não bate. */
async function readManifestFile(
  assetsDir: string,
  hash: string,
): Promise<SpriteLabManifest | null> {
  const path = manifestPath(assetsDir, hash);
  if (!existsSync(path)) return null;
  let manifest: SpriteLabManifest;
  try {
    manifest = JSON.parse(await readFile(path, 'utf8')) as SpriteLabManifest;
  } catch {
    return null;
  }
  if (manifest.hash !== hash || !Array.isArray(manifest.candidates)) return null;
  return manifest;
}

/** Config normalizada que vai ao manifesto — defaults já aplicados. */
function runConfigOf(config: SpriteLabConfig): SpriteLabRunConfig {
  return {
    description: config.description,
    view: config.view ?? 'low top-down',
    size: config.size,
    outputs: config.outputs,
    noBackground: config.noBackground ?? true,
    enhancePrompt: config.enhancePrompt ?? false,
    hadReference: config.referenceImageBase64 !== undefined,
    ...(config.seed !== undefined ? { seed: config.seed } : {}),
    ...(config.outline !== undefined ? { outline: config.outline } : {}),
    ...(config.detail !== undefined ? { detail: config.detail } : {}),
    ...(config.templateId !== undefined ? { templateId: config.templateId } : {}),
  };
}

/**
 * Catálogo das corridas COMPLETAS em disco — espelho de `listWorldBlocks`.
 *
 * Existe porque o `hash` de uma corrida só voltava uma vez, no corpo do 202 do
 * POST, e vivia daí em diante apenas em estado React: trocar de aba desmontava
 * o painel e a sprite paga sumia da tela sem ter sumido do disco. Com esta
 * rota a recuperação é servidor-autoritativa, como já era a paleta de blocos.
 *
 * Uma corrida sem TODOS os PNGs do manifesto fica de fora, pela mesma regra de
 * `readSpriteLabResult`: resultado incompleto não é resultado.
 *
 * Ordem: mais recente primeiro, pelo mtime do manifesto.
 */
export async function listSpriteLabRuns(
  assetsDir: string,
): Promise<SpriteLabRunSummary[]> {
  const root = join(assetsDir, 'sprite-lab');
  if (!existsSync(root)) return [];

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const out: SpriteLabRunSummary[] = [];
  for (const name of entries) {
    // Só manifestos: os diretórios `<hash>-cand<i>` ficam de fora, e um hash
    // fora do formato hex-16 nunca foi produzido por aqui.
    const m = /^([a-f0-9]{16})\.json$/i.exec(name);
    if (m === null) continue;
    const hash = m[1];
    if (hash === undefined) continue;

    const manifest = await readManifestFile(assetsDir, hash);
    if (manifest === null) continue;

    const candidates: SpriteLabRunCandidate[] = [];
    let complete = true;
    for (const c of manifest.candidates) {
      if (!existsSync(southPngPath(assetsDir, hash, c.index))) {
        complete = false;
        break;
      }
      candidates.push({
        index: c.index,
        seed: c.seed,
        southUrl: `/sprite-lab/${hash}-cand${c.index}/south-00.png`,
      });
    }
    if (!complete || candidates.length === 0) continue;

    let at: string;
    try {
      at = (await stat(manifestPath(assetsDir, hash))).mtime.toISOString();
    } catch {
      continue;
    }

    out.push({
      hash,
      at,
      candidateCount: candidates.length,
      candidates,
      ...(manifest.config ? { config: manifest.config } : {}),
    });
  }

  out.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

/**
 * Lê o resultado persistido de uma execução anterior, ou null quando não
 * existe (ou está incompleto). Os bytes vêm dos PNGs em disco — o manifesto
 * só guarda seeds e usage. fromCache é sempre true aqui: nada foi chamado.
 */
export async function readSpriteLabResult(
  hash: string,
  assetsDir: string,
): Promise<SpriteLabResult | null> {
  const manifest = await readManifestFile(assetsDir, hash);
  if (manifest === null) return null;

  const candidates: SpriteLabCandidate[] = [];
  for (const c of manifest.candidates) {
    const png = southPngPath(assetsDir, hash, c.index);
    if (!existsSync(png)) return null;
    candidates.push({
      index: c.index,
      seed: c.seed,
      southB64: (await readFile(png)).toString('base64'),
      ...(c.characterId ? { characterId: c.characterId } : {}),
      ...(c.usage ? { usage: c.usage } : {}),
    });
  }
  return { hash, candidates, fromCache: true };
}

// ---- execução

/**
 * Executa a bancada v3: N submissões create-character-v3 EM PARALELO, cada uma
 * com sua seed determinística, e extrai o frame `south` de cada resposta.
 *
 * Valida ANTES de gastar (SpriteLabValidationError), estima e loga sem nunca
 * recusar, escreve ledger por submissão logo após o submit (o dinheiro sai na
 * submissão, não no poll) e grava os PNGs antes de qualquer pós-processamento.
 * Cache por candidato: `${hash}-cand${i}/south-00.png` existente = aquela
 * posição resolve sem API.
 */
export async function runSpriteLab(
  client: PixelLabClient,
  config: SpriteLabConfig,
  opts: {
    readonly assetsDir: string;
    readonly ledgerPath: string;
    readonly onLog?: (m: string) => void;
  },
): Promise<SpriteLabResult> {
  validate(config);

  const hash = inputHash(config);
  const base = baseSeed(config, hash);
  const view = config.view ?? 'low top-down';
  const noBackground = config.noBackground ?? true;
  const hasReference = config.referenceImageBase64 !== undefined;

  // Quais posições ainda precisam de chamada — o resto é cache.
  const pending: number[] = [];
  for (let i = 0; i < config.outputs; i += 1) {
    if (!existsSync(southPngPath(opts.assetsDir, hash, i))) pending.push(i);
  }

  if (pending.length === 0) {
    opts.onLog?.(`[sprite-lab] ${config.outputs} candidato(s) já em disco para hash=${hash}. Sem chamada à API.`);
  } else {
    // Estimativa informativa (COST_TABLE por área × posições pendentes) —
    // loga, nunca recusa (ADR 0012). Preço estimado, como a própria PixelLab rotula.
    const single = estimateByArea(COST_TABLE['create-character-v3'], config.size * config.size);
    const estimate: CostEstimate = {
      low: single.low * pending.length,
      point: single.point * pending.length,
      high: single.high * pending.length,
      confidence: single.confidence,
    };
    logGuard(
      `create-character-v3 (${pending.length}× sprite-lab; preço estimado)`,
      guardFor(estimate, single.point),
      opts.onLog,
    );
  }

  if (hasReference && (config.outline !== undefined || config.detail !== undefined)) {
    opts.onLog?.(
      '[sprite-lab] outline/detail omitidos do request: a v3 os IGNORA quando reference_image está presente.',
    );
  }

  const runCandidate = async (index: number): Promise<SpriteLabCandidate> => {
    const seed = base + index;
    const pngPath = southPngPath(opts.assetsDir, hash, index);

    // Idempotência por candidato: PNG existente → zero gasto nesta posição.
    if (existsSync(pngPath)) {
      opts.onLog?.(`[sprite-lab] candidato ${index} já existe (${pngPath}). Sem chamada.`);
      return {
        index,
        seed,
        southB64: (await readFile(pngPath)).toString('base64'),
      };
    }

    // Do spec: required = description. Todo o resto é opcional e só entra no
    // request quando informado (F0-09).
    const params: Record<string, unknown> = {
      description: config.description,
      view,
      image_size: { width: config.size, height: config.size },
      seed,
      no_background: noBackground,
    };
    if (config.templateId !== undefined) params['template_id'] = config.templateId;
    if (hasReference) {
      params['reference_image'] = { base64: stripDataUri(config.referenceImageBase64 ?? '') };
      // outline/detail OMITIDOS aqui de propósito: a v3 os ignora neste modo.
    } else {
      if (config.outline !== undefined) params['outline'] = config.outline;
      if (config.detail !== undefined) params['detail'] = config.detail;
      // enhance_prompt: OMITIDO quando false (F0-09) e proibido com reference.
      if (config.enhancePrompt) params['enhance_prompt'] = true;
    }

    const res = await client.submit<CreateCharacterV3Response>('create-character-v3', params);

    // O dinheiro sai na submissão: tracking e ledger ANTES do poll.
    if (typeof res.usage?.usd === 'number') trackSpend(res.usage.usd);
    if (typeof res.data?.enhance_usage?.usd === 'number') trackSpend(res.data.enhance_usage.usd);
    const usage = res.usage;
    appendLedger(opts.ledgerPath, {
      at: new Date().toISOString(),
      endpoint: 'create-character-v3',
      lab: true,
      hash,
      index,
      // character_id e job_id no ledger: o artefato pago sobrevive a qualquer
      // falha posterior de download. Sem eles, as 14 submissões de
      // 2026-08-01 ficaram irrecuperáveis a partir do ledger.
      characterId: res.data?.character_id ?? null,
      jobId: res.data?.background_job_id ?? null,
      usd: usage?.usd ?? null,
      generations: usage?.generations ?? null,
      unit: usage?.type ?? 'unknown',
      ...(res.data?.enhanced_prompt ? { enhanced_prompt: res.data.enhanced_prompt } : {}),
      ...(res.data?.enhance_usage ? { enhance_usage: res.data.enhance_usage } : {}),
    });

    const jobId = res.data?.background_job_id;
    if (!jobId) throw new Error('a API não devolveu background_job_id');
    const characterId = res.data?.character_id;
    if (!characterId) throw new Error('a API não devolveu character_id');

    const polled = await pollJob(client, jobId, { timeoutMs: 900_000 });
    if (!polled.ok) {
      throw new Error(
        `candidato ${index}: ${polled.reason === 'timeout' ? 'tempo esgotado' : (polled.detail ?? 'falhou')}`,
      );
    }

    // O job concluído da v3 traz SÓ metadado — os pixels moram em
    // GET /characters/{id}.rotation_urls (ver server/character-detail.ts).
    // Ler o last_response direto aqui era o bug: 14 submissões pagas, zero PNG.
    const detail = await waitForCharacterRotations(client, characterId, {
      onLog: opts.onLog,
    });

    // Extrair frames POR CHAVE, nunca por índice. parseAndWriteFrames grava os
    // PNGs em disco ANTES de qualquer pós-processamento — a cobrança já aconteceu.
    const { frames } = await parseAndWriteFrames(
      detail,
      'sprite-lab',
      `${hash}-cand${index}`,
      opts.assetsDir,
    );
    if (!frames['south']?.[0]) {
      throw new Error(`candidato ${index}: resposta sem frame "south"`);
    }
    opts.onLog?.(`[sprite-lab] candidato ${index} → ${candidateDir(opts.assetsDir, hash, index)} (seed ${seed})`);

    return {
      index,
      seed,
      characterId,
      southB64: (await readFile(pngPath)).toString('base64'),
      ...(usage
        ? {
            usage: {
              type: usage.type,
              usd: usage.usd ?? null,
              generations: usage.generations ?? null,
            },
          }
        : {}),
    };
  };

  const candidates = await Promise.all(
    Array.from({ length: config.outputs }, (_, i) => runCandidate(i)),
  );

  const fromCache = pending.length === 0;

  // Manifesto por último: é ele que distingue "resultado completo" de
  // "execução interrompida" para readSpriteLabResult (e para o 404 da rota).
  // Num hit total de cache o manifesto antigo é melhor (tem o usage da época
  // da submissão) — só regrava quando houve trabalho novo ou ele não existe.
  if (!fromCache || !existsSync(manifestPath(opts.assetsDir, hash))) {
    const manifest: SpriteLabManifest = {
      version: 1,
      hash,
      candidates: candidates.map((c) => ({
        index: c.index,
        seed: c.seed,
        ...(c.characterId ? { characterId: c.characterId } : {}),
        ...(c.usage ? { usage: c.usage } : {}),
      })),
      // O hash é irreversível: sem esta cópia, uma corrida em disco não sabe
      // dizer o que a gerou. Campo aditivo — manifestos antigos seguem válidos.
      config: runConfigOf(config),
    };
    await mkdir(dirname(manifestPath(opts.assetsDir, hash)), { recursive: true });
    await writeFile(manifestPath(opts.assetsDir, hash), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return { hash, candidates, fromCache };
}
