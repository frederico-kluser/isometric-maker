#!/usr/bin/env node
/**
 * pixellab — build-time asset pipeline CLI.
 *
 * Exit codes are part of the contract:
 *   0 ok · 1 error · 2 refused by budget · 3 API drift (strict)
 *   4 paid jobs pending, run `resume` · 5 artifact verification failed
 */
import { access, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PixelLabClient } from './api.ts';
import { runGenerate, runResume } from './generate.ts';
import { packGrid, PIXI_CLIENT_SNIPPET, type FrameInput } from './atlas.ts';
import { QueueStore } from './queue.ts';
import {
  buildPlan, emptyLockfile, loadLockfile, type Lockfile, type PlanItem, type AssetSpec,
} from './catalog.ts';
import { COST_TABLE, DEFAULT_LIMITS, TIER_CONCURRENCY, checkBudget, type Tier } from './cost.ts';
import { formatUsd, readJsonIfExists, shortDigest } from './util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LOCKFILE = join(ROOT, 'pixellab-lock.json');
const CACHE_DIR = join(ROOT, '.cache');
const LEDGER = join(ROOT, '.pixellab', 'ledger.ndjson');
const QUEUE = join(ROOT, '.pixellab', 'queue-state.json');
const ATLAS_OUT = resolve(ROOT, '..', '..', 'packages', 'game-assets', 'atlas');
const OPENAPI = join(ROOT, 'openapi', 'openapi-v2.json');

const exists = async (p: string): Promise<boolean> => {
  try { await access(p); return true; } catch { return false; }
};

async function loadCatalog(): Promise<readonly AssetSpec[]> {
  const mod = (await import(join(ROOT, 'assets', 'catalog.ts'))) as { default: readonly AssetSpec[] };
  return mod.default;
}

async function openapiFingerprint(): Promise<{ sha256: string; fetchedAt: string }> {
  const prov = join(ROOT, 'openapi', 'PROVENIENCIA.txt');
  const text = await readFile(prov, 'utf8').catch(() => '');
  const sha = /^[0-9a-f]{64}$/m.exec(text)?.[0] ?? 'unknown';
  const date = /\d{4}-\d{2}-\d{2}/.exec(text)?.[0] ?? 'unknown';
  return { sha256: sha, fetchedAt: date };
}

async function currentLock(): Promise<Lockfile> {
  const fp = await openapiFingerprint();
  return (await loadLockfile(LOCKFILE)) ?? emptyLockfile(fp.sha256, fp.fetchedAt);
}

async function spentThisMonth(): Promise<number> {
  const raw = await readFile(LEDGER, 'utf8').catch(() => '');
  const prefix = new Date().toISOString().slice(0, 7);
  let total = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { at?: string; usd?: number };
      if (e.at?.startsWith(prefix) && typeof e.usd === 'number') total += e.usd;
    } catch { /* a corrupt line must not block the budget gate */ }
  }
  return total;
}

// ---------------------------------------------------------------- commands

async function cmdBalance(): Promise<number> {
  const client = PixelLabClient.fromEnv();
  const { usd, raw } = await client.balance();
  if (usd === undefined) {
    console.log('Saldo devolvido em unidade não reconhecida (provável cota de assinatura).');
    console.log('Trate como número opaco e compare apenas deltas entre execuções.');
    console.log(raw.slice(0, 400));
    return 0;
  }
  console.log(`Saldo: ${formatUsd(usd)}  (1 crédito = US$ 1,00)`);
  console.log(`Gasto registrado neste mês (ledger local): ${formatUsd(await spentThisMonth())}`);
  return 0;
}

function renderPlan(items: readonly PlanItem[]): void {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.action, (counts.get(i.action) ?? 0) + 1);

  console.log('\nAção            Assets');
  console.log('─────────────── ──────');
  for (const [action, n] of [...counts].sort()) {
    console.log(`${action.padEnd(15)} ${String(n).padStart(6)}`);
  }

  const gen = items.filter((i) => i.action === 'generate');
  if (gen.length > 0) {
    console.log('\nA gerar:');
    const byGroup = new Map<string, { n: number; usd: number }>();
    for (const i of gen) {
      const k = i.asset.budgetGroup ?? i.asset.endpoint;
      const cur = byGroup.get(k) ?? { n: 0, usd: 0 };
      byGroup.set(k, { n: cur.n + 1, usd: cur.usd + i.asset.estimate.point });
    }
    console.log('\nGrupo                      Assets   Estimado');
    console.log('────────────────────────── ────── ──────────');
    for (const [g, v] of [...byGroup].sort((a, b) => b[1].usd - a[1].usd)) {
      console.log(`${g.padEnd(26)} ${String(v.n).padStart(6)} ${formatUsd(v.usd).padStart(10)}`);
    }
  }

  const blocked = items.filter((i) => i.action === 'blocked-rejected');
  for (const b of blocked) console.log(`\n  BLOQUEADO ${b.asset.id}: ${b.reason}`);
}

async function cmdPlan(): Promise<number> {
  const [catalog, lock] = await Promise.all([loadCatalog(), currentLock()]);
  const plan = await buildPlan(catalog, lock, exists);

  console.log(`Catálogo: ${catalog.length} assets`);
  console.log(`Lockfile: ${Object.keys(lock.assets).length} entradas · openapi ${shortDigest(`sha256:${lock.openapiSnapshot.sha256}`)} de ${lock.openapiSnapshot.fetchedAt}`);

  if (plan.validationErrors.length > 0) {
    console.log(`\n${plan.validationErrors.length} problema(s) de validação — nada foi submetido:`);
    for (const e of plan.validationErrors.slice(0, 20)) console.log(`  · ${e}`);
    if (plan.validationErrors.length > 20) {
      console.log(`  … e ${plan.validationErrors.length - 20} outros`);
    }
  }

  renderPlan(plan.items);

  const e = plan.estimate;
  console.log(`\nEstimativa do run: ${formatUsd(e.point)}  (faixa ${formatUsd(e.low)} – ${formatUsd(e.high)}, confiança: ${e.confidence})`);
  if (plan.savedUsd > 0) console.log(`Economizado pelo cache: ${formatUsd(plan.savedUsd)}`);
  console.log(`Jobs a submeter: ${plan.toGenerate.length}`);

  const tier = (process.env['PIXELLAB_TIER'] ?? 't1') as Tier;
  const slots = TIER_CONCURRENCY[tier] ?? 2;
  const seconds = plan.toGenerate.reduce(
    (s, i) => s + COST_TABLE[i.asset.endpoint].latencySec[0], 0,
  );
  const hours = seconds / slots / 3600;
  console.log(`Tempo estimado: ${hours < 1 ? `${Math.ceil(hours * 60)} min` : `${hours.toFixed(1)} h`} com ${slots} jobs simultâneos (tier ${tier})`);

  console.log('\nNada foi gerado. `plan` nunca gasta.');
  return plan.validationErrors.length > 0 ? 1 : 0;
}

async function cmdEstimate(): Promise<number> {
  const [catalog, lock] = await Promise.all([loadCatalog(), currentLock()]);
  const plan = await buildPlan(catalog, lock, exists);
  const client = PixelLabClient.fromEnv();
  const balance = await client.balance().catch(() => ({ usd: undefined as number | undefined }));

  const verdict = checkBudget({
    estimate: plan.estimate,
    maxSingleAssetUsd: plan.maxSingleAssetUsd,
    spentThisMonthUsd: await spentThisMonth(),
    balanceUsd: balance.usd,
  });

  console.log(`Estimativa: ${formatUsd(plan.estimate.point)} (pior caso ${formatUsd(plan.estimate.high)})`);
  console.log(`Asset mais caro: ${formatUsd(plan.maxSingleAssetUsd)} (teto ${formatUsd(DEFAULT_LIMITS.maxAssetUsd)})`);
  console.log(`Mês corrente: ${formatUsd(await spentThisMonth())} de ${formatUsd(DEFAULT_LIMITS.hardCapMonthlyUsd)}`);
  console.log(`\nGuard: ${verdict.kind}`);
  if (verdict.kind !== 'allow') console.log(`  ${verdict.kind === 'refuse' ? `[${verdict.code}] ` : ''}${verdict.reason}`);
  return verdict.kind === 'refuse' ? 2 : 0;
}

async function cmdVerify(): Promise<number> {
  const lock = await currentLock();
  let missing = 0;
  let checked = 0;
  for (const [id, entry] of Object.entries(lock.assets)) {
    for (const a of entry.artifacts) {
      checked += 1;
      const p = a.path.startsWith('/') ? a.path : join(ROOT, a.path);
      if (!(await exists(p))) { console.log(`  FALTA ${id} → ${a.path}`); missing += 1; continue; }
      const size = (await stat(p)).size;
      if (size !== a.bytes) {
        console.log(`  TAMANHO ${id} → ${a.path}: ${size} bytes, esperado ${a.bytes}`);
        missing += 1;
      }
    }
  }
  console.log(`${checked} artefato(s) conferido(s), ${missing} problema(s).`);
  return missing > 0 ? 5 : 0;
}

async function cmdDoctor(): Promise<number> {
  let problems = 0;
  const say = (ok: boolean, msg: string): void => {
    console.log(`  ${ok ? 'ok  ' : 'ERRO'} ${msg}`);
    if (!ok) problems += 1;
  };

  say(Number(process.versions.node.split('.')[0]) >= 24, `node ${process.versions.node} (exige ≥ 24)`);
  say(Boolean(process.env['PIXELLAB_SECRET']), 'PIXELLAB_SECRET definido');
  say(await exists(OPENAPI), `spec vendorizado em ${OPENAPI}`);

  const fp = await openapiFingerprint();
  say(fp.sha256 !== 'unknown', `PROVENIENCIA.txt com sha256 (${shortDigest(`sha256:${fp.sha256}`)}, ${fp.fetchedAt})`);

  const lock = await readJsonIfExists<Lockfile>(LOCKFILE);
  console.log(`  info lockfile: ${lock ? `${Object.keys(lock.assets).length} assets` : 'ainda não existe'}`);
  console.log(`  info cache:    ${(await exists(CACHE_DIR)) ? CACHE_DIR : 'vazio'}`);

  if (lock && lock.openapiSnapshot.sha256 !== fp.sha256) {
    console.log('\n  AVISO: o spec vendorizado mudou desde a última geração.');
    console.log('  Isso NÃO invalida o cache por design — drift de schema é aviso, não cobrança.');
    console.log('  Revise os endpoints que usamos antes de gerar.');
  }

  const catalog = await loadCatalog().catch((err: unknown) => {
    say(false, `catálogo não carrega: ${String(err)}`);
    return [] as readonly AssetSpec[];
  });
  say(catalog.length > 0, `catálogo com ${catalog.length} assets`);

  return problems > 0 ? 1 : 0;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function genOptions(dryRun: boolean): Parameters<typeof runGenerate>[3] {
  const limitRaw = flagValue('limit');
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  return {
    tier: (process.env['PIXELLAB_TIER'] ?? 't1') as Tier,
    cacheDir: CACHE_DIR,
    ledgerPath: LEDGER,
    queuePath: QUEUE,
    lockPath: LOCKFILE,
    dryRun,
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    onLog: (line: string) => console.log(line),
  };
}

async function cmdGenerate(): Promise<number> {
  const [catalog, lock] = await Promise.all([loadCatalog(), currentLock()]);
  const plan = await buildPlan(catalog, lock, exists);

  if (plan.validationErrors.length > 0) {
    console.error(`${plan.validationErrors.length} erro(s) de validação — nada submetido:`);
    for (const e of plan.validationErrors.slice(0, 10)) console.error(`  · ${e}`);
    return 1;
  }

  const dryRun = flag('dry-run');
  const client = dryRun ? null : PixelLabClient.fromEnv();
  const balance: { usd: number | undefined } = client
    ? await client.balance().catch(() => ({ usd: undefined }))
    : { usd: undefined };

  const verdict = checkBudget({
    estimate: plan.estimate,
    maxSingleAssetUsd: plan.maxSingleAssetUsd,
    spentThisMonthUsd: await spentThisMonth(),
    balanceUsd: balance.usd,
  });

  console.log(`A gerar: ${plan.toGenerate.length} asset(s) · estimado ${formatUsd(plan.estimate.point)}`);

  if (dryRun) {
    const res = await runGenerate(plan.items, lock, null, genOptions(true));
    console.log(`\nGuard diria: ${verdict.kind}${verdict.kind === 'allow' ? '' : ` — ${verdict.reason}`}`);
    return res.generated === 0 ? 0 : 0;
  }

  if (verdict.kind === 'refuse') {
    console.error(`\nRECUSADO [${verdict.code}]: ${verdict.reason}`);
    return 2;
  }
  if (verdict.kind === 'confirm' && !flag('yes')) {
    console.error(`\nCONFIRMAÇÃO NECESSÁRIA: ${verdict.reason}`);
    console.error('Repita com --yes se for isso mesmo.');
    return 2;
  }
  if (!process.stdout.isTTY && !flag('yes') && !dryRun) {
    console.error('Sem TTY e sem --yes: recusando gerar em ambiente não interativo.');
    return 2;
  }

  const opts = genOptions(dryRun);
  const res = await runGenerate(plan.items, lock, client, opts);
  console.log(
    `\nGerados ${res.generated} · falhas ${res.failed} · pagos pendentes ${res.pendingPaid} · ` +
      `gasto estimado ${formatUsd(res.spentEstimateUsd)}`,
  );
  return res.pendingPaid > 0 ? 4 : res.failed > 0 ? 1 : 0;
}

async function cmdResume(): Promise<number> {
  const lock = await currentLock();
  const res = await runResume(lock, PixelLabClient.fromEnv(), genOptions(false));
  console.log(`\nRecuperados ${res.recovered} · ainda pendentes ${res.stillPending}`);
  return res.stillPending > 0 ? 4 : 0;
}

async function cmdRescue(): Promise<number> {
  const store = await QueueStore.open(QUEUE);
  const atRisk = store.atRiskOfExpiry();
  if (atRisk.length === 0) {
    console.log('Nenhum recurso efêmero em risco de expirar.');
    return 0;
  }
  console.log(`${atRisk.length} recurso(s) efêmero(s) a baixar antes do prazo:`);
  for (const j of atRisk) console.log(`  ${j.assetId} — prazo ${j.downloadDeadline}`);
  const lock = await currentLock();
  const res = await runResume(lock, PixelLabClient.fromEnv(), genOptions(false));
  console.log(`\nResgatados ${res.recovered}`);
  return res.stillPending > 0 ? 4 : 0;
}

async function cmdAtlas(): Promise<number> {
  const lock = await currentLock();
  const entries = Object.entries(lock.assets);
  if (entries.length === 0) {
    console.log('Lockfile vazio — nada para empacotar. Rode `generate` primeiro.');
    return 0;
  }

  // Group by family: everything under creatures/<slug>/ becomes one atlas.
  const families = new Map<string, FrameInput[]>();
  for (const [assetId, entry] of entries) {
    const m = /^([a-z]+)\/([a-z0-9-]+)\/(?:anim\/)?([a-z0-9-]+)$/.exec(assetId);
    const family = m ? `${m[1]}/${m[2]}` : assetId.replace(/\//g, '-');
    const action = m ? m[3]! : 'base';
    const list = families.get(family) ?? [];
    entry.artifacts.forEach((a, i) => {
      const dir = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'][i % 8]!;
      const idx = Math.floor(i / 8);
      const short = family.split('/')[1] ?? family;
      list.push({
        name: `${short}_${action}_${dir}_${String(idx).padStart(2, '0')}`,
        file: a.path.startsWith('/') ? a.path : join(ROOT, a.path),
        animation: `${short}_${action}_${dir}`,
      });
    });
    families.set(family, list);
  }

  let packed = 0;
  for (const [family, frames] of families) {
    const present: FrameInput[] = [];
    for (const f of frames) if (await exists(f.file)) present.push(f);
    if (present.length === 0) { console.log(`  pulado ${family}: nenhum artefato em disco`); continue; }
    const outDir = join(ATLAS_OUT, family.split('/')[0] ?? 'misc');
    const name = family.split('/')[1] ?? family;
    const isTile = family.startsWith('terrain');
    const res = await packGrid(present, outDir, name, {
      extrude: isTile ? 2 : 1,
      padding: 2,
      ...(isTile ? { anchor: { x: 0, y: 0 } } : {}),
    });
    console.log(`  ok ${family} → ${res.size.w}×${res.size.h}, ${res.frameCount} frames`);
    packed += 1;
  }

  console.log(`\n${packed} atlas em ${ATLAS_OUT}`);
  console.log('\nNo cliente (PixiJS 8):');
  console.log(PIXI_CLIENT_SNIPPET.split('\n').map((l) => `  ${l}`).join('\n'));
  return 0;
}

function usage(): void {
  console.log(`
pixellab — pipeline de assets do isometric-maker

  balance     Saldo da conta e gasto do mês (ledger local).
  plan        Resolve o catálogo, diffa contra o lockfile. NUNCA gasta.
  estimate    Custo estimado + veredicto do guard de orçamento.
  doctor      Ambiente, spec vendorizado, drift de API.

  generate    Gera o que falta. GASTA DINHEIRO.
              --dry-run  não submete nada
              --limit N  no máximo N assets
              --yes      aceita a confirmação de custo
  resume      Repola jobs JÁ PAGOS de uma execução interrompida. Nunca resubmete.
  rescue      Baixa recursos efêmeros (map-objects, 8 h) antes do prazo.
              É o PRIMEIRO comando depois de qualquer queda.

  atlas       Empacota spritesheet + JSON do PixiJS. Custo zero de API.
  verify      Confere que todo artefato do lockfile existe em disco.

Variáveis: PIXELLAB_SECRET (obrigatório) · PIXELLAB_TIER=free|t1|t2|t3

Sempre rode 'plan' e 'estimate' antes de gerar. 'generate' gasta dinheiro real.
Exit: 0 ok · 1 erro · 2 recusado pelo orçamento · 4 jobs pagos pendentes · 5 artefato inválido
`);
}

const COMMANDS: Record<string, () => Promise<number>> = {
  balance: cmdBalance,
  plan: cmdPlan,
  estimate: cmdEstimate,
  verify: cmdVerify,
  doctor: cmdDoctor,
  generate: cmdGenerate,
  resume: cmdResume,
  rescue: cmdRescue,
  atlas: cmdAtlas,
};

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === '-h') { usage(); process.exit(0); }
  const run = COMMANDS[cmd];
  if (!run) { console.error(`comando desconhecido: ${cmd}`); usage(); process.exit(1); }
  process.exit(await run());
}

await main();
