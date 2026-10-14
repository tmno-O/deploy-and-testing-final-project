export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface Attack {
  name: string;
  cost: string[];
  convertedEnergyCost: number;
  damage: string;
  text: string;
}

export interface Weakness {
  type: string;
  value: string;
}

export interface Card {
  id: string;
  name: string;
  imageSmall: string;
  imageLarge: string;
  rarity: Rarity;
  sourceRarity: string | null;
  setId: string;
  setName: string;
  supertype: string;
  subtypes: string[];
  types: string[];
  hp: number;
  attacks: Attack[];
  weaknesses: Weakness[];
  retreatCost: number;
  artist: string | null;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  priceCredits: number;
  cardsPerPack: number;
  rates: Record<Rarity, number>;
  setIds: string[];
  active: boolean;
}

export interface Stock {
  cardId: string;
  total: number;
  reserved: number;
}

export interface Reservation {
  id: string;
  idempotencyKey: string;
  items: { cardId: string; qty: number }[];
  status: ReservationStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export type ReservationStatus = 'reserved' | 'committed' | 'released' | 'expired';

export interface CatalogData {
  cards: Card[];
  packs: Pack[];
  stock: Stock[];
  reservations: Reservation[];
}
