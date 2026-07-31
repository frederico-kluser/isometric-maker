/**
 * Prepend `// @ts-nocheck` to every vendored Motion UI source.
 *
 * The sources under src/components/motion-ui/ are owned by the shadcn CLI
 * (`npx shadcn add @motion/<name>` overwrites them on every install — never
 * edit them by hand). They are written for the standard shadcn tsconfig and
 * fail this repo's `exactOptionalPropertyTypes: true` with errors that are
 * not ours to fix.
 *
 * `@ts-nocheck` suppresses errors *inside* the vendored file only — callers
 * still get full prop type-checking, and runtime is untouched. Re-run this
 * script after every `npx shadcn add @motion/…`.
 *
 * Usage: node scripts/patch-vendored-ts.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VENDORED = new URL("../src/components/motion-ui/", import.meta.url).pathname;
const MARK = "// @ts-nocheck";

let patched = 0;
let already = 0;

const walk = (dir) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(path);
			continue;
		}
		if (!/\.(ts|tsx)$/.test(entry.name)) continue;
		const src = readFileSync(path, "utf8");
		if (src.startsWith(MARK)) {
			already += 1;
			continue;
		}
		writeFileSync(
			path,
			`${MARK} — vendored pelo shadcn CLI; não edite (regra 6 da skill motion-plus-ui).\n${src}`,
		);
		patched += 1;
	}
};

walk(VENDORED);
console.log(`patch-vendored-ts: ${patched} arquivo(s) marcados, ${already} já estavam ok.`);
