import * as fs from 'fs';
import * as path from 'path';
import { normalizeCard, selectCards, buildSeed, PACKS, QUOTAS } from '../../scripts/lib/seed';
import type { CatalogData, Rarity } from '../../src/catalog/types';

function rawCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sv3pt5-1',
    name: 'Bulbasaur',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    types: ['Grass'],
    hp: '70',
    rarity: 'Common',
    artist: 'Someone',
    convertedRetreatCost: 1,
    attacks: [{ name: 'Vine Whip', cost: ['Grass'], convertedEnergyCost: 1, damage: '20', text: '' }],
    weaknesses: [{ type: 'Fire', value: '×2' }],
    images: {
      small: 'https://images.pokemontcg.io/sv3pt5/1.png',
      large: 'https://images.pokemontcg.io/sv3pt5/1_hires.png',
    },
    set: { id: 'sv3pt5', name: '151' },
    ...overrides,
  };
}

describe('normalizeCard', () => {
  test('converts a valid API card to the Card model', () => {
    const { card, rarityKnown } = normalizeCard(rawCard())!;
    expect(rarityKnown).toBe(true);
    expect(card).toMatchObject({
      id: 'sv3pt5-1',
      rarity: 'common',
      sourceRarity: 'Common',
      setId: 'sv3pt5',
      hp: 70,
      retreatCost: 1,
    });
  });

  test('rejects cards without a usable HP', () => {
    expect(normalizeCard(rawCard({ hp: undefined }))).toBeNull();
    expect(normalizeCard(rawCard({ hp: 'abc' }))).toBeNull();
    expect(normalizeCard(rawCard({ hp: '0' }))).toBeNull();
  });

  test('rejects image URLs outside the official image host', () => {
    const images = { small: 'https://evil.example/a.png', large: 'https://images.pokemontcg.io/a.png' };
    expect(normalizeCard(rawCard({ images }))).toBeNull();
    expect(normalizeCard(rawCard({ images: { small: 'javascript:alert(1)', large: 'x' } }))).toBeNull();
  });

  test('rejects ids with unexpected characters', () => {
    expect(normalizeCard(rawCard({ id: '../etc/passwd' }))).toBeNull();
  });

  test('strips control characters from text fields', () => {
    const { card } = normalizeCard(rawCard({ name: 'Bulba\u0000saur\n' }))!;
    expect(card.name).toBe('Bulba saur');
  });

  test('flags unknown rarity and keeps the original', () => {
    const result = normalizeCard(rawCard({ rarity: 'Mystery' }))!;
    expect(result.rarityKnown).toBe(false);
    expect(result.card).toMatchObject({ rarity: 'common', sourceRarity: 'Mystery' });
  });
});

describe('selectCards', () => {
  const make = (id: string, setId: string, rarity: Rarity) => ({ id, setId, rarity });

  test('respects quotas and spreads picks across sets', () => {
    const cards = [
      make('a-1', 'a', 'rare'), make('a-2', 'a', 'rare'), make('a-3', 'a', 'rare'),
      make('b-1', 'b', 'rare'), make('b-2', 'b', 'rare'),
    ];
    const picked = selectCards(cards, { common: 0, rare: 4, epic: 0, legendary: 0 });
    expect(picked.map((c) => c.id)).toEqual(['a-1', 'b-1', 'a-2', 'b-2']);
  });

  test('is deterministic regardless of input order and uses natural id order', () => {
    const cards = [make('a-10', 'a', 'epic'), make('a-2', 'a', 'epic'), make('a-1', 'a', 'epic')];
    const quotas = { common: 0, rare: 0, epic: 2, legendary: 0 };
    expect(selectCards(cards, quotas).map((c) => c.id)).toEqual(['a-1', 'a-2']);
    expect(selectCards([...cards].reverse(), quotas).map((c) => c.id)).toEqual(['a-1', 'a-2']);
  });

  test('returns fewer cards when a tier has too few candidates', () => {
    const picked = selectCards([make('a-1', 'a', 'common')], QUOTAS);
    expect(picked).toHaveLength(1);
  });
});

describe('buildSeed', () => {
  test('skips invalid and duplicate cards and builds consistent stock and packs', () => {
    const raws = [rawCard(), rawCard(), rawCard({ id: 'x-2', hp: undefined }), rawCard({ id: 'sv3pt5-2', rarity: 'Hyper Rare' })];
    const { seed, report } = buildSeed(raws, ['sv3pt5']);

    expect(report.candidates).toBe(2);
    expect(report.skipped).toBe(2);
    expect(seed.cards.map((c) => c.id).sort()).toEqual(['sv3pt5-1', 'sv3pt5-2']);
    expect(seed.stock).toHaveLength(2);
    expect(seed.stock.every((s) => s.reserved === 0 && s.total > 0)).toBe(true);
    expect(seed.packs).toHaveLength(PACKS.length);
    expect(seed.packs[0].setIds).toEqual(['sv3pt5']);
    expect(seed.reservations).toEqual([]);
  });

  test('rarer cards get less stock', () => {
    const { seed } = buildSeed([rawCard(), rawCard({ id: 'sv3pt5-2', rarity: 'Hyper Rare' })], ['sv3pt5']);
    const total = (id: string) => seed.stock.find((s) => s.cardId === id)!.total;
    expect(total('sv3pt5-2')).toBeLessThan(total('sv3pt5-1'));
  });

  test('every pack has rates that sum to 100', () => {
    for (const pack of PACKS) {
      expect(Object.values(pack.rates).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });
});

describe('committed seed file', () => {
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'mock-data.json'), 'utf8'),
  ) as CatalogData;

  test('has cards in all four tiers with one stock row per card', () => {
    const tiers = new Set(data.cards.map((c) => c.rarity));
    expect([...tiers].sort()).toEqual(['common', 'epic', 'legendary', 'rare']);
    expect(data.stock.map((s) => s.cardId).sort()).toEqual(data.cards.map((c) => c.id).sort());
  });

  test('card ids are unique and every card has an HP', () => {
    expect(new Set(data.cards.map((c) => c.id)).size).toBe(data.cards.length);
    expect(data.cards.every((c) => Number.isInteger(c.hp) && c.hp > 0)).toBe(true);
  });

  test('pack rates sum to 100 and only reference imported sets', () => {
    const sets = new Set(data.cards.map((c) => c.setId));
    for (const pack of data.packs) {
      expect(Object.values(pack.rates).reduce((a, b) => a + b, 0)).toBe(100);
      expect(pack.setIds.every((id) => sets.has(id))).toBe(true);
    }
  });
});
