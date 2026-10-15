import type { Card, CatalogData, Pack, Rarity, Stock } from '../../src/catalog/types';

export function makeCard(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    name: `Card ${id}`,
    imageSmall: `https://images.pokemontcg.io/${id}.png`,
    imageLarge: `https://images.pokemontcg.io/${id}_hires.png`,
    rarity: 'common',
    sourceRarity: 'Common',
    setId: 'setA',
    setName: 'Set A',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    types: ['Grass'],
    hp: 60,
    attacks: [],
    weaknesses: [],
    retreatCost: 1,
    artist: 'Artist',
    ...overrides,
  };
}

export function makePack(id: string, overrides: Partial<Pack> = {}): Pack {
  return {
    id,
    name: `Pack ${id}`,
    description: 'desc',
    priceCredits: 100,
    cardsPerPack: 5,
    rates: { common: 70, rare: 25, epic: 4, legendary: 1 },
    setIds: ['setA', 'setB'],
    active: true,
    ...overrides,
  };
}

export const stockRow = (cardId: string, total: number, reserved = 0): Stock => ({ cardId, total, reserved });

/** Small deterministic catalog used by the integration tests. */
export function makeCatalog(): CatalogData {
  const cards: Card[] = [
    makeCard('a-1', { name: 'Bulbasaur', rarity: 'common', types: ['Grass'] }),
    makeCard('a-2', { name: 'Charmander', rarity: 'common', types: ['Fire'] }),
    makeCard('a-3', { name: 'Charizard', rarity: 'legendary', types: ['Fire'], hp: 120 }),
    makeCard('b-1', { name: 'Pikachu', rarity: 'rare' as Rarity, setId: 'setB', setName: 'Set B', types: ['Lightning'] }),
    makeCard('b-2', { name: 'Mewtwo', rarity: 'epic', setId: 'setB', setName: 'Set B', types: ['Psychic'] }),
    makeCard('c-1', { name: 'Outsider', rarity: 'rare', setId: 'setC', setName: 'Set C' }),
  ];
  return {
    cards,
    packs: [makePack('starter'), makePack('hidden', { active: false }), makePack('onlyA', { setIds: ['setA'] })],
    stock: [
      stockRow('a-1', 10, 4),
      stockRow('a-2', 5, 5), // fully reserved -> not available
      stockRow('a-3', 1),
      stockRow('b-1', 3),
      // b-2 has no stock row -> not available
      stockRow('c-1', 9),
    ],
    reservations: [],
  };
}
