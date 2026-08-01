/**
 * Local API for the character builder, mounted as Vite middleware.
 *
 * Two responsibilities that must not leak into the browser:
 *   1. The PixelLab token. Every call to the API goes through here.
 *   2. Long jobs. Generation takes 2-5 minutes; the browser polls this server,
 *      which owns the job registry and survives a page reload.
 *
 * v3 (2026-07-31): o wizard do manequim migrou para create-character-v3 —
 * a sul vai como reference_image e o modelo rotaciona sozinho; o passo de
 * cardeais foi removido. Estas rotas só fazem a fiação: validam o pedido,
 * escolhem as chaves canônicas de célula e disparam o módulo certo.
 *
 * Política de células (a UI lê o status por elas):
 *   - As rotas do wizard NÃO pré-marcam célula 'gerando': a idempotência de
 *     mannequin.ts lê o status 'pronto' da célula, e sobrescrevê-lo faria uma
 *     geração já paga sair de novo. O andamento chega à UI pelo registro de
 *     jobs, exposto em /api/studio.
 *   - O MÓDULO escreve as células de sucesso (mannequin.ts grava as três
 *     cardeais uma a uma; generatePose/generateWardrobe gravam a sua).
 *   - O spawn escreve célula só na FALHA, e só nas chaves canônicas que não
 *     estão 'pronto': uma cardeal concluída sobrevive à falha da irmã, e a
 *     re-execução refaz só o que faltou.
 *   - Poses e guarda-roupa pré-marcam 'gerando' SÓ quando a célula não está
 *     'pronto': a rota responde 200 sem spawn numa célula pronta, e
 *     generatePose/generateWardrobe releem a célula no início e retornam sem
 *     chamar a API — 'pronto' é terminal de ponta a ponta, como no wizard.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PixelLabClient, pollJob } from "../../pixellab-pipeline/src/api.ts";
import {
	generateSouthFromText,
	editSouth,
	undoSouth,
	generateDirections8,
	type StudioStore,
	type WizardOpts,
} from "./mannequin.ts";
import { exportMannequin, importMannequin } from "./mannequin-io.ts";
import {
	runRotateLab,
	RotateLabValidationError,
	type RotateLabInput,
} from "./rotate-lab.ts";
import {
	runSpriteLab,
	readSpriteLabResult,
	spriteLabHash,
	validateSpriteLabConfig,
	SpriteLabValidationError,
	type SpriteLabConfig,
} from "./sprite-lab.ts";
import {
	runWorldBlock,
	readWorldBlockResult,
	listWorldBlocks,
	worldBlockHash,
	validateWorldBlockConfig,
	WorldBlockValidationError,
	type WorldBlockConfig,
} from "./world-block.ts";
import {
	exportWizardBundle,
	importSpriteBundle,
	parseSpriteBundle,
} from "./sprite-bundle.ts";
import {
	DIRECTIONS,
	DETAIL_OPTIONS,
	OUTLINE_OPTIONS,
	TEMPLATE_OPTIONS,
	VIEW_OPTIONS,
	cellKey,
	directions8Key,
	seedStudio,
	southKey,
	wardrobeKey,
	type Character,
	type DetailOption,
	type Keypoint,
	type MannequinLock,
	type OutlineOption,
	type Pose,
	type PoseKind,
	type Silhouette,
	type Studio,
	type TemplateAnimation,
	type TemplateOption,
	type ViewOption,
	type WardrobeItem,
} from "./model.ts";

const ROOT = new URL("..", import.meta.url).pathname;
// Test seam: lets server/api.test.ts point the state at a tmpdir. Never set
// in normal use — the default is the tool's own studio.json.
const STUDIO_JSON =
	process.env["CHARACTER_BUILDER_STUDIO_JSON"] ?? join(ROOT, "studio.json");
// Test seam, same idea: points the assets root (wizard PNGs, ledger, frames)
// at a tmpdir so tests never touch the real assets/ directory.
const ASSETS =
	process.env["CHARACTER_BUILDER_ASSETS_DIR"] ?? join(ROOT, "assets");
const LEDGER_PATH = join(ASSETS, "ledger.ndjson");
/** Onde o bundle default do projeto mora (mannequin.json + 12 PNGs). */
const MANNEQUIN_DEFAULT_DIR = join(
	ROOT,
	"../../packages/game-assets/manequim",
);

const SILHOUETTES: readonly Silhouette[] = [
	"humano-medio",
	"humano-corpulento",
	"humano-esguio",
	"quadrupede",
];

// ---------------------------------------------------------------- persistence

let cache: Studio | undefined;
/** Carga em voo compartilhada enquanto o cache está frio (ver load). */
let loadPromise: Promise<Studio> | undefined;
/** Fila de escrita: um writeFile+rename por vez (ver save). */
let writeQueue: Promise<void> = Promise.resolve();

async function loadFromDisk(): Promise<Studio> {
	try {
		cache = JSON.parse(await readFile(STUDIO_JSON, "utf8")) as Studio;
	} catch {
		cache = seedStudio();
		await save(cache);
	}
	return cache;
}

async function load(): Promise<Studio> {
	if (cache) return cache;
	// Concorrência (botões "Gerar todas"): N spawns simultâneos sobre cache
	// frio dividem UMA carga. Sem isto, cada spawn parseava o arquivo por
	// conta e ficava com uma referência DIVERGENTE do Studio — o save do
	// segundo sobrescrevia o do primeiro e células se perdiam. Com a
	// referência única, load→mutate→save acontece sobre o objeto comum.
	loadPromise ??= loadFromDisk().finally(() => {
		loadPromise = undefined;
	});
	return loadPromise;
}

async function writeStudioFile(s: Studio): Promise<void> {
	await mkdir(dirname(STUDIO_JSON), { recursive: true });
	// tmp único por execução: dois saves nunca dividem o mesmo caminho
	// temporário (defesa em profundidade — a fila já serializa).
	const tmp = `${STUDIO_JSON}.${randomBytes(4).toString("hex")}.tmp`;
	await writeFile(tmp, `${JSON.stringify(s, null, 2)}\n`);
	const { rename } = await import("node:fs/promises");
	await rename(tmp, STUDIO_JSON);
}

async function save(s: Studio): Promise<void> {
	cache = s;
	// Fila de escrita: serializa writeFile+rename. Dois saves concorrentes
	// sobre o MESMO tmp podiam intercalar bytes e misturar dois JSONs — e o
	// load seguinte, achando JSON inválido, caía no catch e RESETAVA o
	// estúdio para o seed. A fila executa na ordem de chegada, então o
	// arquivo final é sempre o save mais recente. A fila nunca trava: uma
	// falha é devolvida ao chamador mas a corrente segue com catch.
	const run = writeQueue.then(() => writeStudioFile(s));
	writeQueue = run.catch(() => {});
	return run;
}

/** A implementação de StudioStore que os módulos do wizard/export recebem. */
const store: StudioStore = { load, save };

// ---------------------------------------------------------------- job registry

interface Job {
	readonly key: string;
	readonly label: string;
	status: "gerando" | "pronto" | "falhou";
	message?: string;
	startedAt: number;
}

const jobs = new Map<string, Job>();

function client(): PixelLabClient {
	const secret = process.env["PIXELLAB_SECRET"];
	if (!secret) {
		throw new Error(
			"PIXELLAB_SECRET não está definido. Exporte o token antes de subir o estúdio — " +
				"ele fica só no servidor e nunca chega ao navegador.",
		);
	}
	return new PixelLabClient(secret);
}

/** Pulls every PNG out of a response, whatever shape it arrived in. */
function extractImages(payload: unknown): string[] {
	const out: string[] = [];
	const walk = (n: unknown): void => {
		if (typeof n === "string") {
			if (n.startsWith("data:image/"))
				out.push(n.replace(/^data:image\/\w+;base64,/, ""));
			else if (/^iVBORw0KGgo/.test(n) && n.length > 256) out.push(n);
			return;
		}
		if (Array.isArray(n)) {
			n.forEach(walk);
			return;
		}
		if (n && typeof n === "object") {
			for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
				if (k === "usage") continue;
				walk(v);
			}
		}
	};
	walk(payload);
	return out;
}

async function writeFrames(
	scope: string,
	key: string,
	images: string[],
): Promise<Record<string, string[]>> {
	const safe = key.replace(/[^a-z0-9-]+/gi, "_");
	const dir = join(ASSETS, scope, safe);
	await mkdir(dir, { recursive: true });

	const frames: Record<string, string[]> = {};
	// The 8-rotation endpoints return frames in canonical direction order. When a
	// pose has several frames per direction they arrive grouped the same way, so
	// slicing by direction index is the correct read of the payload.
	const perDir = Math.max(1, Math.floor(images.length / DIRECTIONS.length));
	for (const [di, dir8] of DIRECTIONS.entries()) {
		const list: string[] = [];
		for (let f = 0; f < perDir; f += 1) {
			const idx = di * perDir + f;
			const b64 = images[idx];
			if (!b64) continue;
			const name = `${dir8}-${String(f).padStart(2, "0")}.png`;
			await writeFile(join(dir, name), Buffer.from(b64, "base64"));
			list.push(`/assets/${scope}/${safe}/${name}`);
		}
		if (list.length > 0) frames[dir8] = list;
	}
	return frames;
}

// ---------------------------------------------------------------- wizard plumbing

/**
 * Opções comuns dos módulos do wizard: assets, ledger e log no stdout do
 * servidor. `referenceB64` é o PNG da sul do manequim — presente só para
 * personagens derivados (ver mannequinSouthB64); vai como color_image nos
 * endpoints que o aceitam, prendendo a paleta do derivado à do manequim.
 */
function wizardOpts(referenceB64?: string): WizardOpts {
	return {
		assetsDir: ASSETS,
		ledgerPath: LEDGER_PATH,
		onLog: (m) => console.log(m),
		...(referenceB64 !== undefined
			? { reference: { colorImageB64: referenceB64 } }
			: {}),
	};
}

/**
 * PNG da sul ativa do manequim, lido do disco a partir da célula — funciona
 * tanto para o manequim gerado no wizard (/assets/wizard/manequim/…) quanto
 * para o importado do bundle default (/assets/manequim/south.png).
 *
 * Ausência NÃO é erro: devolve undefined e avisa no log. Um derivado gerado
 * sem referência só perde a paleta travada; bloquear a geração por um arquivo
 * recuperável seria pior.
 */
async function mannequinSouthB64(s: Studio): Promise<string | undefined> {
	const cell = s.cells[southKey("manequim")];
	if (cell?.status !== "pronto") return undefined;
	const pub = cell.frames?.["south"]?.[0];
	if (pub === undefined) return undefined;
	const fsPath = join(ASSETS, pub.replace(/^\/+/, "").replace(/^assets\//, ""));
	try {
		return (await readFile(fsPath)).toString("base64");
	} catch {
		console.log(
			`[wizard] sul do manequim não encontrada no disco (${fsPath}) — ` +
				"o derivado segue sem color_image.",
		);
		return undefined;
	}
}

// ---------------------------------------------------------------- generation

/**
 * Uma pose, animada sobre um personagem que concluiu o wizard (remoteId
 * presente). frame_count vem do lock — nunca do cliente nem da pose.
 *
 * Célula 'pronto' é terminal: retorna sem chamar a API. A UI trata 'pronto'
 * como final, mas o servidor é a trava de verdade — um clique duplo não pode
 * cobrar de novo (mesma leitura idempotente que mannequin.ts faz).
 */
async function generatePose(
	character: Character,
	pose: Pose,
	lock: MannequinLock,
): Promise<void> {
	const key = cellKey(character.id, pose.id);
	const s = await load();
	if (s.cells[key]?.status === "pronto") return;
	if (!character.remoteId) {
		throw new Error(
			"conclua o wizard do personagem primeiro — a pose se apoia no " +
				"personagem remoto criado nas 8 direções",
		);
	}
	const c = client();

	const body: Record<string, unknown> = {
		character_id: character.remoteId,
		animation_name: pose.id,
		seed: character.seed,
		// Without this the API animates only the south direction in custom mode.
		directions: [...DIRECTIONS],
	};

	if (pose.kind === "template") {
		// 1 generation per direction — by far the cheapest path.
		body["mode"] = "template";
		body["template_animation_id"] = pose.templateId;
	} else if (pose.kind === "action") {
		// Free text. Costs ~1 gen/direction up to 96px and scales with size above.
		body["mode"] = "v3";
		body["action_description"] = pose.action;
		body["frame_count"] = lock.frameCount;
	} else {
		throw new Error(
			"pose de esqueleto é gerada pelo endpoint animate-with-skeleton, não por aqui",
		);
	}

	const res = await c.submit<Record<string, unknown>>(
		"animate-character",
		body,
	);
	// Animation queues one job PER DIRECTION and returns a list of ids.
	const ids = collectJobIds(res.data);
	if (ids.length === 0) throw new Error("a API não devolveu nenhum job id");

	// Poll das direções EM PARALELO: eram sequenciais, e cada direção leva
	// minutos — a espera total era a soma dos tempos, agora é o máximo.
	const polledAll = await Promise.all(
		ids.map((id) => pollJob(c, id, { timeoutMs: 900_000 })),
	);
	const images: string[] = [];
	for (const polled of polledAll) {
		if (!polled.ok) continue;
		images.push(...extractImages(polled.job.last_response ?? polled.job));
	}
	if (images.length === 0) throw new Error("nenhuma direção retornou imagem");

	const frames = await writeFrames("poses", key, images);
	const cur = await load();
	cur.cells[key] = {
		key,
		status: "pronto",
		frames,
		updatedAt: new Date().toISOString(),
	};
	await save(cur);
}

/** Equipment, as a character state derived from a finished body. */
async function generateWardrobe(
	character: Character,
	item: WardrobeItem,
): Promise<void> {
	const key = wardrobeKey(character.id, item.id);
	// Idempotency lock, same as generatePose: 'pronto' is terminal, return
	// without calling the API — a double-click must not be charged twice.
	const s = await load();
	if (s.cells[key]?.status === "pronto") return;
	if (!character.remoteId) {
		throw new Error(
			"conclua o wizard do personagem primeiro — a peça se apoia no " +
				"personagem remoto criado nas 8 direções",
		);
	}
	// Refuse before spending: a garment authored for one silhouette will not fit
	// another, and the API will happily charge for the attempt.
	if (item.silhouette !== character.silhouette) {
		throw new Error(
			`"${item.label}" foi feita para a silhueta ${item.silhouette}, e ${character.label} ` +
				`é ${character.silhouette}. Peça só vale dentro da mesma silhueta — gere uma variante.`,
		);
	}
	const c = client();

	const res = await c.submit<{
		background_job_id?: string;
		character_id?: string;
	}>("create-character-state", {
		character_id: character.remoteId,
		edit_description: item.editDescription,
		seed: item.seed,
		no_background: true,
		// Snapping to the source palette is what stops each piece drifting in colour.
		use_color_palette_from_reference: item.keepPalette,
	});
	const jobId = res.data?.background_job_id;
	if (!jobId) throw new Error("a API não devolveu background_job_id");

	const polled = await pollJob(c, jobId, { timeoutMs: 900_000 });
	if (!polled.ok)
		throw new Error(
			polled.reason === "timeout"
				? "tempo esgotado"
				: (polled.detail ?? "falhou"),
		);

	const images = extractImages(polled.job.last_response ?? polled.job);
	if (images.length === 0) throw new Error("resposta sem imagem");

	const frames = await writeFrames("wardrobe", key, images);
	const cur = await load();
	const groupId = (
		polled.job.last_response as { group_id?: string } | undefined
	)?.group_id;
	cur.cells[key] = {
		key,
		status: "pronto",
		frames,
		updatedAt: new Date().toISOString(),
		...(res.data?.character_id ? { remoteId: res.data.character_id } : {}),
		...(groupId ? { groupId } : {}),
	};
	await save(cur);
}

function collectJobIds(payload: unknown): string[] {
	const ids: string[] = [];
	const walk = (n: unknown): void => {
		if (Array.isArray(n)) {
			n.forEach(walk);
			return;
		}
		if (n && typeof n === "object") {
			for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
				if (/job_id$/i.test(k) && typeof v === "string") ids.push(v);
				else walk(v);
			}
		}
	};
	walk(payload);
	return [...new Set(ids)];
}

/**
 * Runs a generation in the background and records its outcome.
 *
 * `cellKeys` são as células canônicas que a UI lê (southKey, cardinalKey×3,
 * directions8Key, cellKey de pose, wardrobeKey). O MÓDULO escreve as células
 * de sucesso; o spawn escreve só na falha, e só nas que não estão 'pronto' —
 * o progresso parcial (uma cardeal concluída, por exemplo) sobrevive à falha
 * da irmã, e a re-execução refaz só o que faltou.
 */
function spawn(
	key: string,
	label: string,
	work: () => Promise<void>,
	cellKeys: readonly string[] = [key],
): void {
	if (jobs.get(key)?.status === "gerando") {
		console.warn(`spawn: job "${key}" já está gerando — submissão duplicada ignorada`);
		return;
	}
	jobs.set(key, { key, label, status: "gerando", startedAt: Date.now() });
	void (async () => {
		try {
			await work();
			jobs.set(key, { key, label, status: "pronto", startedAt: Date.now() });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			jobs.set(key, {
				key,
				label,
				status: "falhou",
				message,
				startedAt: Date.now(),
			});
			const s = await load();
			for (const ck of cellKeys) {
				if (s.cells[ck]?.status === "pronto") continue;
				s.cells[ck] = {
					key: ck,
					status: "falhou",
					error: message,
					updatedAt: new Date().toISOString(),
				};
			}
			await save(s);
		}
	})();
}

// ---------------------------------------------------------------- http

const json = (res: ServerResponse, code: number, body: unknown): void => {
	res.statusCode = code;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
};

/** 400 com mensagem em pt-BR — erro do pedido, nunca do servidor. */
const badRequest = (res: ServerResponse, error: string): void =>
	json(res, 400, { error });

async function readBody<T>(req: IncomingMessage): Promise<T> {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

const slug = (s: string): string =>
	s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "") || `id-${Date.now()}`;

/** Valida characterId + existência + wizard state das rotas do wizard. */
function resolveWizardCharacter(
	s: Studio,
	res: ServerResponse,
	characterId: string,
): Character | null {
	const ch = s.characters.find((c) => c.id === characterId);
	if (!ch) {
		json(res, 404, { error: `personagem "${characterId}" não encontrado` });
		return null;
	}
	if (!ch.wizard) {
		badRequest(res, `o personagem "${ch.id}" não está no fluxo do wizard`);
		return null;
	}
	return ch;
}

/** Extensões que a rota de assets serve, com o content-type de cada uma. */
const ASSET_TYPES: Readonly<Record<string, string>> = {
	".png": "image/png",
	".json": "application/json; charset=utf-8",
};

/**
 * Serve um arquivo gerado de dentro de `assets/`, lendo do disco a CADA
 * requisição.
 *
 * O `publicDir` do Vite não serve para isto: ele monta a listagem de arquivos
 * no boot, e todo asset gerado DEPOIS disso cai no fallback do index.html —
 * o navegador recebe HTML com status 200 no lugar do PNG e a miniatura
 * aparece quebrada. Verificado em 2026-08-01: blocos gravados antes do boot
 * respondiam `image/png`, e os gravados depois, `text/html`.
 *
 * Como aqui o arquivo é lido na hora, um asset recém-gerado aparece sem
 * reiniciar nada — que é o comportamento óbvio para uma ferramenta cujo
 * trabalho É gerar arquivos.
 */
async function serveGeneratedAsset(
	pathname: string,
	res: ServerResponse,
): Promise<boolean> {
	// `..` nunca chega ao join: o caminho é normalizado e qualquer salto para
	// fora de ASSETS é 404, não leitura de arquivo arbitrário.
	const rel = decodeURIComponent(pathname.replace(/^\/+/, ""));
	if (rel.includes("..") || rel.includes("\0")) return false;
	const ext = rel.slice(rel.lastIndexOf("."));
	const type = ASSET_TYPES[ext];
	if (type === undefined) return false;

	const full = join(ASSETS, rel);
	if (!full.startsWith(ASSETS)) return false;
	let body: Buffer;
	try {
		body = await readFile(full);
	} catch {
		return false;
	}
	res.statusCode = 200;
	res.setHeader("content-type", type);
	// Sem cache: o mesmo caminho pode ganhar bytes novos numa regeração.
	res.setHeader("cache-control", "no-store");
	res.end(body);
	return true;
}

export async function handle(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<boolean> {
	const url = new URL(req.url ?? "/", "http://local");

	// Assets gerados em runtime, antes do ramo /api/.
	if (
		req.method === "GET" &&
		(url.pathname.startsWith("/world-blocks/") ||
			url.pathname.startsWith("/sprite-lab/") ||
			url.pathname.startsWith("/assets/"))
	) {
		const rel = url.pathname.startsWith("/assets/")
			? url.pathname.slice("/assets".length)
			: url.pathname;
		if (await serveGeneratedAsset(rel, res)) return true;
		// Não achou: deixa o Vite tentar (publicDir cobre o que existia no boot).
		return false;
	}

	if (!url.pathname.startsWith("/api/")) return false;

	try {
		// ---- state -------------------------------------------------------------
		if (url.pathname === "/api/studio" && req.method === "GET") {
			const s = await load();
			json(res, 200, {
				...s,
				jobs: Object.fromEntries([...jobs].map(([k, v]) => [k, v])),
				hasToken: Boolean(process.env["PIXELLAB_SECRET"]),
				// existsSync de propósito: validar os 12 PNGs do bundle a cada poll
				// de 3s seria I/O jogado fora — a validação de verdade roda no import.
				mannequinDefaultAvailable: existsSync(
					join(MANNEQUIN_DEFAULT_DIR, "mannequin.json"),
				),
			});
			return true;
		}

		// ---- wizard: config -----------------------------------------------------
		if (url.pathname === "/api/wizard/config" && req.method === "POST") {
			const b = await readBody<{
				characterId?: string;
				frameCount?: number;
				fps?: number;
				size?: number;
				silhouette?: Silhouette;
				detail?: DetailOption;
				outline?: OutlineOption;
				view?: ViewOption;
				templateId?: TemplateOption;
			}>(req);

			// Só o manequim trava a config; todo personagem derivado herda o lock.
			if (b.characterId !== "manequim") {
				badRequest(
					res,
					"só o manequim trava a configuração — os demais personagens herdam o lock do wizard",
				);
				return true;
			}
			const s = await load();
			const ch = s.characters.find((c) => c.id === "manequim");
			if (!ch) {
				json(res, 404, { error: "manequim não encontrado" });
				return true;
			}
			if (ch.wizard?.etapa === "pronto") {
				badRequest(res, "a configuração é imutável depois do manequim pronto");
				return true;
			}
			if ((ch.wizard?.southVersions.length ?? 0) > 0) {
				badRequest(
					res,
					"já existe uma versão da sul gerada — a configuração só muda via reset do manequim",
				);
				return true;
			}
			if (b.frameCount !== 4 && b.frameCount !== 8 && b.frameCount !== 16) {
				badRequest(
					res,
					"frameCount precisa ser 4, 8 ou 16 — a API rejeita qualquer outro valor",
				);
				return true;
			}
			if (typeof b.fps !== "number" || !Number.isFinite(b.fps) || b.fps <= 0) {
				badRequest(res, "fps precisa ser um número positivo");
				return true;
			}
			// Faixa do create-character-v3 no spec vendorizado:
			// from-scratch image_size 32–256; reference mode é advisory.
			if (
				typeof b.size !== "number" ||
				!Number.isInteger(b.size) ||
				b.size < 32 ||
				b.size > 256
			) {
				badRequest(
					res,
					"size precisa ser inteiro entre 32 e 256 (faixa do endpoint create-character-v3)",
				);
				return true;
			}
			if (b.silhouette !== undefined && !SILHOUETTES.includes(b.silhouette)) {
				badRequest(
					res,
					`silhouette desconhecida: ${b.silhouette} (válidas: ${SILHOUETTES.join(", ")})`,
				);
				return true;
			}
			// Qualidade: detail e outline existem no create-character-v3 mas são
			// IGNORADOS em modo reference_image. Mantidos para modo from-scratch.
			// shading e guidanceScale foram removidos — o v3 não tem esses parâmetros.
			if (b.detail !== undefined && !DETAIL_OPTIONS.includes(b.detail)) {
				badRequest(
					res,
					`detail desconhecido: ${String(b.detail)} (válidos: ${DETAIL_OPTIONS.join(", ")})`,
				);
				return true;
			}
			if (b.outline !== undefined && !OUTLINE_OPTIONS.includes(b.outline)) {
				badRequest(
					res,
					`outline desconhecido: ${String(b.outline)} (válidos: ${OUTLINE_OPTIONS.join(", ")})`,
				);
				return true;
			}
			if (b.view !== undefined && !VIEW_OPTIONS.includes(b.view)) {
				badRequest(
					res,
					`view desconhecida: ${String(b.view)} (válidas: ${VIEW_OPTIONS.join(", ")})`,
				);
				return true;
			}
			if (b.templateId !== undefined && !TEMPLATE_OPTIONS.includes(b.templateId)) {
				badRequest(
					res,
					`templateId desconhecido: ${String(b.templateId)} (válidos: ${TEMPLATE_OPTIONS.join(", ")})`,
				);
				return true;
			}

			s.lock = {
				frameCount: b.frameCount,
				fps: b.fps,
				size: b.size,
				...(b.detail !== undefined ? { detail: b.detail } : {}),
				...(b.outline !== undefined ? { outline: b.outline } : {}),
				...(b.view !== undefined ? { view: b.view } : {}),
				...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
			};
			const idx = s.characters.findIndex((c) => c.id === "manequim");
			s.characters[idx] = {
				...ch,
				size: b.size,
				...(b.silhouette !== undefined ? { silhouette: b.silhouette } : {}),
			};
			await save(s);
			json(res, 200, { ok: true, lock: s.lock });
			return true;
		}

		// ---- wizard: sul por texto ----------------------------------------------
		if (url.pathname === "/api/wizard/south" && req.method === "POST") {
			const b = await readBody<{
				characterId?: string;
				description?: string;
				colorImageB64?: string;
				referenceBase64?: string;
			}>(req);
			if (
				typeof b.characterId !== "string" ||
				typeof b.description !== "string" ||
				b.description.trim() === ""
			) {
				badRequest(res, "characterId e description são obrigatórios");
				return true;
			}
			const characterId = b.characterId;
			const description = b.description;
			const s = await load();
			const ch = resolveWizardCharacter(s, res, characterId);
			if (!ch) return true;
			// Upload de referência visual para a sul: grava ANTES do spawn —
			// mannequin.ts lê o arquivo do disco e o envia como init_image.
			// Aceita b64 puro ou data URI (FileReader.readAsDataURL na UI manda
			// "data:image/png;base64,…"). Upload novo substitui o anterior; sem
			// o campo, uma referência já gravada continua valendo (remover é
			// DELETE /api/wizard/south/reference). O formato real da imagem não
			// é validado aqui — quem rejeita é a API, e a correção é refazer o
			// upload ou remover a referência.
			if (
				typeof b.referenceBase64 === "string" &&
				b.referenceBase64.trim() !== ""
			) {
				const raw = b.referenceBase64.replace(/^data:image\/\w+;base64,/, "");
				const buf = Buffer.from(raw, "base64");
				if (buf.length === 0) {
					badRequest(res, "referenceBase64 não é um base64 válido");
					return true;
				}
				const refPath = join(ASSETS, "wizard", ch.id, "reference.png");
				await mkdir(dirname(refPath), { recursive: true });
				await writeFile(refPath, buf);
			}
			// colorImageB64 explícito do cliente (ex.: referência de cor customizada)
			// tem precedência sobre a sul do manequim do estúdio.
			const reference =
				b.colorImageB64 && b.colorImageB64.length > 0
					? b.colorImageB64
					: ch.id === "manequim"
						? undefined
						: await mannequinSouthB64(s);
			const key = southKey(ch.id);
			spawn(key, `${ch.label} · sul`, () =>
				generateSouthFromText(
					client(),
					store,
					ch.id,
					description,
					wizardOpts(reference),
				),
			);
			json(res, 202, { key });
			return true;
		}

		// ---- wizard: edição da sul ------------------------------------------------
		if (url.pathname === "/api/wizard/south/edit" && req.method === "POST") {
			const b = await readBody<{ characterId?: string; prompt?: string }>(req);
			if (
				typeof b.characterId !== "string" ||
				typeof b.prompt !== "string" ||
				b.prompt.trim() === ""
			) {
				badRequest(res, "characterId e prompt são obrigatórios");
				return true;
			}
			const characterId = b.characterId;
			const prompt = b.prompt;
			const s = await load();
			const ch = resolveWizardCharacter(s, res, characterId);
			if (!ch) return true;
			const key = southKey(ch.id);
			spawn(key, `${ch.label} · edição da sul`, () =>
				editSouth(client(), store, ch.id, prompt, wizardOpts()),
			);
			json(res, 202, { key });
			return true;
		}

		// ---- wizard: desfazer edição da sul -----------------------------------------
		if (url.pathname === "/api/wizard/south/undo" && req.method === "POST") {
			const b = await readBody<{ characterId?: string }>(req);
			if (typeof b.characterId !== "string") {
				badRequest(res, "characterId é obrigatório");
				return true;
			}
			const s = await load();
			const ch = resolveWizardCharacter(s, res, b.characterId);
			if (!ch) return true;
			// Instantâneo (nenhuma chamada de API): roda na hora — não é job.
			try {
				await undoSouth(store, ch.id, wizardOpts());
			} catch (err) {
				badRequest(res, err instanceof Error ? err.message : String(err));
				return true;
			}
			json(res, 200, { ok: true });
			return true;
		}

		// ---- wizard: remover a referência da sul -------------------------------------
		if (
			url.pathname === "/api/wizard/south/reference" &&
			req.method === "DELETE"
		) {
			const b = await readBody<{ characterId?: string }>(req);
			if (typeof b.characterId !== "string") {
				badRequest(res, "characterId é obrigatório");
				return true;
			}
			const s = await load();
			const ch = s.characters.find((c) => c.id === b.characterId);
			if (!ch) {
				json(res, 404, {
					error: `personagem "${b.characterId}" não encontrado`,
				});
				return true;
			}
			// Idempotente: 200 sempre que o personagem existe — rm force não
			// lança quando o arquivo não existe. Não há ponteiro persistido no
			// modelo: o arquivo em disco É o estado da referência, então
			// removê-lo já devolve a sul ao modo texto puro. Não exige wizard
			// state de propósito: a limpeza precisa funcionar mesmo depois de
			// um reset do manequim.
			await rm(join(ASSETS, "wizard", ch.id, "reference.png"), {
				force: true,
			});
			json(res, 200, { ok: true });
			return true;
		}

		// ---- wizard: oito direções (create-character-v3) -------------------------------
		if (url.pathname === "/api/wizard/directions8" && req.method === "POST") {
			const b = await readBody<{ characterId?: string }>(req);
			if (typeof b.characterId !== "string") {
				badRequest(res, "characterId é obrigatório");
				return true;
			}
			const s = await load();
			const ch = resolveWizardCharacter(s, res, b.characterId);
			if (!ch) return true;
			const key = directions8Key(ch.id);
			spawn(key, `${ch.label} · 8 direções`, () =>
				generateDirections8(client(), store, ch.id, wizardOpts()),
			);
			json(res, 202, { key });
			return true;
		}

		// ---- manequim default -------------------------------------------------------
		if (url.pathname === "/api/mannequin/export" && req.method === "POST") {
			try {
				const bundle = await exportMannequin(store, MANNEQUIN_DEFAULT_DIR);
				json(res, 200, bundle);
			} catch (err) {
				// Pré-condição não atendida (wizard não pronto, célula faltando…) é
				// erro do pedido, não do servidor.
				badRequest(res, err instanceof Error ? err.message : String(err));
			}
			return true;
		}

		if (url.pathname === "/api/mannequin/import" && req.method === "POST") {
			const b = await readBody<{ source?: string; bundle?: unknown }>(req);
			try {
				if (b.source === "default") {
					await importMannequin(
						store,
						{ kind: "default", defaultDir: MANNEQUIN_DEFAULT_DIR },
						ASSETS,
					);
				} else if (b.bundle !== undefined) {
					await importMannequin(store, { kind: "bundle", bundle: b.bundle }, ASSETS);
				} else {
					badRequest(res, 'informe { source: "default" } ou { bundle }');
					return true;
				}
			} catch (err) {
				// Erros de validação do bundle chegam nomeados — vão ao usuário como 400.
				badRequest(res, err instanceof Error ? err.message : String(err));
				return true;
			}
			json(res, 200, { ok: true });
			return true;
		}

		if (url.pathname === "/api/mannequin/reset" && req.method === "POST") {
			const s = await load();
			const idx = s.characters.findIndex((c) => c.id === "manequim");
			const ch = s.characters[idx];
			if (!ch) {
				json(res, 404, { error: "manequim não encontrado" });
				return true;
			}
			// Reabre o wizard do zero: sul, 8 direções, remoteId e lock
			// caem. Poses, guarda-roupa e os demais personagens não são tocados.
			// O passo de cardeais foi removido com a migração v3.
			const next: Character = {
				...ch,
				wizard: { etapa: "sul", southVersions: [], activeSouth: 0 },
			};
			delete next.remoteId;
			s.characters[idx] = next;
			delete s.cells[southKey("manequim")];
			delete s.cells[directions8Key("manequim")];
			delete s.lock;
			await save(s);
			json(res, 200, { ok: true });
			return true;
		}

		// ---- wizard: import/export de bundle (Sprite Studio) ------------------------------
		if (url.pathname === "/api/wizard/import" && req.method === "POST") {
			const b = await readBody<{ characterId?: string; bundle?: unknown }>(req);
			if (typeof b.characterId !== "string" || b.bundle === undefined) {
				badRequest(res, "characterId e bundle são obrigatórios");
				return true;
			}
			try {
				// parseSpriteBundle valida TUDO (schema + PNGs) antes do primeiro
				// byte escrito; importSpriteBundle reseta o wizard do alvo e aplica
				// o bundle (lab → etapa direcoes8; wizard → pronto + remoteId).
				const bundle = parseSpriteBundle(b.bundle);
				await importSpriteBundle(
					store,
					bundle,
					{ kind: "existing", characterId: b.characterId },
					ASSETS,
				);
			} catch (err) {
				// Erros nomeiam o campo ofensor — vão ao usuário como 400.
				badRequest(res, err instanceof Error ? err.message : String(err));
				return true;
			}
			json(res, 200, { ok: true });
			return true;
		}

		if (url.pathname === "/api/wizard/export" && req.method === "POST") {
			const b = await readBody<{ characterId?: string }>(req);
			if (typeof b.characterId !== "string") {
				badRequest(res, "characterId é obrigatório");
				return true;
			}
			try {
				// Exige etapa 'pronto' — exportar trabalho incompleto seria congelar
				// uma base aberta (a regra é do módulo, que lança erro nomeado).
				const bundle = await exportWizardBundle(store, b.characterId, ASSETS);
				json(res, 200, bundle);
			} catch (err) {
				badRequest(res, err instanceof Error ? err.message : String(err));
			}
			return true;
		}

		// ---- laboratório de rotação -----------------------------------------------------
		if (url.pathname === "/api/rotate-lab" && req.method === "POST") {
			const b = await readBody<RotateLabInput>(req);
			try {
				const result = await runRotateLab(client(), b, {
					assetsDir: ASSETS,
					ledgerPath: LEDGER_PATH,
					onLog: (m) => console.log(m),
				});
				// Cache hit vem sem `usage` — não é erro: nenhuma chamada saiu.
				json(res, 200, result);
			} catch (err) {
				if (err instanceof RotateLabValidationError) {
					json(res, 400, { error: err.message, code: err.code });
					return true;
				}
				throw err;
			}
			return true;
		}

		// ---- sprite studio (bancada v3) ---------------------------------------------------
		// ORDEM IMPORTA: o POST exato vem ANTES do GET com prefixo — sem isso um
		// POST /api/sprite-lab cairia no ramo do GET com hash vazio.
		if (url.pathname === "/api/sprite-lab" && req.method === "POST") {
			const b = await readBody<SpriteLabConfig>(req);
			// Validação TOTAL antes de responder: config inválida é 400 nomeado —
			// sem job, sem disco, sem API.
			try {
				validateSpriteLabConfig(b);
			} catch (err) {
				if (err instanceof SpriteLabValidationError) {
					json(res, 400, { error: err.message, code: err.code });
					return true;
				}
				throw err;
			}
			const hash = spriteLabHash(b);
			// Cache hit: o manifesto e os PNGs já estão em disco — 200 com o
			// resultado, sem job e sem gasto (idempotência por hash).
			const cached = await readSpriteLabResult(hash, ASSETS);
			if (cached) {
				// Mesma forma do GET: status nomeado + result. Sem isso a tela
				// teria que distinguir dois formatos de resposta da mesma rota.
				json(res, 200, { status: "pronto", result: cached });
				return true;
			}
			const key = `sprite-lab::${hash}`;
			// cellKeys []: a bancada não tem célula no studio — o andamento chega
			// à UI pelo registro de jobs e o resultado pelo GET abaixo.
			spawn(
				key,
				`sprite-lab · ${hash}`,
				async () => {
					await runSpriteLab(client(), b, {
						assetsDir: ASSETS,
						ledgerPath: LEDGER_PATH,
						onLog: (m) => console.log(m),
					});
				},
				[],
			);
			json(res, 202, { key, hash });
			return true;
		}

		if (url.pathname.startsWith("/api/sprite-lab/") && req.method === "GET") {
			const hash = url.pathname.slice("/api/sprite-lab/".length);
			// O hash é sempre hex de 16 chars — qualquer outra coisa é 404, não
			// tentativa de path traversal no manifesto. Este é o ÚNICO 404 que
			// sobra nesta rota, e ele significa mesmo "recurso inexistente".
			if (!/^[a-f0-9]{16}$/i.test(hash)) {
				json(res, 404, {
					error: `resultado do sprite-lab "${hash}" não existe`,
				});
				return true;
			}

			// Andamento é RESPOSTA, não erro. Antes esta rota devolvia 404
			// enquanto o job rodava e a UI sondava em cima disso: o navegador
			// registrava uma linha vermelha a cada 3 s, o usuário lia aquilo
			// como falha, e uma falha real do job ficava indistinguível do
			// caminho feliz. Agora o estado vem nomeado no corpo, com 200.
			const result = await readSpriteLabResult(hash, ASSETS);
			if (result) {
				json(res, 200, { status: "pronto", result });
				return true;
			}
			const job = jobs.get(`sprite-lab::${hash}`);
			if (job?.status === "falhou") {
				json(res, 200, {
					status: "falhou",
					error: job.message ?? "a geração falhou",
				});
				return true;
			}
			if (job?.status === "gerando") {
				json(res, 200, { status: "gerando" });
				return true;
			}
			// Sem manifesto e sem job: ou o servidor reiniciou no meio (o mapa
			// de jobs é volátil), ou o hash nunca rodou aqui. A UI trata como
			// perdido na hora, em vez de esperar um tempo arbitrário.
			json(res, 200, {
				status: "desconhecido",
				error:
					`não há resultado nem job para o sprite-lab "${hash}" — ` +
					"o servidor pode ter reiniciado durante a geração. " +
					"Gerar de novo com a mesma configuração reaproveita o que já está em disco.",
			});
			return true;
		}

		// ---- blocos do mundo (bancada do create-isometric-tile) --------------------------
		// Mesma forma do sprite-lab: POST exato ANTES do GET com prefixo, 202
		// com {key, hash}, e o GET devolve estado NOMEADO com 200 — andamento
		// nunca é 404.
		if (url.pathname === "/api/world-block" && req.method === "POST") {
			const b = await readBody<WorldBlockConfig>(req);
			try {
				validateWorldBlockConfig(b);
			} catch (err) {
				if (err instanceof WorldBlockValidationError) {
					json(res, 400, { error: err.message, code: err.code });
					return true;
				}
				throw err;
			}
			const hash = worldBlockHash(b);
			const cached = await readWorldBlockResult(hash, ASSETS);
			if (cached) {
				json(res, 200, { status: "pronto", result: cached });
				return true;
			}
			const key = `world-block::${hash}`;
			spawn(
				key,
				`world-block · ${hash}`,
				async () => {
					await runWorldBlock(client(), b, {
						assetsDir: ASSETS,
						ledgerPath: LEDGER_PATH,
						onLog: (m) => console.log(m),
					});
				},
				[],
			);
			json(res, 202, { key, hash });
			return true;
		}

		if (url.pathname.startsWith("/api/world-block/") && req.method === "GET") {
			const hash = url.pathname.slice("/api/world-block/".length);
			if (!/^[a-f0-9]{16}$/i.test(hash)) {
				json(res, 404, { error: `bloco do mundo "${hash}" não existe` });
				return true;
			}
			const result = await readWorldBlockResult(hash, ASSETS);
			if (result) {
				json(res, 200, { status: "pronto", result });
				return true;
			}
			const job = jobs.get(`world-block::${hash}`);
			if (job?.status === "falhou") {
				json(res, 200, {
					status: "falhou",
					error: job.message ?? "a geração falhou",
				});
				return true;
			}
			if (job?.status === "gerando") {
				json(res, 200, { status: "gerando" });
				return true;
			}
			json(res, 200, {
				status: "desconhecido",
				error:
					`não há bloco nem job para "${hash}" — o servidor pode ter reiniciado ` +
					"durante a geração. Gerar de novo com a mesma configuração reaproveita o disco.",
			});
			return true;
		}

		// Catálogo de blocos já gerados: é daqui que o map-builder monta a paleta.
		if (url.pathname === "/api/world-blocks" && req.method === "GET") {
			json(res, 200, { blocks: await listWorldBlocks(ASSETS) });
			return true;
		}

		// ---- characters ------------------------------------------------------------------
		if (url.pathname === "/api/characters" && req.method === "POST") {
			const b = await readBody<{
				label?: string;
				description?: string;
				silhouette?: Silhouette;
				seed?: number;
			}>(req);
			const s = await load();
			const mannequin = s.characters.find((c) => c.id === "manequim");
			if (mannequin?.wizard?.etapa !== "pronto") {
				badRequest(
					res,
					"personagens derivados exigem o manequim pronto — conclua o wizard do manequim primeiro",
				);
				return true;
			}
			const lock = s.lock;
			if (!lock) {
				badRequest(
					res,
					"trave a configuração do manequim primeiro (POST /api/wizard/config)",
				);
				return true;
			}
			if (
				typeof b.label !== "string" ||
				b.label.trim() === "" ||
				typeof b.description !== "string"
			) {
				badRequest(res, "label e description são obrigatórios");
				return true;
			}
			if (b.silhouette !== undefined && !SILHOUETTES.includes(b.silhouette)) {
				badRequest(
					res,
					`silhouette desconhecida: ${b.silhouette} (válidas: ${SILHOUETTES.join(", ")})`,
				);
				return true;
			}
			const id = slug(b.label);
			if (s.characters.some((c) => c.id === id)) {
				badRequest(
					res,
					`já existe um personagem com o id "${id}" — escolha outro nome`,
				);
				return true;
			}
			const ch: Character = {
				id,
				label: b.label,
				description: b.description,
				// Sem silhueta informada, o derivado herda a do manequim: é o corpo
				// de referência, e peça só vale dentro da mesma silhueta.
				silhouette: b.silhouette ?? mannequin.silhouette,
				size: lock.size,
				seed: b.seed ?? Math.floor(Math.random() * 100000),
				wizard: { etapa: "sul", southVersions: [], activeSouth: 0 },
				createdAt: new Date().toISOString(),
			};
			s.characters.push(ch);
			await save(s);
			json(res, 200, ch);
			return true;
		}

		if (url.pathname === "/api/characters/import" && req.method === "POST") {
			const b = await readBody<{ label?: string; bundle?: unknown }>(req);
			if (
				typeof b.label !== "string" ||
				b.label.trim() === "" ||
				b.bundle === undefined
			) {
				badRequest(res, "label e bundle são obrigatórios");
				return true;
			}
			try {
				// Personagem NOVO derivado de um bundle do estúdio (id = slug do
				// label; conflito de id é 400 nomeado pelo módulo). O wizard dele
				// nasce no estado que o bundle carrega: lab → direcoes8; wizard →
				// pronto + remoteId.
				const bundle = parseSpriteBundle(b.bundle);
				const { characterId } = await importSpriteBundle(
					store,
					bundle,
					{ kind: "new", label: b.label },
					ASSETS,
				);
				// A UI lê character.id — devolve o Character recém-criado.
				const s = await load();
				const created = s.characters.find((c) => c.id === characterId);
				if (!created) {
					throw new Error(
						`personagem "${characterId}" não encontrado após o import`,
					);
				}
				json(res, 200, created);
			} catch (err) {
				badRequest(res, err instanceof Error ? err.message : String(err));
			}
			return true;
		}

		// ---- poses -------------------------------------------------------------------------
		if (url.pathname === "/api/poses" && req.method === "POST") {
			const b = await readBody<{
				label?: string;
				kind?: PoseKind;
				templateId?: TemplateAnimation;
				action?: string;
				fps?: number;
				skeleton?: readonly Keypoint[];
				notes?: string;
			}>(req);
			const s = await load();
			// frameCount NÃO vem do cliente: é o lock do wizard que manda.
			const lock = s.lock;
			if (!lock) {
				badRequest(
					res,
					"trave a configuração do manequim primeiro — o frameCount das poses vem do lock (POST /api/wizard/config)",
				);
				return true;
			}
			if (
				typeof b.label !== "string" ||
				b.label.trim() === "" ||
				b.kind === undefined
			) {
				badRequest(res, "label e kind são obrigatórios");
				return true;
			}
			const pose: Pose = {
				id: slug(b.label),
				label: b.label,
				kind: b.kind,
				frameCount: lock.frameCount,
				fps: b.fps ?? lock.fps,
				...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
				...(b.action !== undefined ? { action: b.action } : {}),
				...(b.skeleton !== undefined ? { skeleton: b.skeleton } : {}),
				...(b.notes !== undefined ? { notes: b.notes } : {}),
			};
			s.poses.push(pose);
			await save(s);
			json(res, 200, pose);
			return true;
		}

		if (url.pathname === "/api/poses" && req.method === "DELETE") {
			const b = await readBody<{ id: string }>(req);
			const s = await load();
			s.poses = s.poses.filter((p) => p.id !== b.id || p.builtin);
			await save(s);
			json(res, 200, { ok: true });
			return true;
		}

		// ---- wardrobe ------------------------------------------------------------------------
		if (url.pathname === "/api/wardrobe" && req.method === "POST") {
			const b = await readBody<Omit<WardrobeItem, "id" | "createdAt">>(req);
			const s = await load();
			const item: WardrobeItem = {
				...b,
				id: slug(b.label),
				createdAt: new Date().toISOString(),
			};
			s.wardrobe.push(item);
			await save(s);
			json(res, 200, item);
			return true;
		}

		// ---- generation ------------------------------------------------------------------------
		if (url.pathname === "/api/generate" && req.method === "POST") {
			const b = await readBody<{
				characterId?: string;
				poseId?: string;
				wardrobeId?: string;
			}>(req);
			const s = await load();
			const ch = s.characters.find((c) => c.id === b.characterId);
			if (!ch) {
				json(res, 404, { error: "personagem não encontrado" });
				return true;
			}

			if (b.wardrobeId !== undefined) {
				const item = s.wardrobe.find((w) => w.id === b.wardrobeId);
				if (!item) {
					json(res, 404, { error: "peça não encontrada" });
					return true;
				}
				const key = wardrobeKey(ch.id, item.id);
				// 'pronto' is terminal: answer without pre-marking or spawning —
				// overwriting the cell with 'gerando' would re-arm a paid generation.
				if (s.cells[key]?.status === "pronto") {
					json(res, 200, { key, status: "pronto" });
					return true;
				}
				s.cells[key] = {
					key,
					status: "gerando",
					updatedAt: new Date().toISOString(),
				};
				await save(s);
				spawn(key, `${ch.label} · ${item.label}`, () =>
					generateWardrobe(ch, item),
				);
				json(res, 202, { key });
				return true;
			}

			// O fluxo v1 morreu: a base agora nasce no wizard, não nesta rota.
			if (b.poseId === undefined || b.poseId === "__base__") {
				badRequest(
					res,
					"o modelo base não é gerado por esta rota — use o wizard " +
						"(POST /api/wizard/south, /api/wizard/cardinals e /api/wizard/directions8)",
				);
				return true;
			}

			const pose = s.poses.find((p) => p.id === b.poseId);
			if (!pose) {
				json(res, 404, { error: "pose não encontrada" });
				return true;
			}
			const lock = s.lock;
			if (!lock) {
				badRequest(
					res,
					"trave a configuração do manequim primeiro — o frameCount das poses vem do lock (POST /api/wizard/config)",
				);
				return true;
			}
			const key = cellKey(ch.id, pose.id);
			// 'pronto' is terminal, same as the wardrobe branch above.
			if (s.cells[key]?.status === "pronto") {
				json(res, 200, { key, status: "pronto" });
				return true;
			}
			s.cells[key] = {
				key,
				status: "gerando",
				updatedAt: new Date().toISOString(),
			};
			await save(s);
			spawn(key, `${ch.label} · ${pose.label}`, () =>
				generatePose(ch, pose, lock),
			);
			json(res, 202, { key });
			return true;
		}

		json(res, 404, { error: "rota desconhecida" });
		return true;
	} catch (err) {
		json(res, 500, { error: err instanceof Error ? err.message : String(err) });
		return true;
	}
}
