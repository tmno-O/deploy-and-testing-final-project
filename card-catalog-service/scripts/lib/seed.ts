// Pure helpers used by scripts/import-cards.ts (no network, no file I/O) so they can be unit tested.
import { z } from 'zod';
import { TIERS, mapRarity } from '../../src/catalog/rarity';
import type { CatalogData, Card, Pack, Rarity, Stock } from '../../src/catalog/types';

export const IMAGE_HOST = 'images.pokemontcg.io';

// How many cards of each tier go into the seed (total 160), and the physical stock per card.
export const QUOTAS: Record<Rarity, number> = { common: 60, rare: 40, epic: 40, legendary: 20 };
export const STOCK_TOTAL: Record<Rarity, number> = { common: 200, rare: 80, epic: 25, legendary: 5 };

type PackTemplate = Omit<Pack, 'setIds' | 'active'>;

export const PACKS: PackTemplate[] = [
  {
    id: 'starter',
    name: 'Starter Pack',
    description: 'Entry-level pack, mostly common cards.',
    priceCredits: 100,
    cardsPerPack: 5,
    rates: { common: 70, rare: 25, epic: 4, legendary: 1 },
  },
  {
    id: 'premium',
    name: 'Premium Pack',
    description: 'Better odds for rare and epic cards.',
    priceCredits: 300,
    cardsPerPack: 5,
    rates: { common: 45, rare: 35, epic: 15, legendary: 5 },
  },
  {
    id: 'legendary',
    name: 'Legendary Pack',
    description: 'Highest odds of legendary cards.',
    priceCredits: 1000,
    cardsPerPack: 3,
    rates: { common: 20, rare: 30, epic: 30, legendary: 20 },
  },
];

// Strip control characters and cap length so upstream data cannot inject anything odd into our store.
const text = (max = 500) =>
  z
    .string()
    // eslint-disable-next-line no-control-regex
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max));

const imageUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === IMAGE_HOST;
  } catch {
    return false;
  }
}, `image must be an https URL on ${IMAGE_HOST}`);

const safeId = z.string().regex(/^[A-Za-z0-9._-]{1,40}$/);

const apiCardSchema = z.object({
  id: safeId,
  name: text(100),
  supertype: text(40),
  subtypes: z.array(text(40)).optional().default([]),
  types: z.array(text(40)).optional().default([]),
  hp: z.string().optional(),
  rarity: text(60).optional(),
  artist: text(100).optional(),
  convertedRetreatCost: z.number().int().nonnegative().optional(),
  attacks: z
    .array(
      z.object({
        name: text(100),
        cost: z.array(text(40)).optional().default([]),
        convertedEnergyCost: z.number().int().nonnegative().optional().default(0),
        damage: text(40).optional().default(''),
        text: text(500).optional().default(''),
      }),
    )
    .optional()
    .default([]),
  weaknesses: z.array(z.object({ type: text(40), value: text(20) })).optional().default([]),
  images: z.object({ small: imageUrl, large: imageUrl }),
  set: z.object({ id: safeId, name: text(100) }),
});

/**
 * Validates one raw API card and converts it to our Card model.
 * Returns null when the card is unusable (invalid shape, bad image host, no HP).
 */
export function normalizeCard(raw: unknown): { card: Card; rarityKnown: boolean } | null {
  const parsed = apiCardSchema.safeParse(raw);
  if (!parsed.success) return null;
  const c = parsed.data;

  const hp = c.hp !== undefined ? parseInt(c.hp, 10) : NaN;
  if (!Number.isInteger(hp) || hp <= 0) return null; // we only keep cards that have HP

  const { rarity, known } = mapRarity(c.rarity);
  return {
    rarityKnown: known,
    card: {
      id: c.id,
      name: c.name,
      imageSmall: c.images.small,
      imageLarge: c.images.large,
      rarity,
      sourceRarity: c.rarity ?? null,
      setId: c.set.id,
      setName: c.set.name,
      supertype: c.supertype,
      subtypes: c.subtypes,
      types: c.types,
      hp,
      attacks: c.attacks,
      weaknesses: c.weaknesses,
      retreatCost: c.convertedRetreatCost ?? 0,
      artist: c.artist ?? null,
    },
  };
}

type Pickable = Pick<Card, 'id' | 'setId' | 'rarity'>;

/** Deterministic selection: per tier, take cards round-robin across sets (sorted by id) until the quota is met. */
export function selectCards<T extends Pickable>(cards: T[], quotas: Record<Rarity, number> = QUOTAS): T[] {
  const selected: T[] = [];
  for (const tier of TIERS) {
    const bySet = new Map<string, T[]>();
    for (const card of cards.filter((c) => c.rarity === tier)) {
      const bucket = bySet.get(card.setId) ?? [];
      bucket.push(card);
      bySet.set(card.setId, bucket);
    }
    const buckets = [...bySet.keys()]
      .sort()
      .map((setId) => bySet.get(setId)!.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })));

    let picked = 0;
    for (let round = 0; picked < quotas[tier]; round += 1) {
      const live = buckets.filter((bucket) => round < bucket.length);
      if (live.length === 0) break;
      for (const bucket of live) {
        if (picked >= quotas[tier]) break;
        selected.push(bucket[round]);
        picked += 1;
      }
    }
  }
  return selected;
}

export function buildStock(cards: Pick<Card, 'id' | 'rarity'>[]): Stock[] {
  return cards.map((card) => ({ cardId: card.id, total: STOCK_TOTAL[card.rarity], reserved: 0 }));
}

export function buildPacks(setIds: string[]): Pack[] {
  return PACKS.map((pack) => ({ ...pack, rates: { ...pack.rates }, setIds: [...setIds], active: true }));
}

export function countByRarity(cards: Pick<Card, 'rarity'>[]): Record<Rarity, number> {
  const counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (const card of cards) counts[card.rarity] += 1;
  return counts;
}

export interface SeedReport {
  candidates: number;
  skipped: number;
  unknownRarities: string[];
  counts: Record<Rarity, number>;
}

export function buildSeed(rawCards: unknown[], setIds: string[]): { seed: CatalogData; report: SeedReport } {
  const unknownRarities = new Set<string>();
  let skipped = 0;
  const seen = new Set<string>();
  const candidates: Card[] = [];

  for (const raw of rawCards) {
    const result = normalizeCard(raw);
    if (!result || seen.has(result.card.id)) {
      skipped += 1;
      continue;
    }
    seen.add(result.card.id);
    if (!result.rarityKnown) unknownRarities.add(result.card.sourceRarity ?? '(none)');
    candidates.push(result.card);
  }

  const cards = selectCards(candidates);
  return {
    seed: { cards, packs: buildPacks(setIds), stock: buildStock(cards), reservations: [] },
    report: {
      candidates: candidates.length,
      skipped,
      unknownRarities: [...unknownRarities],
      counts: countByRarity(cards),
    },
  };
}
