/**
 * Sprite Studio — the authoring screen.
 *
 * One grid: poses down, the 8 directions across. Every cell is one slot of the
 * character sheet, and its state is visible at a glance — empty, queued,
 * generating, ready or failed.
 *
 * The screen never talks to PixelLab directly. It talks to the local server,
 * which owns the token and the job registry, so a page reload never loses work
 * that has already been paid for.
 */
import {
	DIRECTIONS,
	DIR_SHORT,
	SKELETON_LABELS,
	TEMPLATE_ANIMATIONS,
	type Cell,
	type Character,
	type Pose,
	type Studio,
	type WardrobeItem,
	type WardrobeSlot,
} from "../server/model.ts";
import type { EstimateResponse } from "../server/estimate.ts";
import { showCostDialog } from "./cost-dialog.ts";

interface StudioResponse extends Studio {
	readonly jobs: Record<
		string,
		{ status: string; label: string; message?: string }
	>;
	readonly hasToken: boolean;
}

const app = document.getElementById("app")!;
const statusEl = document.getElementById("status")!;

let studio: StudioResponse | undefined;
let selectedCharacter = "base-humano";

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
	const res = await fetch(`/api/${path}`, {
		...init,
		headers: init?.body ? { "content-type": "application/json" } : {},
	});
	const body = (await res.json()) as T & { error?: string };
	if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
	return body;
};

const el = <K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: Record<string, string> = {},
	...kids: (Node | string)[]
): HTMLElementTagNameMap[K] => {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === "class") n.className = v;
		else if (k === "html") n.innerHTML = v;
		else n.setAttribute(k, v);
	}
	for (const kid of kids) n.append(kid);
	return n;
};

const cellFor = (s: Studio, charId: string, poseId: string): Cell | undefined =>
	s.cells[`${charId}::${poseId}`];

const wardrobeCellFor = (
	s: Studio,
	charId: string,
	itemId: string,
): Cell | undefined => s.cells[`${charId}::wardrobe::${itemId}`];

// ---------------------------------------------------------------- rendering

function renderCell(cell: Cell | undefined, dir: string): HTMLElement {
	const td = el("td", { class: `cell ${cell?.status ?? "vazio"}` });
	const frames = cell?.frames?.[dir];

	if (cell?.status === "pronto" && frames?.length) {
		const img = el("img", {
			src: frames[0]!,
			alt: dir,
			title: `${dir} · ${frames.length} frame(s)`,
		});
		// Animate on hover so a walk cycle can be judged without opening anything.
		if (frames.length > 1) {
			let i = 0;
			let timer: number | undefined;
			td.addEventListener("mouseenter", () => {
				timer = window.setInterval(() => {
					i = (i + 1) % frames.length;
					img.src = frames[i]!;
				}, 110);
			});
			td.addEventListener("mouseleave", () => {
				if (timer) clearInterval(timer);
				i = 0;
				img.src = frames[0]!;
			});
		}
		td.append(img);
		return td;
	}

	const label =
		cell?.status === "gerando"
			? "⋯"
			: cell?.status === "falhou"
				? "✕"
				: cell?.status === "na-fila"
					? "·"
					: "";
	const ph = el("div", { class: "ph", title: cell?.error ?? "" }, label);
	td.append(ph);
	return td;
}

function renderGrid(s: StudioResponse, char: Character): HTMLElement {
	const wrap = el("div", { class: "scroll" });
	const table = el("table");

	const head = el("tr", {}, el("th", { class: "row-label" }, "Pose"));
	for (const d of DIRECTIONS) head.append(el("th", { title: d }, DIR_SHORT[d]));
	head.append(el("th", {}, "Ação"));
	table.append(head);

	// The base row comes first: nothing else can be generated before it exists,
	// because every pose and every garment is derived from the base character.
	const baseCell = cellFor(s, char.id, "__base__");
	const baseRow = el(
		"tr",
		{},
		el(
			"th",
			{ class: "row-label" },
			el("span", {}, "Modelo base"),
			el(
				"small",
				{},
				char.remoteId
					? `id remoto ${char.remoteId.slice(0, 12)}…`
					: "sem id remoto ainda",
			),
		),
	);
	for (const d of DIRECTIONS) baseRow.append(renderCell(baseCell, d));
	const baseBtn = el(
		"button",
		{ class: "primary" },
		baseCell?.status === "gerando" ? "gerando…" : "Gerar base",
	);
	baseBtn.toggleAttribute(
		"disabled",
		baseCell?.status === "gerando" || !s.hasToken,
	);
	baseBtn.onclick = () => generate({ characterId: char.id });
	baseRow.append(el("td", {}, baseBtn));
	table.append(baseRow);

	for (const pose of s.poses) {
		const cell = cellFor(s, char.id, pose.id);
		const kindTag = el("span", { class: `tag ${pose.kind}` }, pose.kind);
		const detail =
			pose.kind === "template"
				? (pose.templateId ?? "")
				: pose.kind === "action"
					? `"${pose.action ?? ""}"`
					: "esqueleto";
		const row = el(
			"tr",
			{},
			el(
				"th",
				{ class: "row-label" },
				el("span", {}, pose.label, " ", kindTag),
				el("small", {}, `${detail} · ${pose.frameCount}f · ${pose.fps}fps`),
			),
		);
		for (const d of DIRECTIONS) row.append(renderCell(cell, d));

		const btn = el(
			"button",
			{},
			cell?.status === "gerando" ? "gerando…" : "Gerar",
		);
		const blocked = !char.remoteId || cell?.status === "gerando" || !s.hasToken;
		btn.toggleAttribute("disabled", blocked);
		if (!char.remoteId) btn.title = "gere o modelo base primeiro";
		btn.onclick = () => generate({ characterId: char.id, poseId: pose.id });
		row.append(el("td", {}, btn));
		table.append(row);
	}

	wrap.append(table);
	return wrap;
}

function renderWardrobe(s: StudioResponse, char: Character): HTMLElement {
	const panel = el("div", { class: "panel" });
	panel.append(
		el(
			"p",
			{ class: "note" },
			`Cada peça é uma edição aplicada sobre o corpo base e propagada nas 8 direções pelo ` +
				`create-character-state, que devolve um group_id ligando o estado ao corpo de origem. ` +
				`Vale para qualquer personagem da MESMA silhueta (${char.silhouette}) — peça de outra ` +
				`silhueta é recusada antes de gastar.`,
		),
	);

	if (s.wardrobe.length > 0) {
		const table = el("table");
		const head = el("tr", {}, el("th", { class: "row-label" }, "Peça"));
		for (const d of DIRECTIONS) head.append(el("th", {}, DIR_SHORT[d]));
		head.append(el("th", {}, "Ação"));
		table.append(head);

		for (const item of s.wardrobe) {
			const cell = wardrobeCellFor(s, char.id, item.id);
			const fits = item.silhouette === char.silhouette;
			const row = el(
				"tr",
				{},
				el(
					"th",
					{ class: "row-label" },
					el(
						"span",
						{},
						item.label,
						" ",
						el("span", { class: "tag" }, item.slot),
					),
					el(
						"small",
						{},
						fits
							? `"${item.editDescription}"`
							: `silhueta ${item.silhouette} — não serve neste corpo`,
					),
				),
			);
			for (const d of DIRECTIONS) row.append(renderCell(cell, d));
			const btn = el(
				"button",
				{},
				cell?.status === "gerando" ? "gerando…" : "Gerar",
			);
			btn.toggleAttribute(
				"disabled",
				!fits || !char.remoteId || cell?.status === "gerando" || !s.hasToken,
			);
			if (!fits)
				btn.title = `peça é ${item.silhouette}, personagem é ${char.silhouette}`;
			btn.onclick = () =>
				generate({ characterId: char.id, wardrobeId: item.id });
			row.append(el("td", {}, btn));
			table.append(row);
		}
		panel.append(el("div", { class: "scroll" }, table));
	}

	// --- new item form
	const label = el("input", { placeholder: "Cota de malha enferrujada" });
	const slot = el("select");
	for (const sl of [
		"cabeca",
		"torso",
		"pernas",
		"pes",
		"maos",
		"arma",
		"costas",
	] as WardrobeSlot[]) {
		slot.append(el("option", { value: sl }, sl));
	}
	const desc = el("input", {
		placeholder: "wearing a rusted chainmail hauberk",
	});
	const keep = el("input", { type: "checkbox" });
	keep.checked = true;

	const add = el("button", { class: "primary" }, "Cadastrar peça");
	add.onclick = async () => {
		if (!label.value.trim() || !desc.value.trim()) return;
		await api<WardrobeItem>("wardrobe", {
			method: "POST",
			body: JSON.stringify({
				label: label.value.trim(),
				slot: slot.value,
				editDescription: desc.value.trim(),
				// A garment belongs to the silhouette it was authored against; the server
				// refuses to apply it to any other, before spending anything.
				silhouette: char.silhouette,
				keepPalette: keep.checked,
				seed: Math.floor(Math.random() * 100000),
			}),
		});
		label.value = "";
		desc.value = "";
		await refresh();
	};

	panel.append(
		el(
			"div",
			{ class: "row" },
			el("label", {}, el("span", {}, "Nome"), label),
			el("label", {}, el("span", {}, "Slot"), slot),
			el("label", {}, el("span", {}, "Edição (inglês, é o prompt)"), desc),
			el("label", {}, el("span", {}, "Manter paleta do corpo"), keep),
			add,
		),
	);
	return panel;
}

function renderPoseForm(): HTMLElement {
	const panel = el("div", { class: "panel" });
	panel.append(
		el(
			"p",
			{ class: "note" },
			"Só existem 10 templates nativos, e walk, run e jump não estão entre eles — por isso " +
				"pose nova de movimento vai por texto livre. Template custa 1 geração por direção; " +
				"texto livre custa ~1 por direção até 96px e escala com o tamanho acima disso.",
		),
	);

	const label = el("input", { placeholder: "Bloqueando com escudo" });
	const kind = el("select");
	for (const [v, t] of [
		["template", "template nativo (mais barato)"],
		["action", "texto livre"],
		["skeleton", "esqueleto manual"],
	]) {
		kind.append(el("option", { value: v! }, t!));
	}
	const tpl = el("select");
	for (const t of TEMPLATE_ANIMATIONS)
		tpl.append(el("option", { value: t }, t));
	const action = el("input", { placeholder: "raising a shield to block" });
	const frames = el("select");
	for (const f of ["4", "8", "16"])
		frames.append(el("option", { value: f }, `${f} frames`));
	frames.value = "8";
	const fps = el("input", { type: "number", value: "8", min: "1", max: "30" });

	const tplWrap = el("label", {}, el("span", {}, "Template"), tpl);
	const actWrap = el(
		"label",
		{},
		el("span", {}, "Ação (inglês, é o prompt)"),
		action,
	);
	const skelNote = el(
		"p",
		{ class: "note" },
		`Pose de esqueleto usa os 18 keypoints (${SKELETON_LABELS.slice(0, 4).join(", ")}…) e é ` +
			"gerada uma direção por vez pelo animate-with-skeleton. Cadastre aqui e edite os " +
			"keypoints em studio.json — a geração por esqueleto ainda não tem editor visual.",
	);

	const sync = (): void => {
		tplWrap.style.display = kind.value === "template" ? "" : "none";
		actWrap.style.display = kind.value === "action" ? "" : "none";
		skelNote.style.display = kind.value === "skeleton" ? "" : "none";
	};
	kind.onchange = sync;

	const add = el("button", { class: "primary" }, "Cadastrar pose");
	add.onclick = async () => {
		if (!label.value.trim()) return;
		const body: Record<string, unknown> = {
			label: label.value.trim(),
			kind: kind.value,
			frameCount: Number(frames.value),
			fps: Number(fps.value),
		};
		if (kind.value === "template") body["templateId"] = tpl.value;
		if (kind.value === "action") body["action"] = action.value.trim();
		await api<Pose>("poses", { method: "POST", body: JSON.stringify(body) });
		label.value = "";
		action.value = "";
		await refresh();
	};

	panel.append(
		el(
			"div",
			{ class: "row" },
			el("label", {}, el("span", {}, "Nome"), label),
			el("label", {}, el("span", {}, "Como gerar"), kind),
			tplWrap,
			actWrap,
			el("label", {}, el("span", {}, "Frames"), frames),
			el("label", {}, el("span", {}, "FPS"), fps),
			add,
		),
		skelNote,
	);
	sync();
	return panel;
}

function renderReference(char: Character): HTMLElement {
	const panel = el("div", { class: "panel" });
	const drop = el(
		"div",
		{ class: "drop" },
		char.referenceImage
			? "Referência anexada. Solte outra imagem para trocar."
			: "Arraste a arte de referência aqui (virada para o SUL, até 256×256)",
	);
	if (char.referenceImage) {
		drop.append(
			el("img", {
				src: `data:image/png;base64,${char.referenceImage}`,
				alt: "referência",
			}),
		);
	}

	const input = el("input", { type: "file", accept: "image/png,image/jpeg" });
	input.style.display = "none";
	drop.onclick = () => input.click();

	const take = async (file: File): Promise<void> => {
		const base64 = await new Promise<string>((resolve, reject) => {
			const r = new FileReader();
			r.onload = () => resolve(String(r.result));
			r.onerror = () => reject(new Error("não consegui ler o arquivo"));
			r.readAsDataURL(file);
		});
		await api("reference", {
			method: "POST",
			body: JSON.stringify({ characterId: char.id, base64 }),
		});
		await refresh();
	};

	input.onchange = () => {
		const f = input.files?.[0];
		if (f) void take(f);
	};
	drop.ondragover = (e) => {
		e.preventDefault();
		drop.classList.add("over");
	};
	drop.ondragleave = () => drop.classList.remove("over");
	drop.ondrop = (e) => {
		e.preventDefault();
		drop.classList.remove("over");
		const f = e.dataTransfer?.files?.[0];
		if (f) void take(f);
	};

	panel.append(
		el(
			"p",
			{ class: "note" },
			"Com referência anexada, o create-character-v3 rotaciona ESSA arte nas 8 direções em vez " +
				"de inventar um corpo. Sem ela, o corpo vem do texto da descrição.",
		),
		drop,
		input,
		el("p", { class: "note" }, `Descrição atual: "${char.description}"`),
	);
	return panel;
}

// ---------------------------------------------------------------- actions

async function generate(body: {
	characterId: string;
	poseId?: string;
	wardrobeId?: string;
}): Promise<void> {
	try {
		const params = new URLSearchParams({ characterId: body.characterId });
		if (body.poseId) params.set("poseId", body.poseId);
		if (body.wardrobeId) params.set("wardrobeId", body.wardrobeId);

		const estimate = await api<EstimateResponse>(
			`estimate?${params.toString()}`,
		);
		const result = await showCostDialog(estimate, 1, estimate.cached);
		if (!result.confirmed) return;

		await api("generate", { method: "POST", body: JSON.stringify(body) });
		await refresh();
	} catch (err) {
		statusEl.textContent = `erro: ${err instanceof Error ? err.message : String(err)}`;
	}
}

function render(): void {
	const s = studio;
	if (!s) return;
	const char =
		s.characters.find((c) => c.id === selectedCharacter) ?? s.characters[0];
	if (!char) return;

	const busy = Object.values(s.jobs).filter(
		(j) => j.status === "gerando",
	).length;
	statusEl.textContent = s.hasToken
		? busy > 0
			? `${busy} geração(ões) em andamento — 2 a 5 min cada`
			: "ocioso"
		: "PIXELLAB_SECRET não definido — a tela funciona, mas nada gera";

	app.replaceChildren();

	const picker = el("select");
	for (const c of s.characters)
		picker.append(el("option", { value: c.id }, c.label));
	picker.value = char.id;
	picker.onchange = () => {
		selectedCharacter = picker.value;
		render();
	};
	app.append(
		el(
			"div",
			{ class: "panel" },
			el(
				"div",
				{ class: "row" },
				el("label", {}, el("span", {}, "Personagem"), picker),
			),
		),
	);

	app.append(el("h2", {}, "Arte de referência"), renderReference(char));
	app.append(el("h2", {}, "Poses × 8 direções"), renderGrid(s, char));
	app.append(el("h2", {}, "Cadastrar nova pose"), renderPoseForm());
	app.append(
		el("h2", {}, "Guarda-roupa e equipamento"),
		renderWardrobe(s, char),
	);
}

async function refresh(): Promise<void> {
	studio = await api<StudioResponse>("studio");
	render();
}

// Jobs run for minutes; polling every 3s is cheap and survives a reload, which
// matters because the work is already paid for by the time it starts.
await refresh();
setInterval(() => {
	const busy = Object.values(studio?.jobs ?? {}).some(
		(j) => j.status === "gerando",
	);
	if (busy) void refresh();
}, 3000);
