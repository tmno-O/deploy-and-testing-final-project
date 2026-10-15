import { randomInt } from 'crypto';
import type { PackPool, PoolCard } from '../clients/types';
import { conflict } from '../common/app-error';
import type { Rarity } from './types';

const TIERS: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

/** returns an integer in [0, maxExclusive) — replaceable in tests */
export type Random = (maxExclusive: number) => number;
const secureRandom: Random = (max) => randomInt(max);

function pickTier(weights: { tier: Rarity; weight: number }[], rand: Random): Rarity {
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let roll = (rand(1_000_000) / 1_000_000) * total;
  for (const w of weights) {
    if (roll < w.weight) return w.tier;
    roll -= w.weight;
  }
  return weights[weights.length - 1].tier;
}

/** Draws `cardsPerPack` cards by rarity rates, never using more copies of a card than are in stock. */
export function drawCards(pool: PackPool, rand: Random = secureRandom): PoolCard[] {
  const tiers = new Map<Rarity, PoolCard[]>();
  const left = new Map<string, number>();
  for (const tier of TIERS) {
    const cards = (pool.pool[tier] ?? []).filter((c) => c.available > 0);
    tiers.set(tier, cards);
    for (const c of cards) left.set(c.id, c.available);
  }

  const result: PoolCard[] = [];
  for (let i = 0; i < pool.cardsPerPack; i++) {
    // a tier with no cards left is skipped; the remaining rates are used as they are
    const weights = TIERS.filter((t) => (tiers.get(t)?.length ?? 0) > 0 && (pool.rates[t] ?? 0) > 0).map((t) => ({
      tier: t,
      weight: pool.rates[t],
    }));
    if (weights.length === 0) throw conflict('OUT_OF_STOCK', 'Not enough cards in stock for this pack');

    const tier = pickTier(weights, rand);
    const cards = tiers.get(tier) as PoolCard[];
    const card = cards[rand(cards.length)];
    result.push(card);

    const remaining = (left.get(card.id) ?? 0) - 1;
    left.set(card.id, remaining);
    if (remaining <= 0) tiers.set(tier, cards.filter((c) => c.id !== card.id));
  }
  return result;
}