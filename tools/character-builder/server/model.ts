/**
 * Authoring model for the sprite studio.
 *
 * The whole tool rests on one idea: a character is a **base body** (bald, naked)
 * that gets rotated into 8 directions once, and everything else — poses, clothes,
 * weapons — is derived from that body rather than generated from scratch.
 *
 * That is not a style preference, it is what makes the art coherent and the bill
 * small. Deriving keeps identity and palette; generating from scratch does not.
 *
 * State lives in `studio.json`: human-readable, diffable, versionable in git.
 * No database, on purpose — this is authoring data, and authoring data belongs
 * next to the assets it describes.
 */

/** Canonical order the PixelLab 8-rotation endpoints return frames in.
 *  Naming frames in any other order makes sprites face the wrong way. */
export const DIRECTIONS = [
	"south",
	"south-west",
	"west",
	"north-west",
	"north",
	"north-east",
	"east",
	"south-east",
] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIR_SHORT: Record<Direction, string> = {
	south: "S",
	"south-west": "SW",
	west: "W",
	"north-west": "NW",
	north: "N",
	"north-east": "NE",
	east: "E",
	"south-east": "SE",
};

/**
 * The 10 animation templates the API actually ships. Verified against the
 * vendored spec on 2026-07-29 — there are no others.
 *
 * Note what is missing: plain `walk`, `run` and `jump`. Those must go through
 * free-text `action`, which is exactly why this tool supports both kinds.
 */
export const TEMPLATE_ANIMATIONS = [
	"angry",
	"attack",
	"attack-back",
	"attack-left",
	"attack-right",
	"backflip",
	"bark",
	"breathing-idle",
	"cross-punch",
	"crouched-walking",
] as const;
export type TemplateAnimation = (typeof TEMPLATE_ANIMATIONS)[number];

/** The 18 joint labels `estimate-skeleton` returns and `animate-with-skeleton` accepts. */
export const SKELETON_LABELS = [
	"NOSE",
	"NECK",
	"RIGHT SHOULDER",
	"RIGHT ELBOW",
	"RIGHT ARM",
	"LEFT SHOULDER",
	"LEFT ELBOW",
	"LEFT ARM",
	"RIGHT HIP",
	"RIGHT KNEE",
	"RIGHT LEG",
	"LEFT HIP",
	"LEFT KNEE",
	"LEFT LEG",
	"RIGHT EYE",
	"LEFT EYE",
	"RIGHT EAR",
	"LEFT EAR",
] as const;
export type SkeletonLabel = (typeof SKELETON_LABELS)[number];

export interface Keypoint {
	readonly x: number;
	readonly y: number;
	readonly label: SkeletonLabel;
	readonly z_index?: number;
}

/**
 * How a pose is produced. Three kinds, in ascending order of cost and control.
 */
export type PoseKind =
	/** One of the 10 built-in templates. 1 generation per direction — the cheap path. */
	| "template"
	/** Free-text action through the v3 model. ~1 gen/direction up to 96px, more above. */
	| "action"
	/** Hand-authored joint positions. Full control, one direction at a time. */
	| "skeleton";

export interface Pose {
	readonly id: string;
	/** Shown in the UI, in pt-BR. */
	readonly label: string;
	readonly kind: PoseKind;
	readonly templateId?: TemplateAnimation;
	/** Free-text action for `kind: 'action'`, e.g. "correndo para a frente". */
	readonly action?: string;
	/** 4, 8 or 16. The API rejects anything else. */
	readonly frameCount: 4 | 8 | 16;
	/** Frames per second for playback. Post-processing only — never costs anything. */
	readonly fps: number;
	readonly skeleton?: readonly Keypoint[];
	/** Built-in poses cannot be deleted from the UI; they define the base contract. */
	readonly builtin?: boolean;
	readonly notes?: string;
}

/**
 * Base body shape. A garment is reusable ONLY across characters that share the
 * same silhouette — this is not a convention, it is what the largest open
 * paper-doll project (LPC) proves in practice: 87% of its 768 item definitions
 * alias body types to shared folders, and an item that omits a body type is
 * simply unrenderable on it.
 *
 * Modelling it as a field means the studio can refuse an impossible combination
 * instead of generating a garment that will never fit.
 */
export type Silhouette =
	| "humano-medio"
	| "humano-corpulento"
	| "humano-esguio"
	| "quadrupede";

/**
 * Wizard steps, in order. The cardinals step was removed with the v3 migration:
 * `create-character-v3` rotates the south-facing `reference_image` directly into
 * 8 directions — no intermediate `/rotate` calls needed.
 *
 * "pronto" is terminal: from then on the frame contract (`Studio.lock`) is
 * immutable and the mannequin is just a character.
 */
export type WizardStage = "sul" | "direcoes8" | "pronto";

/** One accepted version of the south face. The art itself lives in the cell
 *  under `southKey(characterId)` — this history keeps the prompt that made it. */
export interface SouthVersion {
	/** What the user typed. In mannequin mode this is the STYLE, not the body. */
	readonly prompt: string;
	/**
	 * What was actually sent as `description`. Differs from `prompt` only in
	 * mannequin mode, where the body scaffold is appended.
	 *
	 * Idempotency compares this, falling back to `prompt` when absent — which is
	 * what keeps versions written before mannequin mode existed comparable.
	 */
	readonly effective?: string;
	/** Whether the mannequin scaffold produced this version. */
	readonly mannequin?: boolean;
	readonly at: string;
}

/**
 * Per-character wizard progress. The mannequin is born with one; characters
 * derived from it walk the SAME wizard with their own state.
 */
export interface WizardState {
	etapa: WizardStage;
	/** Prompt history of the south face — undo walks this list backwards. */
	southVersions: readonly SouthVersion[];
	/** Index into `southVersions` of the version currently in use. */
	activeSouth: number;
}

export interface Character {
	readonly id: string;
	readonly label: string;
	/** Garments cross-apply only within the same silhouette. */
	readonly silhouette: Silhouette;
	/** Prompt used for the base body. Kept bald and unclothed on purpose. */
	readonly description: string;
	readonly size: number;
	readonly seed: number;
	/**
	 * Force a featureless base body: the user's text becomes STYLE only, and the
	 * body comes from `mannequin-prompt.ts` plus `negative_description`.
	 *
	 * Per character, not global, and that is the point: the base body is a
	 * mannequin, every character derived from it is supposed to be dressed.
	 * `template_id: 'mannequin'` does NOT do this — it only picks the skeleton
	 * the animator fits, per the vendored spec.
	 */
	mannequin?: boolean;
	/** Extra `negative_description` terms, appended to the mannequin defaults. */
	negativePrompt?: string;
	/**
	 * Wizard progress, when the character goes through the wizard. Absent on
	 * characters authored the old way — v2 is additive, both shapes are valid.
	 */
	wizard?: WizardState;
	/** Character id minted by the API. Everything downstream hangs off this. */
	remoteId?: string;
	/**
	 * Generate in isometric projection. OMITIDO do request quando false —
	 * preserva specHash (F0-09).
	 */
	isometric?: boolean;
	readonly createdAt: string;
}

/** Equipment slot. Render order matters and is direction-dependent. */
export type WardrobeSlot =
	| "cabeca"
	| "torso"
	| "pernas"
	| "pes"
	| "maos"
	| "arma"
	| "costas";

export interface WardrobeItem {
	readonly id: string;
	readonly label: string;
	readonly slot: WardrobeSlot;
	/** Silhouette this piece was authored against. Applying it to another is refused. */
	readonly silhouette: Silhouette;
	/**
	 * The edit applied on top of a base character, e.g. "wearing a rusted chainmail
	 * hauberk". `create-character-state` applies it consistently across all 8
	 * directions and can snap to the source character's palette.
	 */
	readonly editDescription: string;
	/** Keep the source character's palette so the piece does not drift in colour. */
	readonly keepPalette: boolean;
	readonly seed: number;
	readonly createdAt: string;
}

export type CellStatus = "vazio" | "na-fila" | "gerando" | "pronto" | "falhou";

/** One (character × pose) intersection, or (character × wardrobe) for equipment. */
export interface Cell {
	readonly key: string;
	status: CellStatus;
	jobId?: string;
	/** Character id the API minted for a wardrobe state — it is a character too. */
	remoteId?: string;
	/** `create-character-state` links the new state to its source via this field. */
	groupId?: string;
	/** Relative paths under assets/, one per direction, in canonical order. */
	frames?: Record<string, string[]>;
	error?: string;
	costUsd?: number;
	updatedAt?: string;
}

/**
 * Quality knobs of the generation endpoints, verified against the vendored
 * spec on 2026-07-31 (tools/pixellab-pipeline/openapi/openapi-v2.json):
 *
 * - `/create-image-bitforge` declares these as strict string enums — exactly
 *   the values below.
 * - `/create-character-with-8-directions` declares them as free strings with
 *   a prose list in the description ("soft guidance — the model may not
 *   follow exactly"); the prose drifts slightly ("high detail" there vs
 *   "highly detailed" in bitforge). The bitforge enums below are valid for
 *   both schemas, so they are the single source for the client.
 * - mode 'pro' of the 8-directions endpoint IGNORES detail/shading/outline
 *   and text_guidance_scale — the wizard always uses mode 'standard'.
 *
 * The client imports these arrays to render the selector — do not rename.
 */
export const DETAIL_OPTIONS = [
	"low detail",
	"medium detail",
	"highly detailed",
] as const;
export type DetailOption = (typeof DETAIL_OPTIONS)[number];

export const SHADING_OPTIONS = [
	"flat shading",
	"basic shading",
	"medium shading",
	"detailed shading",
	"highly detailed shading",
] as const;
export type ShadingOption = (typeof SHADING_OPTIONS)[number];

export const OUTLINE_OPTIONS = [
	"single color black outline",
	"single color outline",
	"selective outline",
	"lineless",
] as const;
export type OutlineOption = (typeof OUTLINE_OPTIONS)[number];

/** Camera views accepted by create-character-v3 (spec-vendorizado 2026-07-31). */
export const VIEW_OPTIONS = ["low top-down", "high top-down", "side"] as const;
export type ViewOption = (typeof VIEW_OPTIONS)[number];

/** Skeleton templates for create-character-v3 (spec-vendorizado 2026-07-31). */
export const TEMPLATE_OPTIONS = ["mannequin", "bear", "cat", "dog", "horse", "lion"] as const;
export type TemplateOption = (typeof TEMPLATE_OPTIONS)[number];

/**
 * Frame contract the wizard locks BEFORE the base body is generated. Once
 * `wizard.etapa` reaches "pronto" this is immutable: every pose, item and
 * derived character inherits frameCount/fps/size, and the UI stops offering
 * the choice.
 *
 * With the v3 migration (2026-07-31):
 * - `size` range is now 32–256 (`create-character-v3` from-scratch range;
 *   reference mode is advisory).
 * - `shading` and `guidanceScale` removed — `create-character-v3` has no
 *   `shading` parameter, and `text_guidance_scale` does not exist on the
 *   v3 endpoint.
 * - `detail` and `outline` remain but are IGNORED when `reference_image` is
 *   provided (the progressivo mode); they only apply in from-scratch mode.
 *
 * The quality fields are OPTIONAL and ride the same lock: when present they
 * are threaded into the bitforge and v3 requests; when absent they are
 * OMITTED from the request body (F0-09) so the API defaults apply.
 */
export interface MannequinLock {
	readonly frameCount: 4 | 8 | 16;
	readonly fps: number;
	readonly size: number;
	readonly detail?: DetailOption;
	readonly outline?: OutlineOption;
	readonly view?: ViewOption;
	readonly templateId?: TemplateOption;
	/**
	 * `coverage_percentage` of `/create-image-bitforge` (0–100, "Percentage of
	 * the canvas to cover"). The field exists on that endpoint ALONE — the v3
	 * endpoint has nothing like it. Absent = omitted from the request (F0-09).
	 */
	readonly coverage?: number;
	/**
	 * Trim the shared transparent margin off the 8 directions and resample them
	 * to `size`, so the sprite fills the frame.
	 *
	 * Absent counts as ON. `create-character-v3` pads the canvas ~2x "for
	 * animation room" and offers no flag to stop it, so a frame that fills is
	 * only reachable by post-processing. The paid original is kept in `raw/`.
	 */
	readonly fitFrames?: boolean;
}

export interface Studio {
	readonly version: 2;
	/** Absent until the wizard fixes the frame contract; immutable after. */
	lock?: MannequinLock;
	characters: Character[];
	poses: Pose[];
	wardrobe: WardrobeItem[];
	/** Keyed `${characterId}::${poseId}` or `${characterId}::wardrobe::${itemId}`. */
	cells: Record<string, Cell>;
	/** Canonical palette applied to every generation, as hex strings. */
	palette: string[];
}

export const cellKey = (characterId: string, poseId: string): string =>
	`${characterId}::${poseId}`;

export const wardrobeKey = (characterId: string, itemId: string): string =>
	`${characterId}::wardrobe::${itemId}`;

/**
 * Wizard cells share the cell namespace and the `cellKey` convention
 * (`${characterId}::…`), so they ride the same status/frames machinery.
 */
export const southKey = (characterId: string): string =>
	`${characterId}::__south__`;

/**
 * @deprecated O passo de cardeais foi removido com a migração para
 * create-character-v3 — o v3 rotaciona a reference_image diretamente.
 * Mantido para compatibilidade com dados v2 existentes.
 */
export const cardinalKey = (
	characterId: string,
	direction: "east" | "north" | "west",
): string => `${characterId}::__cardinal-${direction}__`;

export const directions8Key = (characterId: string): string =>
	`${characterId}::__directions8__`;

/**
 * @deprecated O passo de cardeais foi removido com a migração para
 * create-character-v3. Mantido para compatibilidade com dados v2.
 */
export const cardinalsBatchKey = (characterId: string): string =>
	`${characterId}::__cardinals__`;

/**
 * Seed state (studio.json v2).
 *
 * The mannequin is born with an EMPTY description on purpose: the wizard owns
 * the south face from the first boot — the user describes it, iterates on it,
 * and then the 8 directions are generated from it via `create-character-v3`
 * (the cardinals step was removed with the v3 migration). `lock` stays absent
 * until the wizard fixes the frame contract.
 *
 * The five built-in poses are the ones the game needs first. Note that three
 * of them are `action`, not `template` — the template library has no walk, run
 * or jump, and pretending otherwise would silently produce the wrong
 * animation.
 */
export function seedStudio(): Studio {
	const now = new Date().toISOString();
	return {
		version: 2,
		palette: [
			"#0d0b0e",
			"#1c1a21",
			"#302c35",
			"#4a444e",
			"#6b6470",
			"#918a94",
			"#c2bcc4",
			"#eae6ea",
			"#3b1f1c",
			"#6b2f26",
			"#9c4436",
			"#c96f4a",
			"#2a2f1c",
			"#49512c",
			"#6e7a3e",
			"#9aa85a",
			"#1a2430",
			"#28394d",
			"#3d5872",
			"#5f83a3",
			"#4a3520",
			"#6f5030",
			"#9c7345",
			"#c79d63",
		],
		characters: [
			{
				id: "manequim",
				label: "Manequim base",
				silhouette: "humano-medio",
				// Empty on purpose — the wizard's first step is describing the
				// south face. Filling it here would pre-empt the wizard.
				description: "",
				// 128×128 por decisão do projeto: no modo reference_image
				// (progressivo) o image_size é advisory — o modelo escolhe.
				// No modo from-scratch (direto) o teto é 256.
				size: 128,
				seed: 1,
				wizard: { etapa: "sul", southVersions: [], activeSouth: 0 },
				createdAt: now,
			},
		],
		poses: [
			{
				id: "parado",
				label: "Parado",
				kind: "template",
				templateId: "breathing-idle",
				frameCount: 8,
				fps: 6,
				builtin: true,
				notes: "Template nativo. 1 geração por direção — o caminho barato.",
			},
			{
				id: "caminhando",
				label: "Caminhando",
				kind: "action",
				action: "walking forward at a steady pace",
				frameCount: 8,
				fps: 8,
				builtin: true,
				notes:
					"Não existe template de caminhada normal — só crouched-walking. Vai por texto livre.",
			},
			{
				id: "correndo",
				label: "Correndo",
				kind: "action",
				action: "running forward, arms swinging",
				frameCount: 8,
				fps: 12,
				builtin: true,
				notes: "Sem template de corrida. Texto livre.",
			},
			{
				id: "pulando",
				label: "Pulando",
				kind: "action",
				action: "jumping upward, legs tucked",
				frameCount: 8,
				fps: 10,
				builtin: true,
				notes:
					"O template mais próximo é backflip, que é outra coisa. Texto livre.",
			},
			{
				id: "atacando",
				label: "Atacando",
				kind: "template",
				templateId: "attack",
				frameCount: 8,
				fps: 12,
				builtin: true,
				notes:
					"Template nativo. Existem também attack-back, attack-left e attack-right.",
			},
		],
		wardrobe: [],
		cells: {},
	};
}

// ---------------------------------------------------------------------------
// Blocos do mundo — vocabulário do /create-isometric-tile
// ---------------------------------------------------------------------------
//
// Vive AQUI, e não em server/world-block.ts, porque a tela precisa destes
// enums para montar os selects — e world-block.ts importa node:crypto e
// node:fs, que o navegador não tem. Importar de lá quebrava o Sprite Studio
// inteiro com "Module node:crypto has been externalized".
//
// Espelho do spec vendorizado (openapi-v2.json). Mudou lá, muda aqui.

/**
 * As quatro vistas da câmera do editor, em ordem de rotação horária.
 *
 * A ordem É o contrato: o map-builder escolhe a arte com
 * `(facingIndex + rotation) mod 4`, e trocar a ordem aqui gira o mundo
 * inteiro sem que nada mais mude.
 */
export const BLOCK_FACINGS = ['north', 'east', 'south', 'west'] as const;
export type BlockFacing = (typeof BLOCK_FACINGS)[number];

/** Rótulos pt-BR das faces — a UI e os nomes de arquivo do bundle usam estes. */
export const FACING_LABELS: Readonly<Record<BlockFacing, string>> = {
  north: 'norte',
  east: 'leste',
  south: 'sul',
  west: 'oeste',
};

export const TILE_SHAPES = ['block', 'thick tile', 'thin tile'] as const;
export type TileShape = (typeof TILE_SHAPES)[number];

export const TILE_OUTLINES = [
  'single color outline',
  'selective outline',
  'lineless',
] as const;
export type TileOutline = (typeof TILE_OUTLINES)[number];

export const TILE_SHADINGS = [
  'flat shading',
  'basic shading',
  'medium shading',
  'detailed shading',
  'highly detailed shading',
] as const;
export type TileShading = (typeof TILE_SHADINGS)[number];

export const TILE_DETAILS = ['low detail', 'medium detail', 'highly detailed'] as const;
export type TileDetail = (typeof TILE_DETAILS)[number];

/** isometric_tile_size do spec: enum fechado [16, 32]. */
export const TILE_UNIT_SIZES = [16, 32] as const;
export type TileUnitSize = (typeof TILE_UNIT_SIZES)[number];

/**
 * As técnicas de gerar arte para um bloco.
 *
 * 'chained': a norte nasce do molde do cubo e o RESULTADO dela vira o
 * init_image das outras três. 4 gerações de tile. **(ADR 0029, substituída)**
 * 'rotated': a norte de tile vira reference_image do create-character-v3, que
 * rotaciona para 8 direções; as 4 vistas saem de rotation_urls. 1 tile + 1 v3.
 * **(ADR 0029, substituída)**
 * 'texture': UM cubo pixel-art, gerado por create-isometric-tile com o molde
 * como referência (init_image), e animado por animate-with-text-v3 com ação
 * gerada por LLM. A arte não muda com a perspectiva — é um decalque, não um
 * volume. **(ADR 0032)**
 */
export const BLOCK_TECHNIQUES = ['chained', 'rotated', 'texture'] as const;
export type BlockTechnique = (typeof BLOCK_TECHNIQUES)[number];

/**
 * Número de frames de animação da técnica 'texture'.
 *
 * 0 = sem animação: só o cubo base é gerado, o animate-with-text-v3 nunca é
 * chamado (convenção deste módulo — o spec só aceita 4–16). 4, 8 ou 16 são os
 * valores que o /animate-with-text-v3 aceita.
 */
export const ANIMATION_FRAME_COUNTS = [0, 4, 8, 16] as const;
export type AnimationFrameCount = (typeof ANIMATION_FRAME_COUNTS)[number];

/** FPS padrão para animações de bloco. */
export const DEFAULT_BLOCK_ANIMATION_FPS = 8;

