/**
 * Local API for the character builder, mounted as Vite middleware.
 *
 * Two responsibilities that must not leak into the browser:
 *   1. The PixelLab token. Every call to the API goes through here.
 *   2. Long jobs. Generation takes 2-5 minutes; the browser polls this server,
 *      which owns the job registry and survives a page reload.
 *
 * v2: o fluxo antigo de "modelo base" morreu — quem constrói o corpo é o
 * wizard (server/mannequin.ts), em cadeia derivativa: sul por texto → edição
 * → cardeais → 8 direções. Estas rotas só fazem a fiação: validam o pedido,
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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PixelLabClient, pollJob } from "../../pixellab-pipeline/src/api.ts";
import {
	generateSouthFromText,
	editSouth,
	undoSouth,
	rotateCardinals,
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
	DIRECTIONS,
	cardinalKey,
	cellKey,
	directions8Key,
	seedStudio,
	southKey,
	wardrobeKey,
	type Character,
	type Keypoint,
	type MannequinLock,
	type Pose,
	type PoseKind,
	type Silhouette,
	type Studio,
	type TemplateAnimation,
	type WardrobeItem,
} from "./model.ts";

const ROOT = new URL("..", import.meta.url).pathname;
// Test seam: lets server/api.test.ts point the state at a tmpdir. Never set
// in normal use — the default is the tool's own studio.json.
const STUDIO_JSON =
	process.env["CHARACTER_BUILDER_STUDIO_JSON"] ?? join(ROOT, "studio.json");
const ASSETS = join(ROOT, "assets");
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

async function load(): Promise<Studio> {
	if (cache) return cache;
	try {
		cache = JSON.parse(await readFile(STUDIO_JSON, "utf8")) as Studio;
	} catch {
		cache = seedStudio();
		await save(cache);
	}
	return cache;
}

async function save(s: Studio): Promise<void> {
	cache = s;
	await mkdir(dirname(STUDIO_JSON), { recursive: true });
	const tmp = `${STUDIO_JSON}.tmp`;
	await writeFile(tmp, `${JSON.stringify(s, null, 2)}\n`);
	const { rename } = await import("node:fs/promises");
	await rename(tmp, STUDIO_JSON);
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

export async function handle(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<boolean> {
	const url = new URL(req.url ?? "/", "http://local");
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
			// Faixa do create-character-with-8-directions no spec vendorizado:
			// image_size 16–128 (o bitforge aceita até 200; o elo fraco é a base).
			if (
				typeof b.size !== "number" ||
				!Number.isInteger(b.size) ||
				b.size < 16 ||
				b.size > 128
			) {
				badRequest(
					res,
					"size precisa ser inteiro entre 16 e 128 (faixa do endpoint de 8 direções)",
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

			s.lock = { frameCount: b.frameCount, fps: b.fps, size: b.size };
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
			const b = await readBody<{ characterId?: string; description?: string }>(
				req,
			);
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
			// Derivados levam a sul do manequim como color_image (paleta travada).
			const reference =
				ch.id === "manequim" ? undefined : await mannequinSouthB64(s);
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

		// ---- wizard: cardeais ---------------------------------------------------------
		if (url.pathname === "/api/wizard/cardinals" && req.method === "POST") {
			const b = await readBody<{ characterId?: string }>(req);
			if (typeof b.characterId !== "string") {
				badRequest(res, "characterId é obrigatório");
				return true;
			}
			const s = await load();
			const ch = resolveWizardCharacter(s, res, b.characterId);
			if (!ch) return true;
			// mannequin.ts grava as três células cardinal-* uma a uma; o job usa a
			// chave da primeira direção e o spawn marca falha só nas que não
			// ficaram prontas (política documentada no cabeçalho do arquivo).
			const key = cardinalKey(ch.id, "east");
			spawn(
				key,
				`${ch.label} · cardeais`,
				() => rotateCardinals(client(), store, ch.id, wizardOpts()),
				[
					cardinalKey(ch.id, "east"),
					cardinalKey(ch.id, "north"),
					cardinalKey(ch.id, "west"),
				],
			);
			json(res, 202, { key });
			return true;
		}

		// ---- wizard: oito direções -------------------------------------------------------
		if (url.pathname === "/api/wizard/directions8" && req.method === "POST") {
			const b = await readBody<{ characterId?: string }>(req);
			if (typeof b.characterId !== "string") {
				badRequest(res, "characterId é obrigatório");
				return true;
			}
			const s = await load();
			const ch = resolveWizardCharacter(s, res, b.characterId);
			if (!ch) return true;
			// Derivados levam a sul do manequim como color_image (paleta travada).
			const reference =
				ch.id === "manequim" ? undefined : await mannequinSouthB64(s);
			const key = directions8Key(ch.id);
			spawn(key, `${ch.label} · 8 direções`, () =>
				generateDirections8(client(), store, ch.id, wizardOpts(reference)),
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
			// Reabre o wizard do zero: sul, cardeais, 8 direções, remoteId e lock
			// caem. Poses, guarda-roupa e os demais personagens não são tocados.
			// Um job do wizard ainda em voo pode regravar célula ao concluir —
			// reset não aborta job em andamento.
			const next: Character = {
				...ch,
				wizard: { etapa: "sul", southVersions: [], activeSouth: 0 },
			};
			delete next.remoteId;
			s.characters[idx] = next;
			delete s.cells[southKey("manequim")];
			delete s.cells[cardinalKey("manequim", "east")];
			delete s.cells[cardinalKey("manequim", "north")];
			delete s.cells[cardinalKey("manequim", "west")];
			delete s.cells[directions8Key("manequim")];
			delete s.lock;
			await save(s);
			json(res, 200, { ok: true });
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
