// Maps the free-text `rarity` of the Pokémon TCG API onto the 4 rarity tiers used by the platform.
import type { Rarity } from './types';

export const TIERS: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

const BY_SOURCE: Record<Rarity, string[]> = {
  common: ['Common', 'Uncommon', 'Promo', 'Classic Collection'],
  rare: ['Rare', 'Double Rare', 'Rare ACE', 'Rare BREAK'],
  epic: [
    'Rare Holo',
    'Rare Holo EX',
    'Rare Holo GX',
    'Rare Holo V',
    'Rare Holo VMAX',
    'Rare Holo VSTAR',
    'Rare Holo LV.X',
    'Rare Holo Star',
    'Rare Prime',
    'Rare Prism Star',
    'Illustration Rare',
    'Ultra Rare',
    'Radiant Rare',
    'Amazing Rare',
    'Shiny Rare',
    'Rare Shiny',
    'Rare Shining',
    'LEGEND',
  ],
  legendary: [
    'Special Illustration Rare',
    'Hyper Rare',
    'Mega Hyper Rare',
    'Shiny Ultra Rare',
    'Black White Rare',
    'Rare Ultra',
    'Rare Secret',
    'Rare Rainbow',
    'Rare Shiny GX',
  ],
};

const LOOKUP = new Map<string, Rarity>();
for (const [tier, names] of Object.entries(BY_SOURCE) as [Rarity, string[]][]) {
  for (const name of names) LOOKUP.set(name.toLowerCase(), tier);
}

/** Unknown or missing source values fall back to `common` (known: false) so the importer can warn. */
export function mapRarity(sourceRarity: unknown): { rarity: Rarity; known: boolean } {
  const key = typeof sourceRarity === 'string' ? sourceRarity.trim().toLowerCase() : '';
  const tier = LOOKUP.get(key);
  return tier ? { rarity: tier, known: true } : { rarity: 'common', known: false };
}
