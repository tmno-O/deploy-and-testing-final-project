import type { PackPool, PoolCard } from '../../src/clients/types';
import { drawCards } from '../../src/pulls/draw';
import type { Rarity } from '../../src/pulls/types';

const card = (id: string, rarity: Rarity = 'common', available = 5): PoolCard => ({
  id,
  name: id,
  imageSmall: '',
  rarity,
  setId: 's',
  available,
});

const empty: PackPool['pool'] = { common: [], rare: [], epic: [], legendary: [] };
const rates = { common: 70, rare: 25, epic: 4, legendary: 1 };
const make = (cardsPerPack: number, pool: Partial<PackPool['pool']>): PackPool => ({
  packId: 'p',
  cardsPerPack,
  rates,
  counts: { common: 0, rare: 0, epic: 0, legendary: 0 },
  pool: { ...empty, ...pool },
});

describe('drawCards', () => {
  it('draws cardsPerPack cards', () => {
    expect(drawCards(make(5, { common: [card('a'), card('b')] }))).toHaveLength(5);
  });

  it('never uses more copies of a card than are in stock', () => {
    const pool = make(5, { common: [card('a', 'common', 1), card('b', 'common', 10)] });
    for (let i = 0; i < 200; i++) {
      const copiesOfA = drawCards(pool).filter((c) => c.id === 'a').length;
      expect(copiesOfA).toBeLessThanOrEqual(1);
    }
  });

  it('skips a tier that has no cards left', () => {
    const pool = make(3, { common: [card('a')] }); // rare has a 25% rate but no cards
    for (let i = 0; i < 100; i++) {
      expect(drawCards(pool).every((c) => c.rarity === 'common')).toBe(true);
    }
  });

  it('follows the rates (lowest roll = first tier, highest roll = last tier)', () => {
    const pool = make(1, { common: [card('a')], rare: [card('r', 'rare')] });
    const high = (max: number) => (max === 1_000_000 ? 999_999 : 0);
    expect(drawCards(pool, high)[0].rarity).toBe('rare');
    expect(drawCards(pool, () => 0)[0].rarity).toBe('common');
  });

  it('throws OUT_OF_STOCK when nothing is available', () => {
    expect(() => drawCards(make(2, { common: [card('a', 'common', 0)] }))).toThrow();
  });
});