import type { PullRecord } from './types';

export function toView(pull: PullRecord) {
  return {
    id: pull.id,
    packId: pull.packId,
    status: pull.status,
    price: pull.price,
    cards: pull.cards.map((c) => ({ cardId: c.cardId, cardName: c.cardName, rarity: c.rarity, imageUrl: c.imageUrl })),
    failureReason: pull.failureReason,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
  };
}