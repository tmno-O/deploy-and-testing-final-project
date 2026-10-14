// Maps the free-text `rarity` of the Pokémon TCG API onto the 4 rarity tiers used by the platform.
const TIERS = ['common', 'rare', 'epic', 'legendary'];

const BY_SOURCE = {
  common: [
    'Common',
    'Uncommon',
    'Promo',
    'Classic Collection',
  ],
  rare: [
    'Rare',
    'Double Rare',
    'Rare ACE',
    'Rare BREAK',
  ],
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

const LOOKUP = new Map();
for (const [tier, names] of Object.entries(BY_SOURCE)) {
  for (const name of names) LOOKUP.set(name.toLowerCase(), tier);
}

/**
 * @param {string|undefined|null} sourceRarity rarity string from the API
 * @returns {{ rarity: string, known: boolean }} unknown values fall back to `common`
 */
function mapRarity(sourceRarity) {
  const key = typeof sourceRarity === 'string' ? sourceRarity.trim().toLowerCase() : '';
  const tier = LOOKUP.get(key);
  return tier ? { rarity: tier, known: true } : { rarity: 'common', known: false };
}

module.exports = { TIERS, mapRarity };
