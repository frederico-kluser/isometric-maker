/**
 * HTTP transport for the PixelLab API v2.
 *
 * Handles the retry surface that is easy to get wrong:
 *   429  "Too many concurrent jobs" / "Concurrency limit reached"
 *   529  "Rate limit exceeded"  <- non-standard, most HTTP clients ignore it
 *   423  Locked + Retry-After, returned while a map object is still generating
 *   410  Gone, permanent generation failure
 * All four appear in the vendored spec.
 *
 * Retry policy: only on transient status codes and network faults. Never on
 * 400/401/403/404/422 — those are our bug, and retrying only burns quota.
 */
import { ENDPOINTS, type EndpointId } from "./endpoints.ts";
import { backoffMs, parseRetryAfter, sleep } from "./util.ts";

const BASE_URL = "https://api.pixellab.ai/v2";

/** Codes worth retrying. 529 is PixelLab-specific and easy to miss. */
const TRANSIENT = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export class PixelLabError extends Error {
	readonly status: number;
	readonly body: string;
	readonly retryable: boolean;

	constructor(
		message: string,
		status: number,
		body: string,
		retryable: boolean,
	) {
		super(message);
		this.name = "PixelLabError";
		this.status = status;
		this.body = body;
		this.retryable = retryable;
	}
}

export interface Usage {
	/** The API bills in one of two units and tells us which. Never mix them. */
	readonly type: "usd" | "generations";
	readonly usd?: number | null;
	readonly generations?: number | null;
}

export interface BalanceResponse {
	readonly credits: { readonly type: "usd"; readonly usd: number };
	readonly subscription?: unknown;
}

export interface RequestOptions {
	readonly maxAttempts?: number;
	readonly timeoutMs?: number;
	readonly signal?: AbortSignal;
}

export interface ApiResult<T> {
	readonly data: T;
	readonly status: number;
	readonly usage?: Usage;
	/** Raw body, kept so the lockfile can record exactly what the API returned. */
	readonly raw: string;
}

export class PixelLabClient {
	readonly #secret: string;
	readonly #baseUrl: string;

	constructor(secret: string, baseUrl: string = BASE_URL) {
		if (!secret) {
			throw new Error(
				"PIXELLAB_SECRET não definido. Pegue o token em https://pixellab.ai/account",
			);
		}
		this.#secret = secret;
		this.#baseUrl = baseUrl;
	}

	static fromEnv(): PixelLabClient {
		return new PixelLabClient(process.env["PIXELLAB_SECRET"] ?? "");
	}

	/**
	 * One request with retry. `path` is relative to the v2 base.
	 *
	 * Important: a successful POST to an async endpoint means we have been
	 * charged. The caller must persist the returned job id before doing anything
	 * else — see queue.ts.
	 */
	async request<T>(
		method: "GET" | "POST" | "DELETE" | "PATCH",
		path: string,
		body?: unknown,
		opts: RequestOptions = {},
	): Promise<ApiResult<T>> {
		const maxAttempts = opts.maxAttempts ?? 6;
		const timeoutMs = opts.timeoutMs ?? 120_000;
		let lastError: unknown;

		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			const timeout = AbortSignal.timeout(timeoutMs);
			const signal = opts.signal
				? AbortSignal.any([opts.signal, timeout])
				: timeout;

			try {
				const res = await fetch(`${this.#baseUrl}${path}`, {
					method,
					headers: {
						Authorization: `Bearer ${this.#secret}`,
						...(body === undefined
							? {}
							: { "Content-Type": "application/json" }),
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
					signal,
				});

				const raw = await res.text();

				if (res.ok || res.status === 202) {
					const data =
						raw.length > 0 ? (JSON.parse(raw) as T) : (undefined as T);
					const usage = (data as { usage?: Usage } | undefined)?.usage;
					return {
						data,
						status: res.status,
						raw,
						...(usage ? { usage } : {}),
					};
				}

				// 423 Locked is not an error for map objects — it means "still working".
				// Surface it to the caller with the Retry-After hint intact.
				if (res.status === 423) {
					throw new PixelLabError(
						`423 Locked (ainda gerando): ${path}`,
						423,
						raw,
						false,
					);
				}

				// For POST: server errors (500, 502, 503, 504) are NOT retried — the
				// request may have been processed and billed but the response was lost.
				// Only "not accepted yet" codes (429, 529) are safe to retry on POST.
				// GET/DELETE/PATCH retry on all transient codes as before.
				const retryable =
					method === "POST"
						? res.status === 429 || res.status === 529
						: TRANSIENT.has(res.status);
				const err = new PixelLabError(
					`${res.status} em ${method} ${path}: ${raw.slice(0, 300)}`,
					res.status,
					raw,
					retryable,
				);
				if (!retryable || attempt === maxAttempts - 1) throw err;

				// Retry-After always wins over our computed backoff.
				const serverHint = parseRetryAfter(res.headers.get("retry-after"));
				await sleep(serverHint ?? backoffMs(attempt));
				lastError = err;
			} catch (err) {
				if (err instanceof PixelLabError) {
					if (!err.retryable || attempt === maxAttempts - 1) throw err;
					lastError = err;
					await sleep(backoffMs(attempt));
					continue;
				}
				// Network fault or timeout: retryable.
				if (attempt === maxAttempts - 1) throw err;
				lastError = err;
				await sleep(backoffMs(attempt));
			}
		}

		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}

	/**
	 * Account balance.
	 *
	 * Deliberately returns the number as opaque: under a subscription the
	 * meaningful unit may be `generations` rather than USD. Compare deltas between
	 * runs; never treat this as the only budget gate.
	 */
	async balance(): Promise<{ usd: number | undefined; raw: string }> {
		const res = await this.request<BalanceResponse>("GET", "/balance");
		const usd =
			typeof res.data?.credits?.usd === "number"
				? res.data.credits.usd
				: undefined;
		return { usd, raw: res.raw };
	}

	/** Submits a generation. Returns the parsed body; job id extraction is the caller's job. */
	async submit<T>(
		endpoint: EndpointId,
		params: unknown,
		opts?: RequestOptions,
	): Promise<ApiResult<T>> {
		return this.request<T>("POST", ENDPOINTS[endpoint].path, params, opts);
	}

	async job<T>(jobId: string, opts?: RequestOptions): Promise<ApiResult<T>> {
		return this.request<T>(
			"GET",
			`/background-jobs/${encodeURIComponent(jobId)}`,
			undefined,
			opts,
		);
	}

	/**
	 * Polls a map object.
	 *
	 * Distinct from the generic job poll because the contract is different:
	 *   200 -> metadata + download_url
	 *   423 -> still generating, honour Retry-After
	 *   410 -> permanently failed
	 *   404 -> no such job for this user
	 * And the artifact auto-deletes 8h after creation.
	 */
	async mapObject<T>(
		objectId: string,
		opts?: RequestOptions,
	): Promise<
		| { readonly state: "ready"; readonly data: T }
		| { readonly state: "generating"; readonly retryAfterMs: number }
		| { readonly state: "failed" }
		| { readonly state: "missing" }
	> {
		try {
			const res = await this.request<T>(
				"GET",
				`/map-objects/${encodeURIComponent(objectId)}`,
				undefined,
				{ ...opts, maxAttempts: 1 },
			);
			return { state: "ready", data: res.data };
		} catch (err) {
			if (!(err instanceof PixelLabError)) throw err;
			if (err.status === 423)
				return { state: "generating", retryAfterMs: 10_000 };
			if (err.status === 410) return { state: "failed" };
			if (err.status === 404) return { state: "missing" };
			throw err;
		}
	}
}

export type JobStatus = "processing" | "completed" | "failed";

export interface BackgroundJob {
	readonly status: JobStatus;
	readonly last_response?: unknown;
	readonly error?: string;
}

/**
 * Polls a background job until it settles.
 *
 * Poll cadence follows the API guidance (2-5s early, then slower). The absolute
 * ceiling exists so a stuck job cannot hang a run forever — but note the caller
 * must keep the job id on disk regardless, because the money is already spent
 * and `resume` can pick it up later.
 */
export async function pollJob(
	client: PixelLabClient,
	jobId: string,
	opts: {
		readonly initialMs?: number;
		readonly steadyMs?: number;
		readonly switchAfterMs?: number;
		readonly timeoutMs?: number;
		readonly signal?: AbortSignal;
		readonly onTick?: (elapsedMs: number) => void;
	} = {},
): Promise<
	| { readonly ok: true; readonly job: BackgroundJob }
	| {
			readonly ok: false;
			readonly reason: "timeout" | "failed";
			readonly detail?: string;
	  }
> {
	const initialMs = opts.initialMs ?? 5_000;
	const steadyMs = opts.steadyMs ?? 10_000;
	const switchAfterMs = opts.switchAfterMs ?? 30_000;
	const timeoutMs = opts.timeoutMs ?? 600_000;
	const started = Date.now();

	for (;;) {
		const elapsed = Date.now() - started;
		if (elapsed > timeoutMs) return { ok: false, reason: "timeout" };
		opts.onTick?.(elapsed);

		const res = await client.job<BackgroundJob>(
			jobId,
			opts.signal ? { signal: opts.signal } : {},
		);
		const status = res.data?.status;
		if (status === "completed") return { ok: true, job: res.data };
		if (status === "failed") {
			return {
				ok: false,
				reason: "failed",
				...(res.data.error ? { detail: res.data.error } : {}),
			};
		}

		await sleep(elapsed < switchAfterMs ? initialMs : steadyMs);
	}
}
