/**
 * A reader for the vendored PixiJS declaration file.
 *
 * Shared by inspect-pixi.mjs (what does the API look like) and
 * check-pixi-claims.mjs (is this claim true). It lives in one file because the
 * two scripts started as two copies and immediately grew the same two bugs:
 * both reported `Container.zIndex` as nonexistent.
 *
 * That bug is worth stating, because it is the whole reason this file is not
 * ten lines of regex. PixiJS v8 assembles its public types by declaration
 * merging, on three levels at once:
 *
 *   1. Top level. `Container` is declared TWICE — once as `class Container`,
 *      once as `interface Container extends PixiMixins.Container<C>`. Keeping
 *      only the last one seen loses every mixin.
 *   2. `namespace PixiMixins`. Twenty separate blocks contribute to interfaces
 *      like `Container` and `ApplicationOptions`, from the plugin that owns
 *      each feature. `ApplicationOptions` has a literally empty body; resizeTo,
 *      autoStart and sharedTicker are merged in from elsewhere.
 *   3. Utility wrappers. `SortMixin extends Required<SortMixinConstructor>`,
 *      and `zIndex` is inside the constructor interface. Stripping generics
 *      naively turns that parent into `Required` and drops the real one.
 *
 * So `Container.zIndex` resolves through: class/interface merge -> PixiMixins
 * .Container -> SortMixin -> Required<SortMixinConstructor> -> zIndex. Five
 * hops, and every hop is a place a simpler reader silently answers "no".
 *
 * What it deliberately cannot do: resolve mapped types. `ExtractRendererOptions
 * <typeof SharedSystems>` is where width, height and background come from, and
 * nothing short of a type checker resolves it. Lookups that end there report
 * `complete: false` rather than `not found`, because a gap reported as an
 * answer is how a true claim gets rejected with confidence.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Top-level declarations, exported or not.
 *
 * The `export` keyword is optional here because the bundler that produces this
 * file renames colliding names and re-exports them: the class the world calls
 * `Text` is declared as `declare class Text$1` — no `export` — and reaches the
 * public API only through `export { Text$1 as Text }` at the end of the file.
 * Requiring `export` on the declaration makes `Text` look nonexistent, which is
 * a false negative about one of the most-used classes in the library.
 *
 * Anchoring at column zero is what still excludes the tab-indented interfaces
 * inside `namespace PixiMixins`, which are indexed separately.
 */
const DECL = /^(?:export )?(?:declare )?(?:abstract )?(class|interface|type|function|const|enum|namespace) ([A-Za-z_$][\w$]*)/;

/** `export { Text$1 as Text }` — the public name on the right, the real one on the left. */
const EXPORT_BLOCK = /^export \{\n([\s\S]*?)^\};?$/gm;
const ALIAS = /^\s*([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*,?\s*$/gm;

/** `export declare const Assets: AssetsClass;` — the members live on the type. */
const CONST_TYPE = /^(?:export )?(?:declare )?const [A-Za-z_$][\w$]*\s*:\s*([A-Za-z_$][\w$]*)/;
const MEMBER = /^\t*(?:(?:static|readonly|protected|private|public|abstract|declare|override|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*[?!]?\s*[(:<]/;
const NS = /^(\t*)namespace PixiMixins \{/;
const NESTED_IFACE = /^(\t*)interface ([A-Za-z_$][\w$]*)/;

/** Type utilities whose first argument is the type actually being extended. */
const UNWRAP = /^(Partial|Required|Readonly|NonNullable|Omit|Pick|Exclude|Extract)<([\s\S]+)>$/;

export function vendorPaths(repoRoot) {
  const vendor = join(repoRoot, 'tools', 'pixi-reference', 'vendor');
  return {
    vendor,
    dts: join(vendor, 'pixi-api.d.ts'),
    manifest: join(vendor, 'manifest.json'),
    skills: join(vendor, 'skills'),
  };
}

/** Split on commas that are not inside a type-argument list. */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '<') depth += 1;
    else if (ch === '>') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** `Required<SortMixinConstructor>` -> `SortMixinConstructor`; `Foo<T>` -> `Foo`. */
function baseType(t) {
  const s = t.trim();
  const m = UNWRAP.exec(s);
  if (m) {
    const first = splitTop(m[2])[0];
    return first ? baseType(first) : '';
  }
  return s.replace(/<[\s\S]*$/, '').trim();
}

export function loadIndex(dtsPath, manifestPath) {
  if (!existsSync(dtsPath)) return null;
  const lines = readFileSync(dtsPath, 'utf8').split('\n');

  const blockEnd = (start) => {
    let depth = 0;
    let opened = false;
    for (let i = start; i < lines.length; i += 1) {
      for (const ch of lines[i]) {
        if (ch === '{') { depth += 1; opened = true; } else if (ch === '}') depth -= 1;
      }
      if (opened && depth <= 0) return i;
      if (!opened && /;\s*$/.test(lines[i])) return i;
    }
    return start;
  };

  // Every name maps to a LIST of blocks. A single entry per name is what loses
  // `interface Container` to `class Container`.
  const decls = new Map();
  const push = (map, key, block) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(block);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const m = DECL.exec(lines[i]);
    if (m) push(decls, m[2], { name: m[2], kind: m[1], start: i, end: blockEnd(i) });
  }

  const mixins = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const ns = NS.exec(lines[i]);
    if (!ns) continue;
    const nsEnd = blockEnd(i);
    // The namespace itself is indented inside `declare global`, so the
    // top-level scan never sees it. Registering it here is what lets a skill
    // name `PixiMixins` — the mechanism it has to explain — without the claim
    // checker reporting the mechanism as fictional.
    push(decls, 'PixiMixins', { name: 'PixiMixins', kind: 'namespace', start: i, end: nsEnd });
    for (let j = i + 1; j < nsEnd; j += 1) {
      const f = NESTED_IFACE.exec(lines[j]);
      if (!f || f[1].length !== ns[1].length + 1) continue;
      const key = `PixiMixins.${f[2]}`;
      push(mixins, key, { name: key, kind: 'interface', start: j, end: blockEnd(j) });
    }
    i = nsEnd;
  }

  // Public name -> the internal name the bundler actually declared.
  const aliases = new Map();
  const whole = lines.join('\n');
  for (const blk of whole.matchAll(EXPORT_BLOCK)) {
    for (const a of blk[1].matchAll(ALIAS)) aliases.set(a[2], a[1]);
  }

  const manifest = manifestPath && existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {};

  return { lines, decls, mixins, aliases, manifest, blockEnd };
}

/** The name to look declarations up under, following a bundler alias if needed. */
export function resolveName(idx, name) {
  if (idx.decls.has(name) || idx.mixins.has(name)) return name;
  const target = idx.aliases.get(name);
  return target && idx.decls.has(target) ? target : name;
}

/** Members declared directly in a block. Indent is relative: mixins sit deeper. */
export function membersOf(idx, block) {
  const { lines } = idx;
  const depth = (/^\t*/.exec(lines[block.start])[0]).length + 1;
  const out = new Map();
  for (let i = block.start + 1; i < block.end; i += 1) {
    if ((/^\t*/.exec(lines[i])[0]).length !== depth) continue;
    const m = MEMBER.exec(lines[i]);
    if (m && !out.has(m[1])) out.set(m[1], i);
  }
  return out;
}

export function parentsOf(idx, block) {
  const { lines } = idx;
  let head = '';
  for (let i = block.start; i <= block.end; i += 1) {
    head += ` ${lines[i]}`;
    if (lines[i].includes('{')) break;
  }

  // Drop the declaration's OWN type-parameter list first: it can contain the
  // word `extends` (`class Container<C extends ContainerChild>`), which would
  // otherwise be read as the inheritance clause. Type ARGUMENTS on the parents
  // must survive — `Required<SortMixinConstructor>` carries the parent inside.
  const decl = /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|interface)\s+[A-Za-z_$][\w$]*|^\s*interface\s+[A-Za-z_$][\w$]*/.exec(head);
  let rest = decl ? head.slice(decl[0].length) : head;
  if (rest.trimStart().startsWith('<')) {
    let depth = 0;
    let k = rest.indexOf('<');
    for (; k < rest.length; k += 1) {
      if (rest[k] === '<') depth += 1;
      else if (rest[k] === '>') { depth -= 1; if (depth === 0) { k += 1; break; } }
    }
    rest = rest.slice(k);
  }

  const m = /\bextends\s+([\s\S]+?)(?:\s+implements\s|\s*\{|$)/.exec(rest);
  if (!m) return [];
  return splitTop(m[1]).map(baseType).filter(Boolean);
}

export function blocksFor(idx, name) {
  const key = resolveName(idx, name);
  return idx.mixins.get(key) ?? idx.decls.get(key) ?? null;
}

/**
 * Everything a member lookup should follow out of a block.
 *
 * Parents, plus the annotated type of a `const`. That second one matters more
 * than it looks: `Assets` — the object every load in the library goes through —
 * is `export declare const Assets: AssetsClass`, so without following the
 * annotation, `Assets.load` resolves to nothing.
 */
function followsOf(idx, block) {
  const out = parentsOf(idx, block);
  if (block.kind === 'const') {
    const m = CONST_TYPE.exec(idx.lines[block.start]);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Find one member by walking the merge and inheritance graph.
 *
 * Returns `{ found, complete }`. `complete: false` means the walk hit a type
 * this reader cannot resolve, so "not found" is a gap and not a verdict.
 */
export function findMember(idx, name, member, seen = new Set()) {
  if (seen.has(name)) return { found: null, complete: true };
  seen.add(name);

  const blocks = blocksFor(idx, name);
  if (!blocks) return { found: null, complete: false };

  for (const b of blocks) {
    const i = membersOf(idx, b).get(member);
    if (i !== undefined) return { found: { line: i, owner: name }, complete: true };
  }
  let complete = true;
  for (const b of blocks) {
    for (const p of followsOf(idx, b)) {
      const r = findMember(idx, p, member, seen);
      if (r.found) return r;
      if (!r.complete) complete = false;
    }
  }
  return { found: null, complete };
}

/** Every member reachable from a type, for listing rather than lookup. */
export function membersDeep(idx, name, seen = new Set()) {
  if (seen.has(name)) return { members: new Map(), complete: true };
  seen.add(name);
  const blocks = blocksFor(idx, name);
  if (!blocks) return { members: new Map(), complete: false };

  const members = new Map();
  let complete = true;
  for (const b of blocks) {
    for (const [m, i] of membersOf(idx, b)) if (!members.has(m)) members.set(m, { line: i, owner: name });
    for (const p of followsOf(idx, b)) {
      const r = membersDeep(idx, p, seen);
      for (const [m, v] of r.members) if (!members.has(m)) members.set(m, v);
      if (!r.complete) complete = false;
    }
  }
  return { members, complete };
}

/**
 * The `@deprecated` tag on the JSDoc immediately above a line.
 *
 * v8 kept the v7 methods as deprecated shims: `Graphics.beginFill` is still
 * declared, right beside "@deprecated since 8.0.0 Use Graphics#fill instead".
 * So v7 code typechecks clean against v8 types, and existence alone cannot tell
 * a skill teaching v8 from a skill teaching v7.
 */
export function deprecationOf(idx, lineIdx) {
  const { lines } = idx;
  const end = lineIdx - 1;
  if (!/^\s*\*\//.test(lines[end] ?? '')) return null;
  let start = end;
  while (start > 0 && !/^\s*\/\*\*/.test(lines[start])) start -= 1;
  for (let i = start; i <= end; i += 1) {
    const m = /@deprecated\s*(.*)$/.exec(lines[i]);
    if (m) return m[1].replace(/\{@link ([^}]+)\}/g, '$1').trim() || 'sem nota';
  }
  return null;
}

/** The declaration a name should be described by: the class, if there is one. */
export function primaryDecl(idx, name) {
  const blocks = idx.decls.get(resolveName(idx, name));
  if (!blocks) return null;
  return blocks.find((b) => b.kind === 'class') ?? blocks[0];
}
