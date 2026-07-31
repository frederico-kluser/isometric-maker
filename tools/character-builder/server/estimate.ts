/**
 * Endpoint de estimativa de custo — devolve o relatório do guard ANTES da geração.
 *
 * GET /api/estimate?characterId=X&poseId=Y&wardrobeId=Z
 *
 * Calcula quantas gerações são necessárias, o custo estimado, e quanto a sessão e o mês
 * já gastaram. Não submete nada — o dinheiro só sai no POST /api/generate.
 *
 * O tracking de sessão é um acumulador em memória (zera quando o servidor reinicia).
 * O tracking mensal lê o ledger ndjson em assets/ledger.ndjson.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  COST_TABLE, estimateByArea, checkBudget,
  type BudgetReport,
} from '../../pixellab-pipeline/src/cost.ts';
import { estimateRotate, type RotateInput } from './rotate.ts';
import { type Character, type Pose, type WardrobeItem } from './model.ts';

// ------------------------------------------------------------------ tracking de sessão

/** Acumulador de gasto da sessão (em memória, zera no restart do servidor). */
let sessionSpentUsd = 0;

/** Regista um gasto no acumulador da sessão. */
export function trackSpend(usd: number): void {
  sessionSpentUsd += usd;
}

// ------------------------------------------------------------------ leitura do ledger mensal

const ROOT = new URL('..', import.meta.url).pathname;
const LEDGER_PATH = join(ROOT, 'assets', 'ledger.ndjson');

async function readMonthSpentUsd(): Promise<number> {
  try {
    const raw = await readFile(LEDGER_PATH, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let total = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { at?: string; usd?: number | null };
        if (entry.at && entry.at.startsWith(thisMonth) && typeof entry.usd === 'number') {
          total += entry.usd;
        }
      } catch {
        // linha malformada — ignora
      }
    }
    return total;
  } catch {
    return 0; // ledger não existe ainda
  }
}

// ------------------------------------------------------------------ estimativa

export interface EstimateRequest {
  character: Character;
  pose?: Pose;
  item?: WardrobeItem;
}

export interface EstimateResponse {
  /** Quantas gerações serão necessárias. */
  generations: number;
  /** Quantas já estão em cache (prontas). */
  cached: number;
  /** Relatório do guard. */
  report: BudgetReport;
}

/**
 * Calcula a estimativa para uma geração sem submeter nada.
 *
 * @param req — Dados do personagem, pose opcional, peça de guarda-roupa opcional.
 * @param monthSpent — Total gasto no mês (pré-calculado para evitar I/O repetido).
 */
export function computeEstimate(
  req: EstimateRequest,
  monthSpent: number,
): EstimateResponse {
  const { character, pose, item } = req;
  const area = character.size * character.size;

  if (item) {
    // create-character-state: 1 chamada, 20-40 generations
    const costRule = COST_TABLE['create-character-state'];
    const single = estimateByArea(costRule, area);
    const report = checkBudget({
      estimate: single,
      maxSingleAssetUsd: single.point,
      spentThisMonthUsd: monthSpent,
      spentThisSessionUsd: sessionSpentUsd,
      balanceUsd: undefined,
    });
    return {
      generations: costRule.generations?.[1] ?? costRule.generations?.[0] ?? 40,
      cached: 0,
      report,
    };
  }

  if (!pose || pose.id === '__base__') {
    // create-character-with-8-directions: 1 chamada
    // + 3× /rotate (south→north, east, west)
    const creationCost = estimateByArea(COST_TABLE['create-character-with-8-directions'], area);

    // rotate estimate
    const rotateInput: RotateInput = {
      fromImage: character.referenceImage ?? '',
      seed: character.seed,
      imageSize: { width: character.size, height: character.size },
      outputDir: join(ROOT, 'assets', 'temp'),
      ...(character.isometric !== undefined ? { isometric: character.isometric } : {}),
    };
    const rotateReport = estimateRotate(rotateInput);

    // Soma creation + rotate
    const totalEstimate = {
      low: creationCost.low + rotateReport.estimate.low,
      point: creationCost.point + rotateReport.estimate.point,
      high: creationCost.high + rotateReport.estimate.high,
      confidence: creationCost.confidence,
    };

    const report = checkBudget({
      estimate: totalEstimate,
      maxSingleAssetUsd: Math.max(creationCost.point, rotateReport.estimate.point),
      spentThisMonthUsd: monthSpent,
      spentThisSessionUsd: sessionSpentUsd,
      balanceUsd: undefined,
    });

    return {
      generations: 4, // 1 creation + 3 rotates
      cached: 0,
      report,
    };
  }

  // Pose: animate-character, billed per direction
  const costRule = COST_TABLE['animate-character'];
  // 1 generation per direction (template) or up to 40 (pro)
  const gensPerDir = pose.kind === 'template' ? 1 : (costRule.generations?.[1] ?? 40);
  const totalGen = gensPerDir * 8; // 8 direcções

  const single = estimateByArea(costRule, area);
  const totalCost = {
    low: single.low * 8,
    point: single.point * 8,
    high: single.high * 8,
    confidence: single.confidence,
  };

  const report = checkBudget({
    estimate: totalCost,
    maxSingleAssetUsd: single.point,
    spentThisMonthUsd: monthSpent,
    spentThisSessionUsd: sessionSpentUsd,
    balanceUsd: undefined,
  });

  return {
    generations: totalGen,
    cached: 0,
    report,
  };
}

/**
 * Devolve o estado actual do tracking (para o endpoint HTTP).
 */
export async function getEstimateReport(
  req: EstimateRequest,
): Promise<EstimateResponse> {
  const monthSpent = await readMonthSpentUsd();
  return computeEstimate(req, monthSpent);
}
