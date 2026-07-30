/**
 * The asset catalog.
 *
 * This file is code that evaluates to data. The hash is taken over the resolved
 * data, never over the source text — so refactoring the loops, renaming
 * variables or reformatting costs nothing. That guarantee is what makes this
 * file safe to edit.
 *
 * Seeds are pinned. An unpinned seed is not reproducible, and `plan` refuses it.
 */
import {
  animateCharacter, character8dir, mapObject, tileset, type AssetSpec,
} from '../src/catalog.ts';

/**
 * Canonical palette. Passed to the API so every generation lands on the same
 * colours — the single strongest lever for style consistency across hundreds of
 * assets. Character endpoints take it as a reference image (`color_image` +
 * `force_colors`); image endpoints take a hex array (`palette`).
 *
 * Grim medieval: desaturated steel, dried blood, cold earth.
 */
export const PALETTE = [
  '#0d0b0e', '#1c1a21', '#302c35', '#4a444e',
  '#6b6470', '#918a94', '#c2bcc4', '#eae6ea',
  '#3b1f1c', '#6b2f26', '#9c4436', '#c96f4a',
  '#2a2f1c', '#49512c', '#6e7a3e', '#9aa85a',
  '#1a2430', '#28394d', '#3d5872', '#5f83a3',
  '#4a3520', '#6f5030', '#9c7345', '#c79d63',
] as const;

interface CreatureDef {
  readonly slug: string;
  readonly nome: string;
  readonly prompt: string;
  readonly size: 48 | 64;
  readonly seed: number;
}

/**
 * Creatures. Mirrors docs/02-design — that document is the source of truth for
 * game meaning; this one is the source of truth for generation.
 *
 * Kept short here on purpose: the full 60 belong in the GDD first, so we do not
 * generate art for creatures whose role in the game is undecided.
 */
const CREATURES: readonly CreatureDef[] = [
  {
    slug: 'lobo-esfomeado', nome: 'Lobo esfomeado', size: 64, seed: 1001,
    prompt: 'gaunt grey wolf, matted fur, ribs showing, medieval dark fantasy, top-down',
  },
  {
    slug: 'salteador', nome: 'Salteador', size: 64, seed: 1002,
    prompt: 'ragged human bandit, hood, rusty shortsword, leather scraps, medieval, top-down',
  },
  {
    slug: 'javali-cicatrizado', nome: 'Javali cicatrizado', size: 64, seed: 1003,
    prompt: 'scarred wild boar, broken tusk, bristled hide, medieval dark fantasy, top-down',
  },
];

/**
 * Animations per creature, using `mode: 'template'` — 1 generation per
 * direction. The template library ships exactly what a melee combat game needs.
 */
const ANIMATIONS = [
  { name: 'idle', template: 'breathing-idle' },
  { name: 'walk', template: 'crouched-walking' },
  { name: 'attack', template: 'attack' },
] as const;

const creatureAssets: AssetSpec[] = CREATURES.flatMap((c) => {
  const base = character8dir({
    id: `creature/${c.slug}/base`,
    out: `creatures/${c.slug}/base`,
    description: c.prompt,
    size: c.size,
    seed: c.seed,
    budgetGroup: 'creatures',
  });

  const anims = ANIMATIONS.map((a) =>
    animateCharacter({
      id: `creature/${c.slug}/anim/${a.name}`,
      out: `creatures/${c.slug}/anim/${a.name}`,
      dependsOn: base.id,
      templateAnimationId: a.template,
      seed: c.seed,
      budgetGroup: 'creature-animations',
    }),
  );

  return [base, ...anims];
});

/** Terrain. `view` is forced to low top-down so it matches the characters. */
const tilesetAssets: AssetSpec[] = [
  tileset({
    id: 'terrain/grama-terra', out: 'terrain/grama-terra',
    lower: 'trampled dead grass', upper: 'cold packed dirt',
    tile: 32, seed: 2001, budgetGroup: 'terrain',
  }),
  tileset({
    id: 'terrain/terra-pedra', out: 'terrain/terra-pedra',
    lower: 'cold packed dirt', upper: 'grey flagstone', transition: 'loose gravel',
    tile: 32, seed: 2002, budgetGroup: 'terrain',
  }),
];

/** Props. `map-objects` at US$ 0.0099 instead of the Pro object path at US$ 0.095+. */
const propAssets: AssetSpec[] = [
  { slug: 'barril', prompt: 'weathered wooden barrel, iron bands', seed: 3001 },
  { slug: 'tocha-de-parede', prompt: 'iron wall sconce with burning torch', seed: 3002 },
  { slug: 'bau-de-ferro', prompt: 'small iron-bound wooden chest, closed', seed: 3003 },
].map((p) =>
  mapObject({
    id: `prop/${p.slug}`, out: `props/${p.slug}`,
    description: `${p.prompt}, medieval dark fantasy, pixel art`,
    size: 64, seed: p.seed, budgetGroup: 'props',
  }),
);

const CATALOG: readonly AssetSpec[] = [...creatureAssets, ...tilesetAssets, ...propAssets];

export default CATALOG;
