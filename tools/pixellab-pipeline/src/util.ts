/**
 * Small shared helpers: canonical JSON, hashing, atomic writes, sleep.
 *
 * The canonical-JSON implementation matters more than it looks: it is the
 * foundation of asset identity. If two logically identical specs serialise
 * differently, we pay twice for the same image.
 */
import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * RFC 8785 (JCS) style canonicalisation, restricted to the JSON subset we use.
 *
 * Rules: object keys sorted by UTF-16 code unit, `undefined` members dropped,
 * no insignificant whitespace, numbers via the shortest round-trip form.
 * Deliberately throws on non-finite numbers — silently turning NaN into null
 * would make two different specs hash the same.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: non-finite number (${value})`);
      }
      // Normalise -0 to 0 so it cannot produce two hashes for one value.
      return JSON.stringify(value === 0 ? 0 : value);
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
      throw new TypeError('canonicalJson: undefined is not representable');
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }

  throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Prefixed digest, e.g. `sha256:ab12…`. Prefixed so the algorithm can change later. */
export function digest(data: string | Uint8Array): string {
  return `sha256:${sha256Hex(data)}`;
}

/** Short form for logs and directory names. Never for identity comparison. */
export function shortDigest(d: string): string {
  return d.replace(/^sha256:/, '').slice(0, 12);
}

/**
 * Write via temp file + rename so a crash can never leave a half-written
 * lockfile or queue state. On POSIX, rename within a filesystem is atomic.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter: random(0, min(cap, base * 2^attempt)). */
export function backoffMs(attempt: number, baseMs = 1_000, capMs = 60_000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

/** Parses `Retry-After`, which may be seconds or an HTTP date. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function formatUsd(n: number): string {
  return `US$ ${n.toFixed(n < 1 ? 4 : 2)}`;
}
