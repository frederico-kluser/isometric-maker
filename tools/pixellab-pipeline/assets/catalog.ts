/**
 * The asset catalog — demo edition.
 *
 * This file is code that evaluates to data. The hash is taken over the resolved
 * data, never over the source text — so refactoring the loops, renaming
 * variables or reformatting costs nothing. That guarantee is what makes this
 * file safe to edit.
 *
 * Seeds are pinned. An unpinned seed is not reproducible, and `plan` refuses it.
 *
 * Intentionally small: one character, one tileset, one prop. It exists so that
 * `plan`, `estimate` and the idempotency test have something to resolve without
 * spending money on a full game's worth of assets.
 */
import {
  animateCharacter, character8dir, mapObject, tileset, type AssetSpec,
} from '../src/catalog.ts';

/**
 * Canonical palette. Passed to the API so every generation lands on the same
 * colours — the single strongest lever for style consistency.
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

/**
 * One demo character: base sprite + three template animations.
 *
 * The animation templates (`breathing-idle`, `crouched-walking`, `attack`) are
 * the three ids inside the spec's visible prefix — the only ones safe to use
 * without running a live probe.
 */
const creatureAssets: AssetSpec[] = (() => {
  const base = character8dir({
    id: 'creature/lobo-esfomeado/base',
    out: 'creatures/lobo-esfomeado/base',
    description: 'gaunt grey wolf, matted fur, ribs showing, medieval dark fantasy, top-down',
    size: 64,
    seed: 1001, // pinned — nunca mude sem querer pagar de novo
    budgetGroup: 'creatures',
  });

  const anims = ([
    { name: 'idle', template: 'breathing-idle' },
    { name: 'walk', template: 'crouched-walking' },
    { name: 'attack', template: 'attack' },
  ] as const).map((a) =>
    animateCharacter({
      id: `creature/lobo-esfomeado/anim/${a.name}`,
      out: `creatures/lobo-esfomeado/anim/${a.name}`,
      dependsOn: base.id,
      templateAnimationId: a.template,
      seed: 1001, // mesmo seed do base — a animação depende dos frames do personagem
      budgetGroup: 'creature-animations',
    }),
  );

  return [base, ...anims];
})();

/** One terrain tileset. `view` é forçado para `low top-down` para casar com o personagem. */
const tilesetAssets: AssetSpec[] = [
  tileset({
    id: 'terrain/grama-terra', out: 'terrain/grama-terra',
    lower: 'trampled dead grass', upper: 'cold packed dirt',
    tile: 32, seed: 2001, budgetGroup: 'terrain',
  }),
];

/** One prop, via `map-objects` (~US$ 0.0099). */
const propAssets: AssetSpec[] = [
  mapObject({
    id: 'prop/barril', out: 'props/barril',
    description: 'weathered wooden barrel, iron bands, medieval dark fantasy, pixel art',
    size: 64, seed: 3001, budgetGroup: 'props',
  }),
];

const CATALOG: readonly AssetSpec[] = [...creatureAssets, ...tilesetAssets, ...propAssets];

export default CATALOG;
