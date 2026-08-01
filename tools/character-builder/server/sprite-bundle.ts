/**
 * Bundles JSON de sprite — a ponte entre o Sprite Studio (laboratório v3), o
 * wizard e as telas de poses/itens.
 *
 * Dois formatos, distinguidos pelo campo `kind`:
 *
 *   sprite-lab-south          export do laboratório (client-side): a sul
 *                             escolhida entre N candidatos do create-character-v3
 *                             + a config que a gerou. Importar aplica a sul e
 *                             deixa o wizard na etapa 'direcoes8'.
 *   sprite-wizard-directions  export do wizard (server-side): sul + 8 direções
 *                             + config + remoteId. Importar entrega o
 *                             personagem pronto (etapa 'pronto').
 *
 * Qualquer outro `kind` — uma "config normal", por exemplo — é recusado com
 * erro nomeado: este módulo não adivinha formato.
 *
 * As mesmas regras de mannequin-io.ts valem aqui:
 *   - TODA a validação (schema + PNGs via validateImport + regras de lock e de
 *     alvo) roda ANTES de gravar o primeiro byte;
 *   - erros nomeiam o campo ofensor, em pt-BR;
 *   - reimportar o mesmo bundle no mesmo alvo produz as mesmas escritas
 *     (células sem timestamps; southVersions.at vem do exportedAt do bundle;
 *     createdAt do alvo 'existing' é preservado).
 *
 * NENHUMA chamada de rede neste módulo — é filesystem e validação pura.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateImport } from '../src/import.ts';
import {
	DIRECTIONS,
	VIEW_OPTIONS,
	TEMPLATE_OPTIONS,
	directions8Key,
	southKey,
	type Cell,
	type Character,
	type Direction,
	type MannequinLock,
	type Silhouette,
	type Studio,
	type TemplateOption,
	type ViewOption,
} from './model.ts';

// ------------------------------------------------------------------ tipos públicos

/** Um candidato da bancada v3: o frame `south` extraído de uma saída. */
export interface LabCandidate {
	readonly index: number;
	readonly seed: number;
	readonly b64: string;
}

/** Config do laboratório — todos os knobs do create-character-v3. */
export interface LabConfig {
	readonly description: string;
	readonly view: ViewOption;
	readonly size: number;
	readonly seed: number;
	readonly noBackground?: boolean;
	readonly outline?: string;
	readonly detail?: string;
	readonly enhancePrompt?: boolean;
	readonly templateId?: TemplateOption;
}

/** Bundle do laboratório (`kind: 'sprite-lab-south'`). */
export interface LabBundle {
	readonly kind: 'sprite-lab-south';
	readonly version: 1;
	readonly exportedAt: string;
	readonly config: LabConfig;
	readonly selected: LabCandidate;
	readonly candidates: readonly LabCandidate[];
}

/** Config do wizard — a base + o contrato de frames travado. */
export interface WizardConfig {
	readonly description: string;
	readonly view: ViewOption;
	readonly size: number;
	readonly seed: number;
	readonly silhouette: Silhouette;
	readonly templateId?: TemplateOption;
	readonly frameCount: 4 | 8 | 16;
	readonly fps: number;
}

/** Bundle do wizard (`kind: 'sprite-wizard-directions'`). */
export interface WizardBundle {
	readonly kind: 'sprite-wizard-directions';
	readonly version: 1;
	readonly exportedAt: string;
	readonly config: WizardConfig;
	readonly remoteId?: string;
	readonly south: { readonly b64: string };
	/** b64 por direção, nas 8 chaves canônicas de DIRECTIONS. */
	readonly directions: Record<Direction, string>;
}

export type SpriteBundle = LabBundle | WizardBundle;

/** Alvo do import: personagem existente (wizard dele é resetado) ou novo. */
export type SpriteBundleTarget =
	| { readonly kind: 'existing'; readonly characterId: string }
	| { readonly kind: 'new'; readonly label: string };

/**
 * O mínimo que este módulo precisa do armazenamento do studio. api.ts injeta a
 * implementação real (studio.json em disco); os testes injetam memória.
 */
export interface StudioStoreLike {
	load(): Promise<Studio>;
	save(s: Studio): Promise<void>;
}

// ------------------------------------------------------------------ constantes

const SILHOUETTES: readonly string[] = [
	'humano-medio',
	'humano-corpulento',
	'humano-esguio',
	'quadrupede',
];

/** Faixa do create-character-v3 no spec vendorizado (image_size 32–256). */
const SIZE_MIN = 32;
const SIZE_MAX = 256;

/**
 * slug de api.ts — COPIADO para que o id do personagem importado seja o mesmo
 * que ele teria se criado pela rota POST /api/characters. Manter em sync.
 */
const slug = (s: string): string =>
	s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '') || `id-${Date.now()}`;

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

/** Pasta da sul de um personagem: assets/wizard/<id>/ (convenção de mannequin.ts). */
function wizardDir(assetsDir: string, characterId: string): string {
	return join(assetsDir, 'wizard', characterId);
}

/**
 * Nome da pasta das 8 direções — a MESMA derivação de frames.ts
 * (`key.replace(/[^a-z0-9-]+/gi, '_')`), para que um import grave exatamente
 * onde uma geração real gravaria.
 */
function directions8DirName(characterId: string): string {
	return directions8Key(characterId).replace(/[^a-z0-9-]+/gi, '_');
}

/** Aceita b64 puro ou data URI (FileReader.readAsDataURL na UI manda "data:image/png;base64,…"). */
function stripDataUri(b64: string): string {
	return b64.replace(/^data:image\/\w+;base64,/, '');
}

// ------------------------------------------------------------------ validação do bundle

function asRecord(x: unknown): Record<string, unknown> | null {
	return x !== null && typeof x === 'object' && !Array.isArray(x)
		? (x as Record<string, unknown>)
		: null;
}

function invalid(reason: string): never {
	throw new Error(`bundle de sprite inválido: ${reason}`);
}

/** Valida um PNG em base64 (assinatura + IHDR + quadrado + faixa 32–256). */
function validatePngField(b64: string, field: string): void {
	const buf = Buffer.from(stripDataUri(b64), 'base64');
	const ab = buf.buffer.slice(
		buf.byteOffset,
		buf.byteOffset + buf.byteLength,
	) as ArrayBuffer;
	// charHeight = 0: desliga a regra "altura informada ≤ altura da imagem",
	// que não se aplica a bundles (mesmo idiom de mannequin-io.ts).
	const r = validateImport(ab, 0);
	if (!r.ok) invalid(`campo "${field}": ${r.error}`);
}

function requireString(v: unknown, field: string): string {
	if (typeof v !== 'string' || v.length === 0) {
		invalid(`campo "${field}" precisa ser string não vazia`);
	}
	return v as string;
}

function requireInt(v: unknown, field: string): number {
	if (typeof v !== 'number' || !Number.isInteger(v)) {
		invalid(`campo "${field}" precisa ser inteiro (recebido ${String(v)})`);
	}
	return v as number;
}

function requireSize(v: unknown, field: string): number {
	const size = requireInt(v, field);
	if (size < SIZE_MIN || size > SIZE_MAX) {
		invalid(
			`campo "${field}" precisa estar entre ${SIZE_MIN} e ${SIZE_MAX} ` +
				`(faixa do create-character-v3; recebido ${String(size)})`,
		);
	}
	return size;
}

function requireView(v: unknown, field: string): ViewOption {
	if (typeof v !== 'string' || !(VIEW_OPTIONS as readonly string[]).includes(v)) {
		invalid(
			`campo "${field}" desconhecido: ${String(v)} (válidas: ${VIEW_OPTIONS.join(', ')})`,
		);
	}
	return v as ViewOption;
}

function optionalTemplateId(v: unknown, field: string): TemplateOption | undefined {
	if (v === undefined) return undefined;
	if (typeof v !== 'string' || !(TEMPLATE_OPTIONS as readonly string[]).includes(v)) {
		invalid(
			`campo "${field}" desconhecido: ${String(v)} (válidos: ${TEMPLATE_OPTIONS.join(', ')})`,
		);
	}
	return v as TemplateOption;
}

function parseCandidate(raw: unknown, field: string): LabCandidate {
	const rec = asRecord(raw);
	if (!rec) invalid(`campo "${field}" precisa ser um objeto { index, seed, b64 }`);
	const index = requireInt(rec['index'], `${field}.index`);
	if (index < 0) invalid(`campo "${field}.index" precisa ser >= 0 (recebido ${String(index)})`);
	const seed = requireInt(rec['seed'], `${field}.seed`);
	const b64 = stripDataUri(requireString(rec['b64'], `${field}.b64`));
	validatePngField(b64, `${field}.b64`);
	return { index, seed, b64 };
}

function parseLabBundle(obj: Record<string, unknown>): LabBundle {
	const exportedAt = requireString(obj['exportedAt'], 'exportedAt');

	const c = asRecord(obj['config']);
	if (!c) invalid('campo "config" ausente ou não é um objeto');
	const noBackground = c['noBackground'];
	if (noBackground !== undefined && typeof noBackground !== 'boolean') {
		invalid('campo "config.noBackground", quando presente, precisa ser boolean');
	}
	const outline = c['outline'];
	if (outline !== undefined && typeof outline !== 'string') {
		invalid('campo "config.outline", quando presente, precisa ser string');
	}
	const detail = c['detail'];
	if (detail !== undefined && typeof detail !== 'string') {
		invalid('campo "config.detail", quando presente, precisa ser string');
	}
	const enhancePrompt = c['enhancePrompt'];
	if (enhancePrompt !== undefined && typeof enhancePrompt !== 'boolean') {
		invalid('campo "config.enhancePrompt", quando presente, precisa ser boolean');
	}
	const config: LabConfig = {
		description: requireString(c['description'], 'config.description'),
		view: requireView(c['view'], 'config.view'),
		size: requireSize(c['size'], 'config.size'),
		seed: requireInt(c['seed'], 'config.seed'),
		...(noBackground !== undefined ? { noBackground: noBackground as boolean } : {}),
		...(outline !== undefined ? { outline: outline as string } : {}),
		...(detail !== undefined ? { detail: detail as string } : {}),
		...(enhancePrompt !== undefined ? { enhancePrompt: enhancePrompt as boolean } : {}),
		...(c['templateId'] !== undefined
			? { templateId: optionalTemplateId(c['templateId'], 'config.templateId')! }
			: {}),
	};

	const candidatesRaw = obj['candidates'];
	if (!Array.isArray(candidatesRaw) || candidatesRaw.length === 0) {
		invalid('campo "candidates" precisa ser um array não vazio');
	}
	const seen = new Set<number>();
	const candidates: LabCandidate[] = candidatesRaw.map((raw, i) =>
		parseCandidate(raw, `candidates[${i}]`),
	);
	for (const cand of candidates) {
		if (seen.has(cand.index)) {
			invalid(`campo "candidates": index ${cand.index} duplicado`);
		}
		seen.add(cand.index);
	}

	const selected = parseCandidate(obj['selected'], 'selected');
	if (!seen.has(selected.index)) {
		invalid(
			`campo "selected.index" (${selected.index}) não existe em "candidates" ` +
				`(índices presentes: ${[...seen].join(', ')})`,
		);
	}

	return {
		kind: 'sprite-lab-south',
		version: 1,
		exportedAt,
		config,
		selected,
		candidates,
	};
}

function parseWizardBundle(obj: Record<string, unknown>): WizardBundle {
	const exportedAt = requireString(obj['exportedAt'], 'exportedAt');

	const c = asRecord(obj['config']);
	if (!c) invalid('campo "config" ausente ou não é um objeto');
	const silhouette = c['silhouette'];
	if (typeof silhouette !== 'string' || !SILHOUETTES.includes(silhouette)) {
		invalid(
			`campo "config.silhouette" desconhecida: ${String(silhouette)} ` +
				`(válidas: ${SILHOUETTES.join(', ')})`,
		);
	}
	const frameCount = c['frameCount'];
	if (frameCount !== 4 && frameCount !== 8 && frameCount !== 16) {
		invalid(
			`campo "config.frameCount" precisa ser 4, 8 ou 16 (recebido ${String(frameCount)})`,
		);
	}
	const fps = c['fps'];
	if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
		invalid(`campo "config.fps" precisa ser número positivo (recebido ${String(fps)})`);
	}
	const config: WizardConfig = {
		description: requireString(c['description'], 'config.description'),
		view: requireView(c['view'], 'config.view'),
		size: requireSize(c['size'], 'config.size'),
		seed: requireInt(c['seed'], 'config.seed'),
		silhouette: silhouette as Silhouette,
		...(c['templateId'] !== undefined
			? { templateId: optionalTemplateId(c['templateId'], 'config.templateId')! }
			: {}),
		frameCount: frameCount as 4 | 8 | 16,
		fps: fps as number,
	};

	const remoteId = obj['remoteId'];
	if (remoteId !== undefined && typeof remoteId !== 'string') {
		invalid('campo "remoteId", quando presente, precisa ser string');
	}

	const southRec = asRecord(obj['south']);
	if (!southRec) invalid('campo "south" ausente ou não é um objeto { b64 }');
	const southB64 = stripDataUri(requireString(southRec['b64'], 'south.b64'));
	validatePngField(southB64, 'south.b64');

	const dirsRaw = asRecord(obj['directions']);
	if (!dirsRaw) invalid('campo "directions" ausente ou não é um objeto');
	for (const k of Object.keys(dirsRaw)) {
		if (!(DIRECTIONS as readonly string[]).includes(k)) {
			invalid(
				`campo "directions" tem direção desconhecida: "${k}" ` +
					`(canônicas: ${DIRECTIONS.join(', ')})`,
			);
		}
	}
	// Reconstrói na ordem canônica — as escritas não dependem da ordem do JSON.
	const directions = {} as Record<Direction, string>;
	for (const d of DIRECTIONS) {
		const b64 = stripDataUri(requireString(dirsRaw[d], `directions["${d}"]`));
		validatePngField(b64, `directions["${d}"]`);
		directions[d] = b64;
	}

	return {
		kind: 'sprite-wizard-directions',
		version: 1,
		exportedAt,
		config,
		...(remoteId !== undefined ? { remoteId: remoteId as string } : {}),
		south: { b64: southB64 },
		directions,
	};
}

/**
 * Valida um bundle desconhecido e o devolve tipado. O `kind` decide o formato;
 * qualquer outro valor (uma "config normal", por exemplo) é erro nomeado.
 * Estrutura E PNGs são validados aqui — depois do parse, o bundle é confiável.
 */
export function parseSpriteBundle(raw: unknown): SpriteBundle {
	const obj = asRecord(raw);
	if (!obj) invalid('o bundle precisa ser um objeto');

	const kind = obj['kind'];
	if (typeof kind !== 'string') {
		invalid('campo "kind" ausente ou não é string — este import aceita só ' +
			'"sprite-lab-south" e "sprite-wizard-directions"');
	}
	if (kind !== 'sprite-lab-south' && kind !== 'sprite-wizard-directions') {
		invalid(
			`campo "kind" com valor "${kind}" não é um bundle importável — ` +
				'aceita só "sprite-lab-south" e "sprite-wizard-directions" ' +
				'(uma config normal não é um bundle)',
		);
	}
	if (obj['version'] !== 1) {
		invalid(`campo "version" precisa ser 1 (recebido ${String(obj['version'])})`);
	}

	return kind === 'sprite-lab-south' ? parseLabBundle(obj) : parseWizardBundle(obj);
}

// ------------------------------------------------------------------ export do wizard

/**
 * Monta o bundle do wizard de um personagem, lendo os PNGs das células
 * southKey/directions8Key (a sul ativa é wizard.activeSouth).
 *
 * Exige wizard.etapa 'pronto' e studio.lock presente — sem os dois o
 * personagem ainda não é uma base fechada e exportar seria congelar trabalho
 * incompleto (mesma regra do export do manequim).
 */
export async function exportWizardBundle(
	store: StudioStoreLike,
	characterId: string,
	assetsDir: string,
): Promise<WizardBundle> {
	const studio = await store.load();

	const character = studio.characters.find((c) => c.id === characterId);
	if (!character) {
		throw new Error(`exportação do wizard: personagem "${characterId}" não existe no studio`);
	}
	if (character.wizard?.etapa !== 'pronto') {
		throw new Error(
			`exportação do wizard de "${characterId}" exige wizard.etapa "pronto" ` +
				`(atual: ${character.wizard?.etapa ?? 'ausente'})`,
		);
	}
	const lock = studio.lock;
	if (!lock) {
		throw new Error(
			'exportação do wizard exige o lock do wizard travado (studio.lock ausente)',
		);
	}

	// --- sul ativa ---
	const sKey = southKey(characterId);
	const southCell = requireReadyCell(studio, sKey);
	const southList = southCell.frames?.['south'] ?? [];
	const activeIdx =
		character.wizard.activeSouth >= 0 && character.wizard.activeSouth < southList.length
			? character.wizard.activeSouth
			: southList.length - 1;
	const southPath = southList[activeIdx];
	if (southPath === undefined) {
		throw new Error(
			`exportação do wizard: célula "${sKey}" não tem frame da direção "south"`,
		);
	}

	// --- 8 direções ---
	const dKey = directions8Key(characterId);
	const dir8Cell = requireReadyCell(studio, dKey);
	const directionPaths = {} as Record<Direction, string>;
	for (const d of DIRECTIONS) {
		const p = dir8Cell.frames?.[d]?.[0];
		if (p === undefined) {
			throw new Error(
				`exportação do wizard: célula "${dKey}" não tem frame da direção "${d}"`,
			);
		}
		directionPaths[d] = p;
	}

	// --- lê os PNGs ---
	const southB64 = await readPngB64(assetsDir, southPath, 'south.b64');
	const directions = {} as Record<Direction, string>;
	for (const d of DIRECTIONS) {
		directions[d] = await readPngB64(assetsDir, directionPaths[d]!, `directions["${d}"]`);
	}

	const config: WizardConfig = {
		description: character.description,
		view: lock.view ?? 'low top-down',
		size: character.size,
		seed: character.seed,
		silhouette: character.silhouette,
		...(lock.templateId !== undefined ? { templateId: lock.templateId } : {}),
		frameCount: lock.frameCount,
		fps: lock.fps,
	};

	return {
		kind: 'sprite-wizard-directions',
		version: 1,
		exportedAt: new Date().toISOString(),
		config,
		...(character.remoteId !== undefined ? { remoteId: character.remoteId } : {}),
		south: { b64: southB64 },
		directions,
	};
}

/** Célula do wizard ausente ou não pronta é erro nomeado — nunca fallback mudo. */
function requireReadyCell(studio: Studio, key: string): Cell {
	const cell = studio.cells[key];
	if (!cell) {
		throw new Error(`exportação do wizard: célula do wizard ausente: "${key}"`);
	}
	if (cell.status !== 'pronto') {
		throw new Error(
			`exportação do wizard: célula "${key}" não está pronta (status: "${cell.status}")`,
		);
	}
	return cell;
}

async function readPngB64(assetsDir: string, cellPath: string, field: string): Promise<string> {
	const fsPath = resolveCellPath(assetsDir, cellPath);
	try {
		return (await readFile(fsPath)).toString('base64');
	} catch {
		throw new Error(
			`exportação do wizard: não foi possível ler "${fsPath}" (campo "${field}")`,
		);
	}
}

// ------------------------------------------------------------------ import

/**
 * Importa um bundle (já validado por parseSpriteBundle) para o studio.
 *
 * Validação de alvo e de lock ANTES de qualquer escrita; só depois:
 *
 *   1. grava a sul como south-v0.png em assets/wizard/<id>/ — importar sempre
 *      reinicia o ciclo da sul, por isso o arquivo é sempre v0;
 *   2. (bundle do wizard) grava os frames das 8 direções na mesma pasta em
 *      que generateDirections8 os gravaria;
 *   3. aplica o personagem (description/size/seed do bundle; remoteId REMOVIDO
 *      num import de lab — a sul mudou, o id remoto aponta para arte velha) e
 *      as células do wizard;
 *   4. lock: ausente → trava {frameCount: bundle.frameCount ?? 8,
 *      fps: bundle.fps ?? 8, size: bundle.size}; presente → size precisa
 *      bater, senão erro.
 */
export async function importSpriteBundle(
	store: StudioStoreLike,
	bundle: SpriteBundle,
	target: SpriteBundleTarget,
	assetsDir: string,
): Promise<{ characterId: string }> {
	// ---------- fase 1: validação pura, zero escritas ----------
	const studio = await store.load();

	const isWizard = bundle.kind === 'sprite-wizard-directions';
	const { config } = bundle;
	const frameCount = isWizard ? bundle.config.frameCount : 8;
	const fps = isWizard ? bundle.config.fps : 8;
	const remoteId = isWizard ? bundle.remoteId : undefined;

	let characterId: string;
	let previous: Character | undefined;
	let label: string;
	let silhouette: Silhouette;

	if (target.kind === 'existing') {
		characterId = target.characterId;
		previous = studio.characters.find((c) => c.id === characterId);
		if (!previous) {
			throw new Error(
				`importação de bundle: personagem "${characterId}" não encontrado`,
			);
		}
		if (!previous.wizard) {
			throw new Error(
				`importação de bundle: o personagem "${characterId}" não está no fluxo ` +
					'do wizard (sem wizard state)',
			);
		}
		label = previous.label;
		silhouette = previous.silhouette;
	} else {
		if (typeof target.label !== 'string' || target.label.trim() === '') {
			throw new Error('importação de bundle: label do novo personagem é obrigatório');
		}
		characterId = slug(target.label);
		if (studio.characters.some((c) => c.id === characterId)) {
			throw new Error(
				`já existe um personagem com o id "${characterId}" — escolha outro nome`,
			);
		}
		label = target.label;
		// Silhueta: a do bundle (wizard a carrega) ou a do manequim — é o corpo
		// de referência, e peça só vale dentro da mesma silhueta.
		const mannequin = studio.characters.find((c) => c.id === 'manequim');
		silhouette = isWizard
			? bundle.config.silhouette
			: (mannequin?.silhouette ?? 'humano-medio');
	}

	// Lock: ausente → o bundle trava; presente → o size precisa bater.
	let lock = studio.lock;
	if (lock) {
		if (lock.size !== config.size) {
			throw new Error(
				`importação de bundle: o size do bundle (${config.size}) não bate com o ` +
					`lock do studio (${lock.size}) — o lock é imutável depois de travado`,
			);
		}
	} else {
		lock = { frameCount, fps, size: config.size } satisfies MannequinLock;
	}

	// ---------- fase 2: PNGs em disco ----------
	const southB64 = isWizard ? bundle.south.b64 : bundle.selected.b64;

	await mkdir(wizardDir(assetsDir, characterId), { recursive: true });
	await writeFile(
		join(wizardDir(assetsDir, characterId), 'south-v0.png'),
		Buffer.from(southB64, 'base64'),
	);

	const safe = directions8DirName(characterId);
	if (isWizard) {
		const outDir = join(assetsDir, 'wizard', safe);
		await mkdir(outDir, { recursive: true });
		for (const d of DIRECTIONS) {
			await writeFile(
				join(outDir, `${d}-00.png`),
				Buffer.from(bundle.directions[d], 'base64'),
			);
		}
	}

	// ---------- fase 3: studio ----------
	// O `at` vem do exportedAt do bundle (não de new Date()): é o que torna a
	// reimportação byte-idêntica.
	const character: Character = {
		id: characterId,
		label,
		silhouette,
		description: config.description,
		size: config.size,
		seed: config.seed,
		wizard: {
			etapa: isWizard ? 'pronto' : 'direcoes8',
			southVersions: [{ prompt: config.description, at: bundle.exportedAt }],
			activeSouth: 0,
		},
		...(remoteId !== undefined ? { remoteId } : {}),
		// Preservar o createdAt do alvo existente é parte da idempotência.
		createdAt: previous?.createdAt ?? new Date().toISOString(),
	};

	const sKey = southKey(characterId);
	const cells: Record<string, Cell> = {
		...studio.cells,
		[sKey]: {
			key: sKey,
			status: 'pronto',
			frames: { south: [`/assets/wizard/${characterId}/south-v0.png`] },
		},
	};
	const dKey = directions8Key(characterId);
	if (isWizard) {
		const frames: Record<string, string[]> = {};
		for (const d of DIRECTIONS) {
			frames[d] = [`/assets/wizard/${safe}/${d}-00.png`];
		}
		cells[dKey] = { key: dKey, status: 'pronto', frames };
	} else {
		// A sul mudou: as 8 direções antigas são de outra arte. Sem apagar, a
		// célula 'pronto' faria generateDirections8 pular a regeneração.
		delete cells[dKey];
	}

	const characters =
		target.kind === 'existing'
			? studio.characters.map((c) => (c.id === characterId ? character : c))
			: [...studio.characters, character];

	const next: Studio = {
		...studio,
		lock,
		characters,
		cells,
	};

	await store.save(next);
	return { characterId };
}
