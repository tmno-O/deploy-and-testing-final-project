import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StoreService } from '../store/store.service';
import type { CardInfo, CollectionRecord, PullRecord, Rarity } from '../store/types';

export interface CollectionCardView extends CardInfo {
  quantity: number;
  redeemedQuantity: number;
  availableQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export const toCardView = (r: CollectionRecord): CollectionCardView => ({
  cardId: r.cardId,
  cardName: r.cardName,
  cardRarity: r.cardRarity,
  cardImageUrl: r.cardImageUrl,
  quantity: r.quantity,
  redeemedQuantity: r.redeemedQuantity,
  availableQuantity: r.quantity - r.redeemedQuantity,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** All persistence goes through StoreService so a database can replace it later. Writes must run inside store.transaction(). */
@Injectable()
export class CollectionRepository {
  constructor(private readonly store: StoreService) {}

  listByUser(userId: string, rarity?: Rarity): CollectionRecord[] {
    return this.store.data.collections
      .filter((c) => c.userId === userId && (!rarity || c.cardRarity === rarity))
      .sort((a, b) => a.cardId.localeCompare(b.cardId));
  }

  find(userId: string, cardId: string): CollectionRecord | undefined {
    return this.store.data.collections.find((c) => c.userId === userId && c.cardId === cardId);
  }

  findPull(pullId: string): PullRecord | undefined {
    return this.store.data.pulls.find((p) => p.pullId === pullId);
  }

  /** Adds a Gacha pull to the collection and records its pullId so a retry is not applied twice. */
  addFromPull(userId: string, card: CardInfo, quantity: number, pullId: string): CollectionRecord {
    const now = new Date().toISOString();
    let record = this.find(userId, card.cardId);
    if (!record) {
      record = { id: randomUUID(), userId, ...card, quantity: 0, redeemedQuantity: 0, createdAt: now, updatedAt: now };
      this.store.data.collections.push(record);
    }
    record.quantity += quantity;
    record.updatedAt = now;
    this.store.data.pulls.push({ pullId, userId, cardId: card.cardId, quantity, createdAt: now });
    return record;
  }

  /** sign = +1 holds cards for an order, -1 gives them back. */
  adjustRedeemed(userId: string, items: { cardId: string; quantity: number }[], sign: 1 | -1): void {
    const now = new Date().toISOString();
    for (const item of items) {
      const record = this.find(userId, item.cardId);
      if (!record) throw new Error(`collection record missing for ${userId}/${item.cardId}`);
      record.redeemedQuantity += sign * item.quantity;
      record.updatedAt = now;
    }
  }
}
