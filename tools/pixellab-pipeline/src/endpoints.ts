/**
 * The endpoints this pipeline actually calls, with their shape constraints.
 *
 * Every limit here was extracted from the vendored spec at
 * openapi/openapi-v2.json (captured 2026-07-29). Validating shape locally
 * matters because a 422 arrives *after* submission, and submission is where the
 * money leaves.
 *
 * The vendored spec has 56 POST endpoints; we deliberately model only the ones
 * we use. Adding one means reading the spec, not guessing.
 */

export const ENDPOINT_IDS = [
	"create-character-with-4-directions",
	"create-character-with-8-directions",
	"create-character-v3",
	"create-character-pro",
	"create-character-state",
	"animate-character",
	"animate-with-skeleton",
	"animate-with-text-v3",
	"estimate-skeleton",
	// `/generate-8-rotations-v2` also exists in the spec (32–168 px, method enum,
	// concept/reference/description inputs) but we model only v3 because v3 is the
	// strictly-a-rotator we actually call. v2 can also create characters from scratch
	// and its return-order documentation is what DIRECTIONS_8 encodes below.
	"generate-8-rotations-v3",
	"rotate",
	"create-image-pixflux",
	"create-image-bitforge",
	"create-image-pixen",
	"image-to-pixelart",
	"inpaint-v3",
	"remove-background",
	"create-tileset",
	"create-isometric-tile",
	"map-objects",
	"create-8-direction-object",
	"create-ui-asset",
] as const;

export type EndpointId = (typeof ENDPOINT_IDS)[number];

export const CAMERA_VIEWS = ["side", "low top-down", "high top-down"] as const;
export type CameraView = (typeof CAMERA_VIEWS)[number];

/** Return order of `/generate-8-rotations-v2`, verbatim from its spec text. NOT
 *  an order for `/create-character-with-8-directions`: that returns a dict. */
export const DIRECTIONS_8 = [
	"south",
	"south-west",
	"west",
	"north-west",
	"north",
	"north-east",
	"east",
	"south-east",
] as const;
export type Direction8 = (typeof DIRECTIONS_8)[number];

/**
 * Allowed keys for the `directions` map on `/create-character-with-8-directions`.
 * From the spec's `propertyNames.enum` — clockwise from south (the *layout* order).
 * This is the mirror of DIRECTIONS_8: the spec draws S→SE→E→NE→N→NW→W→SW, while
 * DIRECTIONS_8 (the v2 return order) runs S→SW→W→NW→N→NE→E→SE.
 *
 * Index by key name, never by position — the endpoint returns a dictionary.
 *
 *Quadruped templates (`bear`, `cat`, `dog`, `horse`, `lion`) additionally require
 * `east` when any reference is given.
 *
 * @see spec `CreateCharacterWith8DirectionsRequest.directions.propertyNames.enum`
 */
export const DIRECTION_KEYS = [
	"south",
	"south-east",
	"east",
	"north-east",
	"north",
	"north-west",
	"west",
	"south-west",
] as const;
export type DirectionKey = (typeof DIRECTION_KEYS)[number];

/** Templates the spec classifies as quadrupeds for directions validation. */
export const QUADRUPED_TEMPLATES = [
	"bear",
	"cat",
	"dog",
	"horse",
	"lion",
] as const;

export const OUTLINES = [
	"single color black outline",
	"single color outline",
	"selective outline",
	"lineless",
] as const;
export const SHADINGS = [
	"flat shading",
	"basic shading",
	"medium shading",
	"detailed shading",
	"highly detailed shading",
] as const;
export const DETAILS = [
	"low detail",
	"medium detail",
	"highly detailed",
] as const;

export interface SizeConstraint {
	readonly min: number;
	readonly max: number;
	/** Some endpoints require the dimension to be a multiple of this. */
	readonly multipleOf?: number;
	/** Only these exact values are accepted. */
	readonly oneOf?: readonly number[];
	/** Cap on width * height, independent of the per-axis cap. */
	readonly maxArea?: number;
	/** Human note surfaced in validation errors. */
	readonly note?: string;
}

export interface EndpointDescriptor {
	readonly id: EndpointId;
	readonly path: string;
	/** Whether the response is 202 + background_job_id. */
	readonly async: boolean;
	readonly size?: SizeConstraint;
	/**
	 * `create-character-with-{4,8}-directions` document: "Canvas will be ~40%
	 * larger to make room for animations." Asking for 64 returns roughly 90px
	 * frames. The atlas must crop against the real canvas, not the requested size.
	 */
	readonly canvasInflation?: number;
}

export const ENDPOINTS: Readonly<Record<EndpointId, EndpointDescriptor>> = {
	"create-character-with-4-directions": {
		id: "create-character-with-4-directions",
		path: "/create-character-with-4-directions",
		async: true,
		canvasInflation: 1.4,
		size: {
			min: 16,
			max: 128,
			note: "canvas sai ~40% maior que o tamanho pedido",
		},
	},
	"create-character-with-8-directions": {
		id: "create-character-with-8-directions",
		path: "/create-character-with-8-directions",
		async: true,
		canvasInflation: 1.4,
		size: {
			min: 16,
			max: 128,
			note: "canvas sai ~40% maior que o tamanho pedido",
		},
	},
	"create-character-v3": {
		id: "create-character-v3",
		path: "/create-character-v3",
		async: true,
		size: {
			min: 32,
			max: 256,
			note: "advisório: no modo referência o modelo escolhe o tamanho",
		},
	},
	"create-character-pro": {
		id: "create-character-pro",
		path: "/create-character-pro",
		async: true,
		size: { min: 32, max: 168 },
	},
	"create-character-state": {
		id: "create-character-state",
		path: "/create-character-state",
		async: true,
	},
	"animate-character": {
		id: "animate-character",
		path: "/animate-character",
		async: true,
	},
	"animate-with-skeleton": {
		id: "animate-with-skeleton",
		path: "/animate-with-skeleton",
		async: false,
		size: { min: 16, max: 256, oneOf: [16, 32, 64, 128, 256] },
	},
	"animate-with-text-v3": {
		id: "animate-with-text-v3",
		path: "/animate-with-text-v3",
		async: true,
		size: { min: 32, max: 256, note: "width × height × frame_count ≤ 524288" },
	},
	"estimate-skeleton": {
		id: "estimate-skeleton",
		path: "/estimate-skeleton",
		async: false,
		size: { min: 16, max: 256 },
	},
	"generate-8-rotations-v3": {
		id: "generate-8-rotations-v3",
		path: "/generate-8-rotations-v3",
		async: true,
		size: { min: 32, max: 256, note: "first_frame até 256×256" },
	},
	rotate: {
		id: "rotate",
		path: "/rotate",
		async: false,
		size: { min: 16, max: 200 },
	},
	"create-image-pixflux": {
		id: "create-image-pixflux",
		path: "/create-image-pixflux",
		async: false,
		size: { min: 16, max: 400 },
	},
	"create-image-bitforge": {
		id: "create-image-bitforge",
		path: "/create-image-bitforge",
		async: false,
		size: { min: 16, max: 200 },
	},
	"create-image-pixen": {
		id: "create-image-pixen",
		path: "/create-image-pixen",
		async: false,
		size: { min: 16, max: 768, multipleOf: 4, maxArea: 512 * 512 },
	},
	"image-to-pixelart": {
		id: "image-to-pixelart",
		path: "/image-to-pixelart",
		async: false,
		size: { min: 16, max: 1280 },
	},
	"inpaint-v3": { id: "inpaint-v3", path: "/inpaint-v3", async: true },
	"remove-background": {
		id: "remove-background",
		path: "/remove-background",
		async: false,
		size: { min: 1, max: 400 },
	},
	"create-tileset": {
		id: "create-tileset",
		path: "/create-tileset",
		async: true,
		size: {
			min: 16,
			max: 64,
			oneOf: [16, 32, 64],
			note: "tile 64px exige mode='pro'",
		},
	},
	"create-isometric-tile": {
		id: "create-isometric-tile",
		path: "/create-isometric-tile",
		async: true,
		size: {
			min: 16,
			max: 64,
			note: "acima de 24px costuma dar melhor resultado",
		},
	},
	"map-objects": {
		id: "map-objects",
		path: "/map-objects",
		async: true,
		size: {
			min: 32,
			max: 400,
			maxArea: 400 * 400,
			note: "com inpainting o limite cai para área de 192×192",
		},
	},
	"create-8-direction-object": {
		id: "create-8-direction-object",
		path: "/create-8-direction-object",
		async: true,
		size: { min: 32, max: 168 },
	},
	"create-ui-asset": {
		id: "create-ui-asset",
		path: "/create-ui-asset",
		async: true,
		size: { min: 192, max: 688, note: "quadrado máx 512; 16:9 máx 688" },
	},
};

export interface ImageSize {
	readonly width: number;
	readonly height: number;
}

/**
 * Validates an image size against the endpoint's documented constraints.
 * Returns a list of human-readable problems, empty when valid.
 */
export function validateSize(endpoint: EndpointId, size: ImageSize): string[] {
	const c = ENDPOINTS[endpoint].size;
	if (!c) return [];
	const problems: string[] = [];
	const { width: w, height: h } = size;

	for (const [label, v] of [
		["width", w],
		["height", h],
	] as const) {
		if (!Number.isInteger(v))
			problems.push(`${label} precisa ser inteiro (recebido ${v})`);
		if (v < c.min || v > c.max) {
			problems.push(`${label}=${v} fora da faixa ${c.min}–${c.max}`);
		}
		if (c.multipleOf && v % c.multipleOf !== 0) {
			problems.push(`${label}=${v} precisa ser múltiplo de ${c.multipleOf}`);
		}
		if (c.oneOf && !c.oneOf.includes(v)) {
			problems.push(`${label}=${v} precisa ser um de ${c.oneOf.join(", ")}`);
		}
	}
	if (c.maxArea && w * h > c.maxArea) {
		problems.push(`área ${w}×${h}=${w * h} passa do máximo ${c.maxArea}`);
	}
	if (problems.length > 0 && c.note) problems.push(`nota: ${c.note}`);
	return problems;
}

/** `animate-with-text-v3` constrains the product, not the axes. */
export function validateFrameBudget(
	size: ImageSize,
	frameCount: number,
): string[] {
	const LIMIT = 524_288;
	const product = size.width * size.height * frameCount;
	if (product > LIMIT) {
		return [
			`width × height × frame_count = ${size.width}×${size.height}×${frameCount} = ` +
				`${product}, acima do limite ${LIMIT}`,
		];
	}
	if (![4, 8, 16].includes(frameCount)) {
		return [`frame_count=${frameCount} precisa ser 4, 8 ou 16`];
	}
	return [];
}
