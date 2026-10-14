import { TIERS, mapRarity } from '../../src/catalog/rarity';

describe('mapRarity', () => {
  test.each([
    ['Common', 'common'],
    ['Uncommon', 'common'],
    ['Rare', 'rare'],
    ['Double Rare', 'rare'],
    ['Rare Holo', 'epic'],
    ['Rare Holo VMAX', 'epic'],
    ['Illustration Rare', 'epic'],
    ['Special Illustration Rare', 'legendary'],
    ['Hyper Rare', 'legendary'],
    ['Rare Secret', 'legendary'],
  ])('%s -> %s', (source, tier) => {
    expect(mapRarity(source)).toEqual({ rarity: tier, known: true });
  });

  test('is case-insensitive and trims whitespace', () => {
    expect(mapRarity('  rare holo ').rarity).toBe('epic');
  });

  test.each([['Totally New Rarity'], [''], [undefined], [null], [42]])(
    'unknown value %p falls back to common',
    (source) => {
      expect(mapRarity(source)).toEqual({ rarity: 'common', known: false });
    },
  );

  test('only produces the 4 known tiers', () => {
    expect(TIERS).toEqual(['common', 'rare', 'epic', 'legendary']);
  });
});
