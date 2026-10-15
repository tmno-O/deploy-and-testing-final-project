import type { Rarity } from '../pulls/types';

export interface PoolCard {
  id: string;
  name: string;
  imageSmall: string;
  rarity: Rarity;
  setId: string;
  available: number;
}

export interface PackPool {
  packId: string;
  cardsPerPack: number;
  rates: Record<Rarity, number>;
  counts: Record<Rarity, number>;
  pool: Record<Rarity, PoolCard[]>;
}

export interface Reservation {
  id: string;
  status: 'reserved' | 'committed' | 'released' | 'expired';
  expiresAt: string;
  items: { cardId: string; qty: number }[];
}

export interface WalletOperation {
  transactionId: string;
  balance: number;
  transaction: { id: string; amount: number; type: string };
}

export interface CollectionAddResult {
  pullId: string;
  created: boolean;
}