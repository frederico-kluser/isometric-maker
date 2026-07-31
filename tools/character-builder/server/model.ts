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
  'south', 'south-west', 'west', 'north-west',
  'north', 'north-east', 'east', 'south-east',
] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIR_SHORT: Record<Direction, string> = {
  south: 'S', 'south-west': 'SW', west: 'W', 'north-west': 'NW',
  north: 'N', 'north-east': 'NE', east: 'E', 'south-east': 'SE',
};

/**
 * The 10 animation templates the API actually ships. Verified against the
 * vendored spec on 2026-07-29 — there are no others.
 *
 * Note what is missing: plain `walk`, `run` and `jump`. Those must go through
 * free-text `action`, which is exactly why this tool supports both kinds.
 */
export const TEMPLATE_ANIMATIONS = [
  'angry', 'attack', 'attack-back', 'attack-left', 'attack-right',
  'backflip', 'bark', 'breathing-idle', 'cross-punch', 'crouched-walking',
] as const;
export type TemplateAnimation = (typeof TEMPLATE_ANIMATIONS)[number];

/** The 18 joint labels `estimate-skeleton` returns and `animate-with-skeleton` accepts. */
export const SKELETON_LABELS = [
  'NOSE', 'NECK',
  'RIGHT SHOULDER', 'RIGHT ELBOW', 'RIGHT ARM',
  'LEFT SHOULDER', 'LEFT ELBOW', 'LEFT ARM',
  'RIGHT HIP', 'RIGHT KNEE', 'RIGHT LEG',
  'LEFT HIP', 'LEFT KNEE', 'LEFT LEG',
  'RIGHT EYE', 'LEFT EYE', 'RIGHT EAR', 'LEFT EAR',
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
  | 'template'
  /** Free-text action through the v3 model. ~1 gen/direction up to 96px, more above. */
  | 'action'
  /** Hand-authored joint positions. Full control, one direction at a time. */
  | 'skeleton';

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
export type Silhouette = 'humano-medio' | 'humano-corpulento' | 'humano-esguio' | 'quadrupede';

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
   * Reference art, south-facing, max 256×256. When present, the creation endpoint
   * freezes *this* as the south direction and generates the other 7 around it.
   */
  referenceImage?: string;
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
export type WardrobeSlot = 'cabeca' | 'torso' | 'pernas' | 'pes' | 'maos' | 'arma' | 'costas';

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

export type CellStatus = 'vazio' | 'na-fila' | 'gerando' | 'pronto' | 'falhou';

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

export interface Studio {
  readonly version: 1;
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
 * Seed state.
 *
 * The base character is deliberately bald and unclothed: it is the mannequin
 * every piece of equipment is derived from, so it must carry no visual opinion
 * of its own.
 *
 * The four built-in poses are the ones the game needs first. Note that three of
 * them are `action`, not `template` — the template library has no walk, run or
 * jump, and pretending otherwise would silently produce the wrong animation.
 */
export function seedStudio(): Studio {
  const now = new Date().toISOString();
  return {
    version: 1,
    palette: [
      '#0d0b0e', '#1c1a21', '#302c35', '#4a444e',
      '#6b6470', '#918a94', '#c2bcc4', '#eae6ea',
      '#3b1f1c', '#6b2f26', '#9c4436', '#c96f4a',
      '#2a2f1c', '#49512c', '#6e7a3e', '#9aa85a',
      '#1a2430', '#28394d', '#3d5872', '#5f83a3',
      '#4a3520', '#6f5030', '#9c7345', '#c79d63',
    ],
    characters: [
      {
        id: 'base-humano',
        label: 'Base — humano',
        silhouette: 'humano-medio',
        description:
          'bald naked humanoid mannequin, neutral skin, no hair, no clothing, ' +
          'no equipment, plain body, medieval dark fantasy pixel art, top-down',
        size: 64,
        seed: 1,
        createdAt: now,
      },
    ],
    poses: [
      {
        id: 'parado', label: 'Parado', kind: 'template',
        templateId: 'breathing-idle', frameCount: 8, fps: 6, builtin: true,
        notes: 'Template nativo. 1 geração por direção — o caminho barato.',
      },
      {
        id: 'caminhando', label: 'Caminhando', kind: 'action',
        action: 'walking forward at a steady pace', frameCount: 8, fps: 8, builtin: true,
        notes: 'Não existe template de caminhada normal — só crouched-walking. Vai por texto livre.',
      },
      {
        id: 'correndo', label: 'Correndo', kind: 'action',
        action: 'running forward, arms swinging', frameCount: 8, fps: 12, builtin: true,
        notes: 'Sem template de corrida. Texto livre.',
      },
      {
        id: 'pulando', label: 'Pulando', kind: 'action',
        action: 'jumping upward, legs tucked', frameCount: 8, fps: 10, builtin: true,
        notes: 'O template mais próximo é backflip, que é outra coisa. Texto livre.',
      },
      {
        id: 'atacando', label: 'Atacando', kind: 'template',
        templateId: 'attack', frameCount: 8, fps: 12, builtin: true,
        notes: 'Template nativo. Existem também attack-back, attack-left e attack-right.',
      },
    ],
    wardrobe: [],
    cells: {},
  };
}
