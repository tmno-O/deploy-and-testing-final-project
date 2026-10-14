import type { Card, Pack, Rarity } from './types';

export interface CardSummary {
  id: string;
  name: string;
  imageSmall: string;
  rarity: Rarity;
  setId: string;
  setName: string;
  types: string[];
  hp: number;
  available: number;
}

export type CardDetail = Card & { available: number };

export function toSummary(card: Card, available: number): CardSummary {
  return {
    id: card.id,
    name: card.name,
    imageSmall: card.imageSmall,
    rarity: card.rarity,
    setId: card.setId,
    setName: card.setName,
    types: card.types,
    hp: card.hp,
    available,
  };
}

export function toDetail(card: Card, available: number): CardDetail {
  return { ...card, available };
}

/** Public pack view (explicit fields so internal fields added later are not leaked by accident). */
export function toPackView(pack: Pack) {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    priceCredits: pack.priceCredits,
    cardsPerPack: pack.cardsPerPack,
    rates: pack.rates,
    setIds: pack.setIds,
  };
}
