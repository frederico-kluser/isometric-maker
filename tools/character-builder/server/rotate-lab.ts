/**
 * Laboratório de rotação — playground livre do endpoint /rotate.
 *
 * Diferente de rotate.ts (três cardeais fixas a partir de south), aqui o
 * usuário escolhe os parâmetros: o par from/to_direction OU direction_change,
 * troca de view, init_image... É UMA chamada por execução.
 *
 * /rotate é SÍNCRONO (sem background_job_id) e pode responder 529: o PNG é
 * gravado IMEDIATAMENTE depois da resposta, antes de ledger e de qualquer
 * pós-processamento — se o processo morrer entre a cobrança e a escrita, o
 * dinheiro se perde.
 *
 * Idempotência: mesmo input (hash) + PNG existente → devolve o arquivo sem
 * chamar a API. O guard de orçamento aqui só estima e loga — informa, nunca
 * recusa (ADR 0012).
 *
 * Faixas e enums confirmados no spec vendorizado
 * (tools/pixellab-pipeline/openapi/openapi-v2.json, capturado 2026-07-29):
 *   - image_size: width/height inteiros, 16–200 (ImageSize namespaced do /rotate)
 *   - view_change: inteiro −90..90 · direction_change: inteiro −180..180
 *   - init_image_strength: inteiro 1..999 (default 300), exige init_image
 *   - CameraView: side, low top-down, high top-down
 *   - Direction: north, north-east, east, south-east, south, south-west, west, north-west
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { PixelLabClient } from '../../pixellab-pipeline/src/api.ts';
import { COST_TABLE, estimateByArea } from '../../pixellab-pipeline/src/cost.ts';
import { asBase64Image, extractBase64 } from './base64-image.ts';
import { trackSpend } from './estimate.ts';
import type { Direction } from './model.ts';

// ---- tipos (contrato estável — consumido por server/api.ts)

export interface RotateLabInput {
  /** Imagem a rotacionar. Aceita b64 puro ou data URI — normalizado antes do envio e do hash. */
  readonly imageBase64: string;
  readonly fromDirection?: Direction;
  readonly toDirection?: Direction;
  /** CameraView do spec: 'side' | 'low top-down' | 'high top-down'. */
  readonly fromView?: string;
  readonly toView?: string;
  /** Tilt de câmera em graus, inteiro −90..90. */
  readonly viewChange?: number;
  /** Giro em graus, inteiro −180..180. Alternativa ao par from/to_direction. */
  readonly directionChange?: number;
  readonly initImageBase64?: string;
  /** Inteiro 1..999 (default do spec: 300). Só faz sentido com initImageBase64. */
  readonly initImageStrength?: number;
  readonly seed?: number;
  /** Omitido do request quando false (F0-09). */
  readonly isometric?: boolean;
  readonly imageSize: { readonly width: number; readonly height: number };
}

export interface RotateLabResult {
  /** b64 puro (sem prefixo data URI) — a tela monta o data URI para o lado a lado. */
  readonly image: string;
  /** Path absoluto do PNG gravado em disco. */
  readonly path: string;
  /** Usage cru da resposta. Ausente num hit de cache (não houve chamada). */
  readonly usage?: {
    readonly type: string;
    readonly usd?: number | null;
    readonly generations?: number | null;
  };
}

interface RotateLabResponse {
  readonly usage?: {
    readonly type: 'usd' | 'generations';
    readonly usd?: number | null;
    readonly generations?: number | null;
  };
  readonly image?: unknown;
}

// ---- erros nomeados (api.ts mapeia para HTTP 400 na fase 3)

export type RotateLabErrorCode =
  | 'direction-xor'
  | 'direction-incomplete'
  | 'size-range'
  | 'view-enum'
  | 'view-change-range'
  | 'direction-change-range'
  | 'init-strength-without-image'
  | 'init-strength-range';

export class RotateLabValidationError extends Error {
  readonly code: RotateLabErrorCode;

  constructor(code: RotateLabErrorCode, message: string) {
    super(message);
    this.name = 'RotateLabValidationError';
    this.code = code;
  }
}

// ---- validação (SEMPRE antes de gastar)

/** CameraView, do spec vendorizado. */
const CAMERA_VIEWS: readonly string[] = ['side', 'low top-down', 'high top-down'];

function validate(input: RotateLabInput): void {
  const hasFrom = input.fromDirection !== undefined;
  const hasTo = input.toDirection !== undefined;
  const hasChange = input.directionChange !== undefined;

  if ((hasFrom || hasTo) && hasChange) {
    throw new RotateLabValidationError(
      'direction-xor',
      'Informe OU o par fromDirection+toDirection OU directionChange — nunca os dois juntos.',
    );
  }
  if (hasFrom !== hasTo) {
    throw new RotateLabValidationError(
      'direction-incomplete',
      `fromDirection e toDirection vêm sempre juntos — recebi só ${hasFrom ? 'fromDirection' : 'toDirection'}.`,
    );
  }
  if (!hasFrom && !hasChange) {
    throw new RotateLabValidationError(
      'direction-xor',
      'Informe o par fromDirection+toDirection ou directionChange — um dos dois é obrigatório.',
    );
  }

  // imageSize chega de JSON na rota: pode vir ausente mesmo com o tipo
  // obrigatório — sem esta guarda o erro seria um TypeError em inglês.
  const rawSize: unknown = input.imageSize;
  const size = (typeof rawSize === 'object' && rawSize !== null ? rawSize : {}) as {
    readonly width?: unknown;
    readonly height?: unknown;
  };
  const { width, height } = size;
  if (
    typeof width !== 'number' || typeof height !== 'number' ||
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 16 || width > 200 || height < 16 || height > 200
  ) {
    throw new RotateLabValidationError(
      'size-range',
      `imageSize fora da faixa do /rotate: width e height devem ser inteiros entre 16 e 200 (recebido ${String(width)}×${String(height)}).`,
    );
  }

  for (const [name, view] of [['fromView', input.fromView], ['toView', input.toView]] as const) {
    if (view !== undefined && !CAMERA_VIEWS.includes(view)) {
      throw new RotateLabValidationError(
        'view-enum',
        `${name} inválida: "${view}". O spec aceita: ${CAMERA_VIEWS.join(', ')}.`,
      );
    }
  }

  if (
    input.directionChange !== undefined &&
    (!Number.isInteger(input.directionChange) || input.directionChange < -180 || input.directionChange > 180)
  ) {
    throw new RotateLabValidationError(
      'direction-change-range',
      `directionChange fora da faixa do spec: inteiro entre -180 e 180 (recebido ${input.directionChange}).`,
    );
  }
  if (
    input.viewChange !== undefined &&
    (!Number.isInteger(input.viewChange) || input.viewChange < -90 || input.viewChange > 90)
  ) {
    throw new RotateLabValidationError(
      'view-change-range',
      `viewChange fora da faixa do spec: inteiro entre -90 e 90 (recebido ${input.viewChange}).`,
    );
  }

  if (input.initImageStrength !== undefined && input.initImageBase64 === undefined) {
    throw new RotateLabValidationError(
      'init-strength-without-image',
      'initImageStrength exige initImageBase64 — força sem imagem inicial não existe no /rotate.',
    );
  }
  if (
    input.initImageStrength !== undefined &&
    (!Number.isInteger(input.initImageStrength) || input.initImageStrength < 1 || input.initImageStrength > 999)
  ) {
    throw new RotateLabValidationError(
      'init-strength-range',
      `initImageStrength fora da faixa do spec: inteiro entre 1 e 999 (recebido ${input.initImageStrength}).`,
    );
  }
}

// ---- idempotência

function stripDataUri(b64: string): string {
  return b64.replace(/^data:image\/\w+;base64,/, '').replace(/\s+/g, '');
}

/**
 * Hash dos BYTES do PNG decodificados do b64, não da string — data URI e b64
 * puro da mesma imagem colidem. O repo não tem decoder de PNG, então bytes são
 * o proxy disponível dos pixels (a regra de "pixels, não bytes" do pipeline
 * continua valendo lá; aqui o input chega da tela como b64).
 */
function pngBytes(b64: string): Buffer {
  return Buffer.from(stripDataUri(b64), 'base64');
}

function inputHash(input: RotateLabInput): string {
  const h = createHash('sha256');
  h.update(pngBytes(input.imageBase64));
  h.update(`|size=${input.imageSize.width}x${input.imageSize.height}`);
  h.update(`|from=${input.fromDirection ?? ''}|to=${input.toDirection ?? ''}`);
  h.update(`|dirChange=${input.directionChange ?? ''}`);
  h.update(`|fromView=${input.fromView ?? ''}|toView=${input.toView ?? ''}`);
  h.update(`|viewChange=${input.viewChange ?? ''}`);
  h.update(`|seed=${input.seed ?? ''}|isometric=${input.isometric ?? false}`);
  if (input.initImageBase64 !== undefined) {
    h.update('|init=');
    h.update(pngBytes(input.initImageBase64));
    h.update(`|strength=${input.initImageStrength ?? ''}`);
  }
  return h.digest('hex').slice(0, 16);
}

// ---- ledger (usage cru, como rotate.ts)

function appendLedger(path: string, line: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`);
}

// ---- execução

/**
 * Executa UMA rotação livre do /rotate.
 *
 * Valida ANTES de gastar (RotateLabValidationError), estima e loga sem nunca
 * recusar, grava o PNG imediatamente após a resposta e só então escreve o
 * ledger. Com PNG já existente para o mesmo hash, não chama a API.
 */
export async function runRotateLab(
  client: PixelLabClient,
  input: RotateLabInput,
  opts: {
    readonly assetsDir: string;
    readonly ledgerPath: string;
    readonly onLog?: (m: string) => void;
  },
): Promise<RotateLabResult> {
  validate(input);

  const hash = inputHash(input);
  const dir = join(opts.assetsDir, 'rotate-lab');
  const path = join(dir, `${hash}.png`);

  // Idempotência: mesmo input + PNG existente → zero gasto.
  if (existsSync(path)) {
    opts.onLog?.(`[rotate-lab] PNG já existe para hash=${hash}. Sem chamada à API.`);
    const image = (await readFile(path)).toString('base64');
    return { image, path };
  }

  // Estimativa informativa (COST_TABLE.rotate por área) — loga, nunca recusa.
  const area = input.imageSize.width * input.imageSize.height;
  const est = estimateByArea(COST_TABLE['rotate'], area);
  opts.onLog?.(
    `[rotate-lab] Estimativa (preço estimado): US$ ${est.point.toFixed(4)} ` +
      `(faixa ${est.low.toFixed(4)}–${est.high.toFixed(4)}, confiança ${est.confidence}).`,
  );

  // Do spec: required = image_size, from_image. Todo o resto é opcional e só
  // entra no request quando informado.
  //
  // from_image/init_image/mask_image/color_image são Base64Image, ou seja um
  // OBJETO `{base64}` — não a string crua. Mandar a string devolve
  // 422 "Input should be a valid dictionary or object to extract fields from",
  // que era exatamente o estado desta rota até 2026-08-01: o laboratório de
  // rotação nunca completou uma chamada.
  const params: Record<string, unknown> = {
    from_image: asBase64Image(input.imageBase64),
    image_size: input.imageSize,
  };
  if (input.fromDirection !== undefined && input.toDirection !== undefined) {
    params['from_direction'] = input.fromDirection;
    params['to_direction'] = input.toDirection;
  }
  if (input.directionChange !== undefined) params['direction_change'] = input.directionChange;
  if (input.fromView !== undefined) params['from_view'] = input.fromView;
  if (input.toView !== undefined) params['to_view'] = input.toView;
  if (input.viewChange !== undefined) params['view_change'] = input.viewChange;
  if (input.initImageBase64 !== undefined) {
    params['init_image'] = asBase64Image(input.initImageBase64);
    if (input.initImageStrength !== undefined) {
      params['init_image_strength'] = input.initImageStrength;
    }
  }
  if (input.seed !== undefined) params['seed'] = input.seed;
  // isometric: OMITIDO quando false (F0-09).
  if (input.isometric) params['isometric'] = true;

  const res = await client.submit<RotateLabResponse>('rotate', params);

  // O `image` da resposta também é Base64Image ({base64}), não string —
  // extractBase64 lê as duas formas (ver server/base64-image.ts).
  const raw = extractBase64(res.data?.image);
  if (raw === '') {
    throw new Error(
      `/rotate não devolveu campo "image". Resposta: ${res.raw.slice(0, 200)}`,
    );
  }

  // Gravar PNG ANTES de qualquer pós-processamento — a cobrança já aconteceu.
  await mkdir(dir, { recursive: true });
  await writeFile(path, Buffer.from(raw, 'base64'));
  opts.onLog?.(`[rotate-lab] /rotate → ${path} (${raw.length} chars b64)`);

  // Tracking de sessão (F1-06): acumula o gasto assim que a resposta chega.
  if (typeof res.usage?.usd === 'number') {
    trackSpend(res.usage.usd);
  }

  // Ledger com usage cru.
  const usage = res.usage;
  appendLedger(opts.ledgerPath, {
    at: new Date().toISOString(),
    endpoint: 'rotate',
    lab: true,
    hash,
    usd: usage?.usd ?? null,
    generations: usage?.generations ?? null,
    unit: usage?.type ?? 'unknown',
    path,
  });

  return {
    image: raw,
    path,
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
}
