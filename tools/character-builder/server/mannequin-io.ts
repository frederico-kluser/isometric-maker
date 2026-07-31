/**
 * Export/import do manequim default — o "corpo-base pronto" do projeto.
 *
 * O manequim é o personagem mais caro do estúdio (sul por texto + 3 rotações +
 * 8 direções): refazê-lo do zero gasta dinheiro de verdade. Este módulo grava
 * esse resultado em disco (mannequin.json + 12 PNGs) e o restaura depois, para
 * que um studio novo — ou um studio quebrado — recupere o manequim sem chamar
 * a API. Exportar e importar NUNCA tocam na rede: só filesystem e studio.json.
 *
 * Layout do bundle, em disco e na memória:
 *
 *   mannequin.json              manifest (contrato abaixo)
 *   south.png                   sul ativa do wizard
 *   cardinal-east.png           3 cardeais derivados por /rotate
 *   cardinal-north.png
 *   cardinal-west.png
 *   directions/south.png        8 direções do create-character-with-8-directions
 *   directions/south-west.png   (ordem canônica de DIRECTIONS)
 *   ...                         até directions/south-east.png
 *
 * A validação do import roda INTEIRA antes de qualquer escrita — a mesma regra
 * do resto do estúdio: falhar cedo é grátis, falhar depois de gravar não.
 *
 * NENHUMA chamada de rede neste módulo — é filesystem e validação pura.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateSize } from '../../pixellab-pipeline/src/endpoints.ts';
import { validateImport } from '../src/import.ts';
import {
	DIRECTIONS,
	cardinalKey,
	directions8Key,
	southKey,
	type Cell,
	type Character,
	type Direction,
	type MannequinLock,
	type Silhouette,
	type Studio,
} from './model.ts';

// ------------------------------------------------------------------ tipos públicos

/** Manifesto do bundle — o cabeçalho de mannequin.json. */
export interface MannequinManifest {
	readonly version: 2;
	readonly description: string;
	readonly size: number;
	readonly seed: number;
	readonly silhouette: Silhouette;
	readonly lock: MannequinLock;
	readonly palette: readonly string[];
	readonly remoteId?: string;
	readonly exportedAt: string;
}

/** Um PNG do bundle. `name` usa '/' como separador (ex.: 'directions/north.png'). */
export interface MannequinBundleFile {
	readonly name: string;
	readonly b64: string;
}

/** O bundle completo: manifest + os 12 PNGs em base64. */
export interface MannequinBundle {
	readonly manifest: MannequinManifest;
	readonly files: readonly MannequinBundleFile[];
}

/**
 * O mínimo que este módulo precisa do armazenamento do studio. api.ts injeta a
 * implementação real (studio.json em disco); os testes injetam memória.
 */
export interface StudioStoreLike {
	load(): Promise<Studio>;
	save(s: Studio): Promise<void>;
}

export type MannequinImportSource =
	| { readonly kind: 'default'; readonly defaultDir: string }
	| { readonly kind: 'bundle'; readonly bundle: unknown };

// ------------------------------------------------------------------ constantes

/** Subpasta de assets/ que recebe os PNGs importados. */
export const MANNEQUIN_ASSETS_DIR = 'manequim';

const TOOL_ROOT = new URL('..', import.meta.url).pathname;
const DEFAULT_ASSETS_DIR = join(TOOL_ROOT, 'assets');

const MANIFEST_FILE = 'mannequin.json';
const SOUTH_FILE = 'south.png';

const CARDINAL_DIRECTIONS = ['east', 'north', 'west'] as const;
type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];

const SILHOUETTES: readonly string[] = [
	'humano-medio',
	'humano-corpulento',
	'humano-esguio',
	'quadrupede',
];

const cardinalFileName = (d: CardinalDirection): string => `cardinal-${d}.png`;
const directionFileName = (d: Direction): string => `directions/${d}.png`;

/** Os 12 arquivos do bundle, em ordem canônica e determinística. */
function expectedFileNames(): string[] {
	return [
		SOUTH_FILE,
		...CARDINAL_DIRECTIONS.map(cardinalFileName),
		...DIRECTIONS.map(directionFileName),
	];
}

// ------------------------------------------------------------------ helpers de path

/**
 * Células guardam paths no formato de URL ('/assets/escopo/arquivo.png',
 * convenção de frames.ts/api.ts). Resolve para o filesystem a partir do
 * diretório de assets.
 */
function resolveCellPath(assetsDir: string, cellPath: string): string {
	const rel = cellPath.replace(/^\/+/, '').replace(/^assets\//, '');
	return join(assetsDir, rel);
}

/** Escrita atômica: tmp + rename (mesmo idiom de api.ts ao salvar studio.json). */
async function writeAtomic(path: string, data: string): Promise<void> {
	const tmp = `${path}.tmp`;
	await writeFile(tmp, data);
	await rename(tmp, path);
}

// ------------------------------------------------------------------ export

/**
 * Exporta o manequim pronto para `targetDir` e devolve o bundle em memória
 * (mesmos dados, para download HTTP).
 *
 * Exige wizard.etapa 'pronto' e studio.lock presente — sem os dois, o manequim
 * ainda não é um corpo-base fechado e exportar seria congelar trabalho
 * incompleto.
 */
export async function exportMannequin(
	store: StudioStoreLike,
	targetDir: string,
	assetsDir: string = DEFAULT_ASSETS_DIR,
): Promise<MannequinBundle> {
	const studio = await store.load();

	const mannequin = studio.characters.find((c) => c.id === 'manequim');
	if (!mannequin) {
		throw new Error('exportação do manequim: personagem "manequim" não existe no studio');
	}
	if (mannequin.wizard?.etapa !== 'pronto') {
		throw new Error(
			`exportação do manequim exige wizard.etapa "pronto" ` +
				`(atual: ${mannequin.wizard?.etapa ?? 'ausente'})`,
		);
	}
	if (!studio.lock) {
		throw new Error(
			'exportação do manequim exige o lock do wizard travado (studio.lock ausente)',
		);
	}

	// --- resolve o path de cada PNG a partir das células do wizard ---

	const southCell = requireWizardCell(studio, southKey(mannequin.id));
	const southList = southCell.frames?.['south'] ?? [];
	const activeIdx =
		mannequin.wizard.activeSouth >= 0 && mannequin.wizard.activeSouth < southList.length
			? mannequin.wizard.activeSouth
			: southList.length - 1;
	const southPath = southList[activeIdx];
	if (southPath === undefined) {
		throw new Error(
			`exportação do manequim: célula "${southCell.key}" não tem frame da direção "south"`,
		);
	}

	const pending: { name: string; fsPath: string }[] = [
		{ name: SOUTH_FILE, fsPath: resolveCellPath(assetsDir, southPath) },
	];

	for (const d of CARDINAL_DIRECTIONS) {
		const cell = requireWizardCell(studio, cardinalKey(mannequin.id, d));
		const p = cell.frames?.[d]?.[0];
		if (p === undefined) {
			throw new Error(
				`exportação do manequim: célula "${cell.key}" não tem frame da direção "${d}"`,
			);
		}
		pending.push({ name: cardinalFileName(d), fsPath: resolveCellPath(assetsDir, p) });
	}

	const dir8Cell = requireWizardCell(studio, directions8Key(mannequin.id));
	for (const d of DIRECTIONS) {
		const p = dir8Cell.frames?.[d]?.[0];
		if (p === undefined) {
			throw new Error(
				`exportação do manequim: célula "${dir8Cell.key}" não tem frame da direção "${d}"`,
			);
		}
		pending.push({ name: directionFileName(d), fsPath: resolveCellPath(assetsDir, p) });
	}

	// --- lê os PNGs ---

	const files: MannequinBundleFile[] = [];
	for (const { name, fsPath } of pending) {
		let buf: Buffer;
		try {
			buf = await readFile(fsPath);
		} catch {
			throw new Error(
				`exportação do manequim: não foi possível ler "${fsPath}" (arquivo do bundle "${name}")`,
			);
		}
		files.push({ name, b64: buf.toString('base64') });
	}

	const manifest: MannequinManifest = {
		version: 2,
		description: mannequin.description,
		size: mannequin.size,
		seed: mannequin.seed,
		silhouette: mannequin.silhouette,
		lock: studio.lock,
		palette: [...studio.palette],
		...(mannequin.remoteId !== undefined ? { remoteId: mannequin.remoteId } : {}),
		exportedAt: new Date().toISOString(),
	};

	// --- grava: PNGs primeiro, manifest por último (é o marcador de conclusão) ---

	await mkdir(join(targetDir, 'directions'), { recursive: true });
	for (const f of files) {
		await writeFile(join(targetDir, f.name), Buffer.from(f.b64, 'base64'));
	}
	await writeAtomic(
		join(targetDir, MANIFEST_FILE),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);

	return { manifest, files };
}

/** Célula do wizard ausente ou não pronta é erro nomeado — nunca fallback mudo. */
function requireWizardCell(studio: Studio, key: string): Cell {
	const cell = studio.cells[key];
	if (!cell) {
		throw new Error(`exportação do manequim: célula do wizard ausente: "${key}"`);
	}
	if (cell.status !== 'pronto') {
		throw new Error(
			`exportação do manequim: célula "${key}" não está pronta (status: "${cell.status}")`,
		);
	}
	return cell;
}

// ------------------------------------------------------------------ validação do bundle

function asRecord(x: unknown): Record<string, unknown> | null {
	return x !== null && typeof x === 'object' && !Array.isArray(x)
		? (x as Record<string, unknown>)
		: null;
}

function invalid(reason: string): never {
	throw new Error(`bundle do manequim inválido: ${reason}`);
}

/**
 * Valida a ESTRUTURA de um bundle desconhecido e o devolve tipado, com os
 * arquivos reordenados na ordem canônica. Erros nomeiam o campo ofensor.
 * Não valida dimensões de PNG — isso é validateBundlePngs.
 */
export function parseMannequinBundle(raw: unknown): MannequinBundle {
	const obj = asRecord(raw);
	if (!obj) invalid('o bundle precisa ser um objeto');

	// --- manifest ---
	const m = asRecord(obj['manifest']);
	if (!m) invalid('campo "manifest" ausente ou não é um objeto');

	if (m['version'] !== 2) invalid(`manifest.version precisa ser 2 (recebido ${String(m['version'])})`);

	const description = m['description'];
	if (typeof description !== 'string') invalid('manifest.description precisa ser string');

	const size = m['size'];
	if (typeof size !== 'number' || !Number.isInteger(size)) {
		invalid(`manifest.size precisa ser inteiro (recebido ${String(size)})`);
	}
	// Faixa do /rotate no spec vendorizado: image_size 16–200 (endpoints.ts).
	// Na prática o wizard limita a 128 (create-character-with-8-directions);
	// os PNGs são validados contra o tamanho exato em validateBundlePngs.
	const sizeProblems = validateSize('rotate', { width: size as number, height: size as number });
	if (sizeProblems.length > 0) {
		invalid(`manifest.size=${String(size)} fora da faixa do /rotate: ${sizeProblems[0]}`);
	}

	const seed = m['seed'];
	if (typeof seed !== 'number' || !Number.isInteger(seed)) {
		invalid(`manifest.seed precisa ser inteiro (recebido ${String(seed)})`);
	}

	const silhouette = m['silhouette'];
	if (typeof silhouette !== 'string' || !SILHOUETTES.includes(silhouette)) {
		invalid(
			`manifest.silhouette desconhecida: ${String(silhouette)} ` +
				`(válidas: ${SILHOUETTES.join(', ')})`,
		);
	}

	const lock = asRecord(m['lock']);
	if (!lock) invalid('manifest.lock ausente ou não é um objeto');
	const frameCount = lock['frameCount'];
	if (frameCount !== 4 && frameCount !== 8 && frameCount !== 16) {
		invalid(
			`manifest.lock.frameCount precisa ser 4, 8 ou 16 (recebido ${String(frameCount)})`,
		);
	}
	const fps = lock['fps'];
	if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
		invalid(`manifest.lock.fps precisa ser número positivo (recebido ${String(fps)})`);
	}
	const lockSize = lock['size'];
	if (typeof lockSize !== 'number' || !Number.isInteger(lockSize)) {
		invalid(`manifest.lock.size precisa ser inteiro (recebido ${String(lockSize)})`);
	}

	const paletteRaw = m['palette'];
	if (!Array.isArray(paletteRaw) || paletteRaw.some((c) => typeof c !== 'string')) {
		invalid('manifest.palette precisa ser um array de strings');
	}
	if (paletteRaw.length === 0) invalid('manifest.palette não pode ser vazia');

	const remoteId = m['remoteId'];
	if (remoteId !== undefined && typeof remoteId !== 'string') {
		invalid('manifest.remoteId, quando presente, precisa ser string');
	}

	const exportedAt = m['exportedAt'];
	if (typeof exportedAt !== 'string') invalid('manifest.exportedAt precisa ser string');

	// --- files ---
	const filesRaw = obj['files'];
	if (!Array.isArray(filesRaw)) invalid('campo "files" ausente ou não é um array');

	const seen = new Set<string>();
	const byName = new Map<string, string>();
	for (const f of filesRaw) {
		const rec = asRecord(f);
		if (!rec) invalid('cada entrada de "files" precisa ser um objeto { name, b64 }');
		const name = rec['name'];
		const b64 = rec['b64'];
		if (typeof name !== 'string' || name.length === 0) {
			invalid('cada arquivo precisa de "name" string não vazio');
		}
		if (typeof b64 !== 'string' || b64.length === 0) {
			invalid(`arquivo "${name as string}": "b64" precisa ser string não vazio`);
		}
		if (seen.has(name as string)) invalid(`arquivo duplicado: "${name as string}"`);
		seen.add(name as string);
		byName.set(name as string, b64 as string);
	}

	const expected = expectedFileNames();
	for (const name of seen) {
		if (!expected.includes(name)) {
			invalid(`arquivo desconhecido: "${name}" (version 2 define exatamente 12 arquivos)`);
		}
	}
	for (const name of expected) {
		if (!seen.has(name)) {
			const dir = name.startsWith('directions/')
				? ` — direção "${name.slice('directions/'.length, -'.png'.length)}" é obrigatória`
				: '';
			invalid(`arquivo obrigatório ausente: "${name}"${dir}`);
		}
	}

	// Reordena na ordem canônica — as escritas do import não dependem da ordem
	// em que os arquivos vieram no JSON.
	const files: MannequinBundleFile[] = expected.map((name) => ({
		name,
		b64: byName.get(name)!,
	}));

	const manifest: MannequinManifest = {
		version: 2,
		description: description as string,
		size: size as number,
		seed: seed as number,
		silhouette: silhouette as Silhouette,
		lock: {
			frameCount: frameCount as 4 | 8 | 16,
			fps: fps as number,
			size: lockSize as number,
		},
		palette: [...(paletteRaw as string[])],
		...(remoteId !== undefined ? { remoteId: remoteId as string } : {}),
		exportedAt: exportedAt as string,
	};

	return { manifest, files };
}

/**
 * Valida os PNGs do bundle: cada um precisa ser PNG quadrado de exatamente
 * manifest.size × manifest.size. Reusa validateImport (assinatura + IHDR +
 * faixa) e completa com a checagem de dimensão exata, que validateImport
 * devolve em width/height.
 */
function validateBundlePngs(bundle: MannequinBundle): void {
	const { size } = bundle.manifest;
	for (const f of bundle.files) {
		const buf = Buffer.from(f.b64, 'base64');
		const ab = buf.buffer.slice(
			buf.byteOffset,
			buf.byteOffset + buf.byteLength,
		) as ArrayBuffer;
		// charHeight = 0 ("base no chão"): desliga a regra "altura informada ≤
		// altura da imagem", que não se aplica aqui — a igualdade exata com
		// manifest.size é verificada abaixo com as dimensões devolvidas.
		const r = validateImport(ab, 0);
		if (!r.ok) {
			invalid(`arquivo "${f.name}": ${r.error}`);
		} else if (r.width !== size || r.height !== size) {
			invalid(
				`arquivo "${f.name}": dimensões ${r.width}×${r.height}, ` +
					`esperado ${size}×${size} (manifest.size)`,
			);
		}
	}
}

// ------------------------------------------------------------------ readDefaultBundle

/**
 * Lê um bundle já gravado em disco (mannequin.json + os 12 PNGs).
 * Devolve null — silencioso — se o diretório não existir, o manifest estiver
 * malformado ou qualquer arquivo faltar/falhar na validação. Serve só para a
 * UI decidir se oferece o atalho "importar default do projeto".
 */
export async function readDefaultBundle(defaultDir: string): Promise<MannequinBundle | null> {
	try {
		const bundle = await slurpBundleDir(defaultDir);
		validateBundlePngs(bundle);
		return bundle;
	} catch {
		return null;
	}
}

/** Lê mannequin.json + PNGs de um diretório e devolve o bundle validado (lança). */
async function slurpBundleDir(dir: string): Promise<MannequinBundle> {
	const manifestRaw = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8')) as unknown;
	const files: MannequinBundleFile[] = [];
	for (const name of expectedFileNames()) {
		const buf = await readFile(join(dir, name));
		files.push({ name, b64: buf.toString('base64') });
	}
	return parseMannequinBundle({ manifest: manifestRaw, files });
}

// ------------------------------------------------------------------ import

/**
 * Importa um bundle de manequim para o studio.
 *
 * TODA a validação (schema, faixas do spec, dimensões de cada PNG, presença
 * das 8 direções + sul) acontece ANTES de gravar o primeiro byte. Só depois:
 *
 *   1. copia os 12 PNGs para assetsDir/manequim/;
 *   2. recria o personagem "manequim" (description/size/seed/silhouette do
 *      manifest, remoteId se houver, wizard.etapa 'pronto');
 *   3. grava studio.lock e studio.palette do manifest;
 *   4. registra as 5 células do wizard como 'pronto', apontando para os
 *      arquivos copiados.
 *
 * Importar duas vezes o mesmo bundle produz as mesmas escritas: o createdAt do
 * manequim anterior é preservado e as células não carregam timestamps.
 */
export async function importMannequin(
	store: StudioStoreLike,
	source: MannequinImportSource,
	assetsDir: string,
): Promise<void> {
	// ---------- fase 1: validação pura, zero escritas ----------
	let bundle: MannequinBundle;
	if (source.kind === 'default') {
		try {
			bundle = await slurpBundleDir(source.defaultDir);
		} catch (err) {
			throw new Error(
				`manequim default indisponível em "${source.defaultDir}": ` +
					(err instanceof Error ? err.message : String(err)),
			);
		}
	} else {
		bundle = parseMannequinBundle(source.bundle);
	}
	validateBundlePngs(bundle);

	const { manifest } = bundle;

	// ---------- fase 2: escritas ----------

	// 1. PNGs → assetsDir/manequim/
	const outDir = join(assetsDir, MANNEQUIN_ASSETS_DIR);
	await mkdir(join(outDir, 'directions'), { recursive: true });
	for (const f of bundle.files) {
		await writeFile(join(outDir, f.name), Buffer.from(f.b64, 'base64'));
	}

	// 2–4. studio
	const studio = await store.load();
	const previous = studio.characters.find((c) => c.id === 'manequim');

	const mannequin: Character = {
		id: 'manequim',
		label: 'Manequim base',
		silhouette: manifest.silhouette,
		description: manifest.description,
		size: manifest.size,
		seed: manifest.seed,
		// Sem histórico de prompts: o bundle carrega a arte, não as versões.
		wizard: { etapa: 'pronto', southVersions: [], activeSouth: 0 },
		...(manifest.remoteId !== undefined ? { remoteId: manifest.remoteId } : {}),
		// Preservar o createdAt é o que torna a reimportação byte-idêntica.
		createdAt: previous?.createdAt ?? new Date().toISOString(),
	};

	const url = (name: string): string => `/assets/${MANNEQUIN_ASSETS_DIR}/${name}`;

	const wizardCells: Record<string, Cell> = {
		[southKey('manequim')]: {
			key: southKey('manequim'),
			status: 'pronto',
			frames: { south: [url(SOUTH_FILE)] },
		},
	};
	for (const d of CARDINAL_DIRECTIONS) {
		const key = cardinalKey('manequim', d);
		wizardCells[key] = {
			key,
			status: 'pronto',
			frames: { [d]: [url(cardinalFileName(d))] },
		};
	}
	const dir8Frames: Record<string, string[]> = {};
	for (const d of DIRECTIONS) {
		dir8Frames[d] = [url(directionFileName(d))];
	}
	const dir8Key = directions8Key('manequim');
	wizardCells[dir8Key] = { key: dir8Key, status: 'pronto', frames: dir8Frames };

	const next: Studio = {
		...studio,
		lock: manifest.lock,
		palette: [...manifest.palette],
		characters: [mannequin, ...studio.characters.filter((c) => c.id !== 'manequim')],
		cells: { ...studio.cells, ...wizardCells },
	};

	await store.save(next);
}
