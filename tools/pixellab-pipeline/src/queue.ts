/**
 * Crash-safe job queue.
 *
 * The one invariant that matters: **money leaves on submit, value arrives on
 * download.** Between those two moments the job id is the only thing standing
 * between us and paying twice. So the id is written to disk with an atomic
 * rename *before* the first poll, and `resume` re-polls instead of resubmitting.
 *
 * A job whose id we hold is NEVER resubmitted. That is the most expensive bug
 * this module can have.
 */
import { COST_TABLE, TIER_CONCURRENCY, type Tier } from "./cost.ts";
import { ENDPOINTS, type EndpointId } from "./endpoints.ts";
import { readJsonIfExists, writeFileAtomic } from "./util.ts";

export type JobState =
	| "pending" // planned, nothing spent
	| "submitted" // PAID. id on disk. must be polled, never resubmitted
	| "completed" // remote says done; artifacts may not be downloaded yet
	| "downloaded" // artifacts on disk
	| "failed" // remote reported failure
	| "stalled"; // poll timed out; still PAID, `resume` picks it up

export interface JobRecord {
	readonly assetId: string;
	readonly specHash: string;
	readonly endpoint: EndpointId;
	state: JobState;
	jobId?: string;
	/** For endpoints that mint a resource id alongside the job id. */
	resourceId?: string;
	submittedAt?: string;
	completedAt?: string;
	/** Deadline for ephemeral resources: completedAt + ttl - 1h of margin. */
	downloadDeadline?: string;
	attempts: number;
	lastError?: string;
	costUsd: number;
}

export interface QueueState {
	readonly version: 1;
	startedAt: string;
	jobs: Record<string, JobRecord>;
}

export class QueueStore {
	readonly #path: string;
	#state: QueueState;

	private constructor(path: string, state: QueueState) {
		this.#path = path;
		this.#state = state;
	}

	static async open(path: string): Promise<QueueStore> {
		const loaded = await readJsonIfExists<QueueState>(path);
		return new QueueStore(
			path,
			loaded ?? { version: 1, startedAt: new Date().toISOString(), jobs: {} },
		);
	}

	get jobs(): Readonly<Record<string, JobRecord>> {
		return this.#state.jobs;
	}

	get(assetId: string): JobRecord | undefined {
		return this.#state.jobs[assetId];
	}

	/**
	 * Persists immediately. Every caller that has just spent money must await
	 * this before doing anything else — including before the first poll.
	 */
	async put(record: JobRecord): Promise<void> {
		this.#state.jobs[record.assetId] = record;
		await this.flush();
	}

	async flush(): Promise<void> {
		await writeFileAtomic(
			this.#path,
			`${JSON.stringify(this.#state, null, 2)}\n`,
		);
	}

	/** Jobs we already paid for whose artifacts are not on disk. */
	pendingPaid(): JobRecord[] {
		return Object.values(this.#state.jobs).filter(
			(j) =>
				j.state === "submitted" ||
				j.state === "completed" ||
				j.state === "stalled",
		);
	}

	/**
	 * Ephemeral resources at risk of expiring, soonest first.
	 *
	 * `/map-objects` self-destructs 8h after creation. Anything in here is money
	 * that evaporates if we do not download it, which is why `rescue` runs before
	 * anything else after a crash.
	 *
	 * Includes expired jobs within a 24h grace window (the remote artefact may
	 * still be alive) and jobs expiring in the next 24h. Jobs expired more than
	 * 24h ago are excluded — the artefact is almost certainly gone.
	 */
	atRiskOfExpiry(): JobRecord[] {
		const now = Date.now();
		return Object.values(this.#state.jobs)
			.filter(
				(j) => j.downloadDeadline !== undefined && j.state !== "downloaded",
			)
			.map((j) => ({ j, deadline: Date.parse(j.downloadDeadline!) }))
			.filter(
				(x) => Number.isFinite(x.deadline) && x.deadline > now - 86_400_000,
			)
			.sort((a, b) => a.deadline - b.deadline)
			.map((x) => x.j);
	}

	async clearDownloaded(): Promise<void> {
		for (const [id, j] of Object.entries(this.#state.jobs)) {
			if (j.state === "downloaded") delete this.#state.jobs[id];
		}
		await this.flush();
	}
}

/**
 * Weighted semaphore.
 *
 * Weighted rather than counted because a `create-character-pro` job costs the
 * server far more than a tileset, and the account-wide concurrency limit is
 * about server work, not about our call count. Exceeding it earns a 429.
 */
export class WeightedSemaphore {
	#available: number;
	readonly #waiters: { weight: number; resolve: () => void }[] = [];

	constructor(capacity: number) {
		this.#available = capacity;
	}

	async acquire(weight: number): Promise<void> {
		const w = Math.min(weight, Math.max(1, this.#available + weight));
		if (this.#available >= w) {
			this.#available -= w;
			return;
		}
		await new Promise<void>((resolve) =>
			this.#waiters.push({ weight: w, resolve }),
		);
		// #available already debited by release() — the debit happens
		// synchronously inside resolve() to prevent double-admission
		// when two release() calls happen in the same microtask turn.
	}

	release(weight: number): void {
		this.#available += weight;
		// Continue looping after a match: debiting capacity immediately
		// lets subsequent waiters in the same release() call see the
		// reduced value, preventing over-admission.
		for (let i = 0; i < this.#waiters.length; i += 1) {
			const waiter = this.#waiters[i]!;
			if (waiter.weight <= this.#available) {
				this.#available -= waiter.weight;
				this.#waiters.splice(i, 1);
				i -= 1; // re-check this index after splice
				waiter.resolve();
			}
		}
	}
}

/**
 * Additive-increase / multiplicative-decrease rate limiter.
 *
 * On a 429 the whole queue slows down, not just the offending job. Without
 * this, 20 concurrent workers each retrying independently produce a thundering
 * herd that keeps the account permanently rate-limited.
 */
export class AdaptiveLimiter {
	#tokensPerSec: number;
	readonly #ceiling: number;
	#lastRefill = 0;
	#tokens: number;

	constructor(tokensPerSec: number, burst = tokensPerSec) {
		this.#tokensPerSec = tokensPerSec;
		this.#ceiling = tokensPerSec;
		this.#tokens = burst;
	}

	/** Milliseconds the caller should wait before its next request. */
	reserve(nowMs: number): number {
		if (this.#lastRefill === 0) this.#lastRefill = nowMs;
		const elapsed = (nowMs - this.#lastRefill) / 1000;
		this.#tokens = Math.min(
			this.#ceiling,
			this.#tokens + elapsed * this.#tokensPerSec,
		);
		this.#lastRefill = nowMs;
		if (this.#tokens >= 1) {
			this.#tokens -= 1;
			return 0;
		}
		return Math.ceil(((1 - this.#tokens) / this.#tokensPerSec) * 1000);
	}

	/** Halve throughput. Called on 429/529. */
	penalise(): void {
		this.#tokensPerSec = Math.max(0.2, this.#tokensPerSec / 2);
	}

	/** Recover linearly on success, up to the original ceiling. */
	reward(): void {
		this.#tokensPerSec = Math.min(this.#ceiling, this.#tokensPerSec + 0.05);
	}

	get rate(): number {
		return this.#tokensPerSec;
	}
}

export function concurrencyFor(tier: Tier): number {
	return TIER_CONCURRENCY[tier];
}

export function weightFor(endpoint: EndpointId): number {
	return COST_TABLE[endpoint].concurrencyWeight;
}

/** Deadline for an ephemeral artifact, with an hour of margin. */
export function downloadDeadlineFor(
	endpoint: EndpointId,
	completedAt: Date,
): string | undefined {
	const ttl = COST_TABLE[endpoint].ephemeralTtlHours;
	if (ttl === undefined) return undefined;
	return new Date(completedAt.getTime() + (ttl - 1) * 3_600_000).toISOString();
}

export function isAsync(endpoint: EndpointId): boolean {
	return ENDPOINTS[endpoint].async;
}
