/**
 * The generate orchestrator: submit → persist → poll → download → ledger.
 *
 * Ordering here is not stylistic. It is:
 *   1. validate + plan            (free; a 422 after submit is money burnt)
 *   2. budget guard               (free; refuses before anything is spent)
 *   3. append to ledger AT SUBMIT (money leaves here, not at download)
 *   4. persist job id to disk     (before the first poll — survives Ctrl+C)
 *   5. poll, download, verify
 *
 * Steps 3 and 4 are what make a crash cost nothing but time.
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type PixelLabClient,
	pollJob,
	PixelLabError,
	type Usage,
} from "./api.ts";
import { ENDPOINTS, type EndpointId } from "./endpoints.ts";
import { COST_TABLE } from "./cost.ts";
import {
	AdaptiveLimiter,
	QueueStore,
	WeightedSemaphore,
	concurrencyFor,
	downloadDeadlineFor,
	weightFor,
	type JobRecord,
} from "./queue.ts";
import type {
	Lockfile,
	LockEntry,
	PlanItem,
	ResolvedAsset,
} from "./catalog.ts";
import { digest, formatUsd, sleep, writeFileAtomic } from "./util.ts";
import type { Tier } from "./cost.ts";

export interface GenerateOptions {
	readonly tier: Tier;
	readonly cacheDir: string;
	readonly ledgerPath: string;
	readonly queuePath: string;
	readonly lockPath: string;
	readonly dryRun: boolean;
	readonly limit?: number;
	readonly onLog: (line: string) => void;
}

/** Mutable while collecting; the LockEntry field it feeds is readonly. */
type ArtifactList = { path: string; sha256: string; bytes: number }[];

interface LedgerLine {
	readonly at: string;
	readonly assetId: string;
	readonly endpoint: EndpointId;
	readonly specHash: string;
	/** What we estimated. The real charge is reconciled by `calibrate`. */
	readonly usd: number;
	readonly unit: "usd" | "generations" | "estimated";
	readonly generations?: number;
	readonly jobId?: string;
}

async function appendLedger(path: string, line: LedgerLine): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true }).catch(() => undefined);
	await appendFile(path, `${JSON.stringify(line)}\n`);
}

/**
 * Pulls every image out of a response, whatever shape it arrived in.
 *
 * The v2 responses are not uniform: some carry `image.base64`, some an array of
 * `images`, some a `download_url`, tilesets carry `tileset.tiles[].image`. We
 * walk the object rather than special-casing each endpoint, because the shapes
 * change and a missed shape means a paid artifact silently dropped on the floor.
 */
export function extractImages(
	payload: unknown,
): { base64?: string; url?: string; hint: string }[] {
	const found: { base64?: string; url?: string; hint: string }[] = [];

	const walk = (node: unknown, path: string): void => {
		if (node === null || node === undefined) return;

		if (typeof node === "string") {
			// Data URI or bare base64 PNG (iVBORw0 is the PNG magic in base64).
			if (node.startsWith("data:image/")) {
				found.push({
					base64: node.replace(/^data:image\/\w+;base64,/, ""),
					hint: path,
				});
			} else if (/^iVBORw0KGgo/.test(node) && node.length > 256) {
				found.push({ base64: node, hint: path });
			} else if (/^https?:\/\/\S+\.(png|webp)(\?|$)/i.test(node)) {
				found.push({ url: node, hint: path });
			}
			return;
		}

		if (Array.isArray(node)) {
			node.forEach((v, i) => walk(v, `${path}[${i}]`));
			return;
		}

		if (typeof node === "object") {
			for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
				// `usage` never holds pixels; skip it so a numeric field cannot be
				// mistaken for anything.
				if (k === "usage") continue;
				walk(v, path ? `${path}.${k}` : k);
			}
		}
	};

	walk(payload, "");
	return found;
}

/** Reads the job/resource id out of a submit response, tolerating the variants. */
export function extractIds(payload: unknown): {
	jobId?: string;
	resourceId?: string;
} {
	const o = (payload ?? {}) as Record<string, unknown>;
	const pick = (...keys: string[]): string | undefined => {
		for (const k of keys) {
			const v = o[k];
			if (typeof v === "string" && v.length > 0) return v;
		}
		return undefined;
	};
	const jobId = pick("background_job_id", "job_id", "id");
	const resourceId = pick(
		"character_id",
		"object_id",
		"tileset_id",
		"tile_id",
		"ui_asset_id",
	);
	return {
		...(jobId ? { jobId } : {}),
		...(resourceId ? { resourceId } : {}),
	};
}

/**
 * Resolves `$ref`-style params against the lockfile.
 *
 * An animation needs the `character_id` the API minted for its parent. That id
 * only exists after the parent ran, so it is injected at submit time rather
 * than being part of the spec — which is also why it must not be part of the
 * spec hash.
 */
function resolveParams(
	asset: ResolvedAsset,
	lock: Lockfile,
): Record<string, unknown> {
	const params = { ...asset.params };
	for (const parentId of asset.dependsOn ?? []) {
		const parent = lock.assets[parentId];
		if (!parent?.remote?.id) {
			throw new Error(
				`${asset.id} depende de ${parentId}, que ainda não tem id remoto — ` +
					`gere o pai primeiro`,
			);
		}
		if (
			asset.endpoint === "animate-character" ||
			asset.endpoint === "create-character-state"
		) {
			params["character_id"] = parent.remote.id;
		}
	}
	return params;
}

async function saveArtifact(
	cacheDir: string,
	endpoint: EndpointId,
	specHash: string,
	index: number,
	image: { base64?: string; url?: string },
): Promise<{ path: string; sha256: string; bytes: number }> {
	const dir = join(
		cacheDir,
		endpoint,
		specHash.replace(/^sha256:/, "").slice(0, 16),
	);
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${String(index).padStart(3, "0")}.png`);

	let buf: Buffer;
	if (image.base64) {
		buf = Buffer.from(image.base64, "base64");
	} else if (image.url) {
		const res = await fetch(image.url);
		if (!res.ok)
			throw new Error(`download falhou (${res.status}): ${image.url}`);
		buf = Buffer.from(await res.arrayBuffer());
	} else {
		throw new Error("imagem sem base64 nem url");
	}

	await writeFile(path, buf);
	return { path, sha256: digest(buf), bytes: buf.length };
}

export interface GenerateResult {
	readonly generated: number;
	readonly failed: number;
	readonly pendingPaid: number;
	readonly spentEstimateUsd: number;
}

export async function runGenerate(
	plan: readonly PlanItem[],
	lock: Lockfile,
	/** null in a dry run: a dry run must work without a token. */
	client: PixelLabClient | null,
	opts: GenerateOptions,
): Promise<GenerateResult> {
	const todo = plan.filter((i) => i.action === "generate");
	const selected = opts.limit === undefined ? todo : todo.slice(0, opts.limit);

	if (opts.dryRun || client === null) {
		opts.onLog(
			`[dry-run] submeteria ${selected.length} job(s); nada foi enviado.`,
		);
		for (const i of selected) {
			opts.onLog(`    ${i.asset.endpoint.padEnd(36)} ${i.asset.id}`);
		}
		return { generated: 0, failed: 0, pendingPaid: 0, spentEstimateUsd: 0 };
	}

	const store = await QueueStore.open(opts.queuePath);
	const slots = concurrencyFor(opts.tier);
	const sem = new WeightedSemaphore(slots);
	const limiter = new AdaptiveLimiter(Math.max(1, slots / 2));

	opts.onLog(`Concorrência: ${slots} slots (tier ${opts.tier}).`);

	let generated = 0;
	let failed = 0;
	let spent = 0;

	// Dependency order is already guaranteed by buildPlan's topological sort.
	// Assets with dependencies are run sequentially after their parent so the
	// remote id exists; independent ones fan out.
	const withDeps = selected.filter((i) => (i.asset.dependsOn?.length ?? 0) > 0);
	const independent = selected.filter(
		(i) => (i.asset.dependsOn?.length ?? 0) === 0,
	);

	const runOne = async (item: PlanItem): Promise<void> => {
		const asset = item.asset;
		const weight = weightFor(asset.endpoint);
		await sem.acquire(weight);
		try {
			const wait = limiter.reserve(Date.now());
			if (wait > 0) await sleep(wait);

			let params: Record<string, unknown>;
			try {
				params = resolveParams(asset, lock);
			} catch (err) {
				opts.onLog(`  PULADO ${asset.id}: ${(err as Error).message}`);
				failed += 1;
				return;
			}

			const record: JobRecord = {
				assetId: asset.id,
				specHash: asset.specHash,
				endpoint: asset.endpoint,
				state: "pending",
				attempts: 0,
				costUsd: asset.estimate.point,
			};

			let submitted: Awaited<ReturnType<typeof client.submit>>;
			try {
				submitted = await client.submit(asset.endpoint, params);
			} catch (err) {
				limiter.penalise();
				const msg =
					err instanceof PixelLabError
						? `${err.status} ${err.message}`
						: String(err);
				opts.onLog(`  FALHOU ${asset.id}: ${msg}`);
				record.state = "failed";
				record.lastError = msg;
				await store.put(record);
				failed += 1;
				return;
			}

			limiter.reward();

			// --- money has now left the account -----------------------------------
			const ids = extractIds(submitted.data);
			const usage = submitted.usage as Usage | undefined;
			record.state = "submitted";
			record.submittedAt = new Date().toISOString();
			if (ids.jobId) record.jobId = ids.jobId;
			if (ids.resourceId) record.resourceId = ids.resourceId;

			// Persist BEFORE polling. This line is the whole point of the module.
			await store.put(record);
			await appendLedger(opts.ledgerPath, {
				at: record.submittedAt,
				assetId: asset.id,
				endpoint: asset.endpoint,
				specHash: asset.specHash,
				usd: usage?.usd ?? asset.estimate.point,
				unit: usage?.type ?? "estimated",
				...(usage?.generations ? { generations: usage.generations } : {}),
				...(ids.jobId ? { jobId: ids.jobId } : {}),
			});
			spent += usage?.usd ?? asset.estimate.point;
			// ----------------------------------------------------------------------

			let payload: unknown = submitted.data;

			if (ENDPOINTS[asset.endpoint].async) {
				if (!record.jobId) {
					opts.onLog(
						`  ATENÇÃO ${asset.id}: submetido (pago) mas sem job id na resposta.`,
					);
					record.state = "stalled";
					await store.put(record);
					return;
				}
				const polled = await pollJob(client, record.jobId);
				if (!polled.ok) {
					record.state = polled.reason === "timeout" ? "stalled" : "failed";
					record.lastError =
						polled.reason === "failed"
							? (polled.detail ?? "failed")
							: "timeout";
					await store.put(record);
					opts.onLog(
						`  ${polled.reason === "timeout" ? "TRAVOU" : "FALHOU"} ${asset.id}` +
							`${polled.reason === "timeout" ? " — já pago, rode `resume`" : `: ${record.lastError}`}`,
					);
					if (polled.reason === "failed") failed += 1;
					return;
				}
				payload = polled.job.last_response ?? polled.job;
			}

			record.state = "completed";
			record.completedAt = new Date().toISOString();
			const deadline = downloadDeadlineFor(
				asset.endpoint,
				new Date(record.completedAt),
			);
			if (deadline) record.downloadDeadline = deadline;
			await store.put(record);

			const images = extractImages(payload);
			if (images.length === 0) {
				opts.onLog(
					`  SEM IMAGEM ${asset.id}: resposta sem artefato reconhecível (pago).`,
				);
				record.state = "stalled";
				await store.put(record);
				return;
			}

			const artifacts: ArtifactList = [];
			for (const [i, img] of images.entries()) {
				artifacts.push(
					await saveArtifact(
						opts.cacheDir,
						asset.endpoint,
						asset.specHash,
						i,
						img,
					),
				);
			}

			record.state = "downloaded";
			await store.put(record);

			const entry: LockEntry = {
				specHash: asset.specHash,
				postHash: asset.postHash,
				endpoint: asset.endpoint,
				status: "generated",
				generatedAt: record.completedAt,
				costUsd: usage?.usd ?? asset.estimate.point,
				artifacts,
				requestSnapshot: params,
				...(record.jobId ? { jobId: record.jobId } : {}),
				...(record.resourceId
					? {
							remote: {
								kind: asset.endpoint,
								id: record.resourceId,
								ephemeral:
									COST_TABLE[asset.endpoint].ephemeralTtlHours !== undefined,
							},
						}
					: {}),
			};
			lock.assets[asset.id] = entry;
			await writeFileAtomic(
				opts.lockPath,
				`${JSON.stringify(lock, null, 2)}\n`,
			);

			generated += 1;
			opts.onLog(
				`  ok ${asset.id} → ${artifacts.length} artefato(s), ${formatUsd(entry.costUsd)}`,
			);
		} finally {
			sem.release(weight);
		}
	};

	await Promise.all(independent.map(runOne));
	for (const item of withDeps) await runOne(item);

	const pending = store.pendingPaid().length;
	if (pending > 0) {
		opts.onLog(
			`\n${pending} job(s) já pago(s) sem artefato em disco. Rode \`resume\` — ` +
				`nunca \`generate\` de novo, que resubmeteria e cobraria duas vezes.`,
		);
	}

	return { generated, failed, pendingPaid: pending, spentEstimateUsd: spent };
}

/**
 * Re-polls jobs we already paid for. Never resubmits.
 *
 * This is the recovery path after Ctrl+C, OOM or a dropped connection.
 */
export async function runResume(
	lock: Lockfile,
	client: PixelLabClient,
	opts: GenerateOptions,
): Promise<{ recovered: number; stillPending: number }> {
	const store = await QueueStore.open(opts.queuePath);
	const paid = store.pendingPaid();
	if (paid.length === 0) {
		opts.onLog("Nada pendente. Nenhum job pago sem artefato.");
		return { recovered: 0, stillPending: 0 };
	}

	// Ephemeral resources first: those expire, the rest just waits.
	const atRisk = new Set(store.atRiskOfExpiry().map((j) => j.assetId));
	const ordered = [...paid].sort(
		(a, b) => Number(atRisk.has(b.assetId)) - Number(atRisk.has(a.assetId)),
	);

	opts.onLog(
		`${ordered.length} job(s) pago(s) a recuperar (${atRisk.size} com prazo de expiração).`,
	);

	let recovered = 0;
	for (const record of ordered) {
		if (!record.jobId) {
			opts.onLog(`  sem job id: ${record.assetId} — perdido, precisa regerar`);
			continue;
		}
		const polled = await pollJob(client, record.jobId, { timeoutMs: 120_000 });
		if (!polled.ok) {
			opts.onLog(`  ainda não pronto: ${record.assetId}`);
			continue;
		}
		const images = extractImages(polled.job.last_response ?? polled.job);
		if (images.length === 0) {
			opts.onLog(`  sem imagem: ${record.assetId}`);
			continue;
		}
		const artifacts: ArtifactList = [];
		for (const [i, img] of images.entries()) {
			artifacts.push(
				await saveArtifact(
					opts.cacheDir,
					record.endpoint,
					record.specHash,
					i,
					img,
				),
			);
		}
		record.state = "downloaded";
		await store.put(record);

		const existing = lock.assets[record.assetId];
		const ephemeral =
			COST_TABLE[record.endpoint]?.ephemeralTtlHours !== undefined;
		lock.assets[record.assetId] = {
			specHash: record.specHash,
			postHash: existing?.postHash ?? "",
			endpoint: record.endpoint,
			status: "generated",
			generatedAt: record.completedAt ?? new Date().toISOString(),
			costUsd: record.costUsd,
			artifacts,
			...(record.jobId ? { jobId: record.jobId } : {}),
			...(record.resourceId
				? {
						remote: { kind: record.endpoint, id: record.resourceId, ephemeral },
					}
				: {}),
		};
		await writeFileAtomic(opts.lockPath, `${JSON.stringify(lock, null, 2)}\n`);
		recovered += 1;
		opts.onLog(`  recuperado ${record.assetId} (custo zero — já estava pago)`);
	}

	return { recovered, stillPending: store.pendingPaid().length };
}
