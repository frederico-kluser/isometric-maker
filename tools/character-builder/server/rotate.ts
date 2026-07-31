/**
 * /rotate — três cardeais a partir de uma imagem south.
 *
 * O endpoint /rotate é SÍNCRONO: não devolve background_job_id. O artefato vem
 * na resposta da chamada POST, e uma falha depois da cobrança é dinheiro perdido
 * a menos que o PNG seja gravado ANTES de qualquer pós-processamento.
 *
 * Este módulo faz três chamadas: south→north, south→east, south→west.
 * Mesmo seed, mesmo image_size; isometric omitido quando false (F0-09).
 *
 * Idempotência: se as três PNGs já existirem para o mesmo par (conteúdo da
 * imagem base, seed), NENHUMA chamada é feita.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PixelLabClient, type ApiResult } from '../../pixellab-pipeline/src/api.ts';
import {
  COST_TABLE, estimateByArea, sumEstimates, checkBudget,
  type BudgetReport, type CostEstimate,
} from '../../pixellab-pipeline/src/cost.ts';
import { trackSpend } from './estimate.ts';

// ---- tipos

export interface RotateInput {
  /** Imagem south-facing, base64 puro (sem prefixo data URI). */
  readonly fromImage: string;
  readonly seed: number;
  readonly imageSize: { readonly width: number; readonly height: number };
  /** Isométrico. OMITIDO do request quando false — preserva specHash (F0-09). */
  readonly isometric?: boolean;
  /** Diretório onde as PNGs serão escritas. */
  readonly outputDir: string;
}

export interface RotateResult {
  readonly north: string;
  readonly east: string;
  readonly west: string;
}

interface RotateResponse {
  readonly usage?: { readonly type: 'usd' | 'generations'; readonly usd?: number | null; readonly generations?: number | null };
  readonly image?: string;
}

// ---- idempotência

function idempotencyHash(input: RotateInput): string {
  const h = createHash('sha256');
  h.update(input.fromImage);
  h.update(`|seed=${input.seed}`);
  h.update(`|size=${input.imageSize.width}x${input.imageSize.height}`);
  h.update(`|isometric=${input.isometric ?? false}`);
  return h.digest('hex').slice(0, 16);
}

function outputPaths(hash: string, outputDir: string): RotateResult {
  return {
    north: join(outputDir, `${hash}-north.png`),
    east: join(outputDir, `${hash}-east.png`),
    west: join(outputDir, `${hash}-west.png`),
  };
}

function allExist(paths: RotateResult): boolean {
  return existsSync(paths.north) && existsSync(paths.east) && existsSync(paths.west);
}

// ---- estimativa (ANTES de qualquer chamada)

/**
 * Estima o custo de três chamadas ao /rotate e devolve o relatório do guard.
 * Não faz chamada de rede — pode ser chamado antes da confirmação.
 */
export function estimateRotate(input: RotateInput): BudgetReport {
  const area = input.imageSize.width * input.imageSize.height;
  const single = estimateByArea(COST_TABLE['rotate'], area);
  // Três chamadas, mesmo custo unitário
  const estimate: CostEstimate = {
    low: single.low * 3,
    point: single.point * 3,
    high: single.high * 3,
    confidence: single.confidence,
  };

  return checkBudget({
    estimate,
    maxSingleAssetUsd: single.point,
    spentThisMonthUsd: 0,
    spentThisSessionUsd: 0,
    balanceUsd: undefined,
  });
}

function formatEstimate(report: BudgetReport): string {
  const e = report.estimate;
  const lines = [
    `Estimativa: ${e.point.toFixed(4)} USD (faixa ${e.low.toFixed(4)}–${e.high.toFixed(4)}, confiança ${e.confidence})`,
  ];
  if (report.avisos.length > 0) {
    lines.push('Avisos:');
    for (const a of report.avisos) lines.push(`  [${a.code}] ${a.text}`);
  }
  return lines.join('\n');
}

function appendLedger(path: string, line: Record<string, unknown>): void {
  mkdirSync(join(path, '..'), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`);
}

// ---- execução

const CARDINALS = [
  { dir: 'north' as const, to: 'north' },
  { dir: 'east' as const, to: 'east' },
  { dir: 'west' as const, to: 'west' },
] as const;

/**
 * Executa as três rotações cardeais.
 *
 * PRÉ-CONDIÇÃO: o caller já deve ter confirmado via `estimateRotate`.
 * Se as três PNGs já existirem, retorna os paths sem gastar nada.
 *
 * @param client PixelLabClient (real ou falso para teste).
 * @param input Parâmetros da rotação.
 * @param opts.ledgerPath Caminho para o ledger ndjson. Se ausente, não escreve.
 * @param opts.onLog Callback de progresso.
 */
export async function rotateCardinals(
  client: PixelLabClient,
  input: RotateInput,
  opts?: { readonly ledgerPath?: string; readonly onLog?: (msg: string) => void },
): Promise<RotateResult> {
  const hash = idempotencyHash(input);
  const paths = outputPaths(hash, input.outputDir);

  // Idempotência: se as três já existem, não gasta nada.
  if (allExist(paths)) {
    opts?.onLog?.(`[rotate] Todas as três cardeais já existem para hash=${hash}. Pulando.`);
    return paths;
  }

  await mkdir(input.outputDir, { recursive: true });

  // Corpo base — /rotate NÃO aceita `view` nem `no_background`.
  // Do spec: required = image_size, from_image.
  // Params: from_direction, to_direction, seed, isometric, from_view, to_view.
  const paramsBase: Record<string, unknown> = {
    from_image: input.fromImage,
    from_direction: 'south',
    image_size: input.imageSize,
    seed: input.seed,
    from_view: 'low top-down',
    to_view: 'low top-down',
  };

  // isometric: OMITIDO quando false (F0-09).
  if (input.isometric) {
    paramsBase['isometric'] = true;
  }

  for (const { dir, to } of CARDINALS) {
    opts?.onLog?.(`[rotate] Submetendo south→${dir}...`);
    const params = { ...paramsBase, to_direction: to };
    const res = await client.submit<RotateResponse>('rotate', params);

    // Gravar PNG ANTES de qualquer pós-processamento.
    // /rotate é síncrono: o artefato vem nesta resposta. Se o processo
    // morrer aqui, o dinheiro já foi gasto e a imagem se perde.
    const imageB64 = res.data?.image;
    if (!imageB64) {
      throw new Error(
        `/rotate south→${dir} não devolveu campo "image". Resposta: ` +
          `${res.raw.slice(0, 200)}`,
      );
    }

    const raw = imageB64.replace(/^data:image\/\w+;base64,/, '');
    await writeFile(paths[dir], Buffer.from(raw, 'base64'));
    opts?.onLog?.(`[rotate] south→${dir} → ${paths[dir]} (${raw.length} chars b64)`);

    // Tracking de sessão (F1-06): acumula o gasto assim que a resposta chega.
    if (typeof res.usage?.usd === 'number') {
      trackSpend(res.usage.usd);
    }

    // Escrever no ledger com usage cru.
    if (opts?.ledgerPath) {
      const usage = res.usage;
      appendLedger(opts.ledgerPath, {
        at: new Date().toISOString(),
        direction: dir,
        endpoint: 'rotate',
        usd: usage?.usd ?? null,
        generations: usage?.generations ?? null,
        unit: usage?.type ?? 'unknown',
      });
    }
  }

  return paths;
}
