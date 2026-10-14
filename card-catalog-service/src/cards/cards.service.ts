import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { notFound } from '../common/app-error';
import { idSchema, parseOrThrow } from '../common/parse';
import { CardRepository, StockRepository } from '../catalog/catalog.repositories';
import { TIERS } from '../catalog/rarity';
import { toDetail, toSummary } from '../catalog/views';

const listQuerySchema = z.object({
  q: z.string().trim().min(1).max(50).optional(),
  rarity: z.enum(TIERS as [string, ...string[]]).optional(),
  type: z.string().trim().min(1).max(30).optional(),
  setId: idSchema.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

@Injectable()
export class CardsService {
  constructor(
    private readonly cards: CardRepository,
    private readonly stock: StockRepository,
  ) {}

  list(rawQuery: unknown) {
    const query = parseOrThrow(listQuerySchema, rawQuery);
    const needle = query.q?.toLowerCase();
    const type = query.type?.toLowerCase();

    const matches = this.cards.findAll().filter(
      (card) =>
        (!needle || card.name.toLowerCase().includes(needle)) &&
        (!query.rarity || card.rarity === query.rarity) &&
        (!type || card.types.some((t) => t.toLowerCase() === type)) &&
        (!query.setId || card.setId === query.setId),
    );

    const availability = this.stock.availabilityMap();
    const start = (query.page - 1) * query.limit;
    return {
      data: matches
        .slice(start, start + query.limit)
        .map((card) => toSummary(card, availability.get(card.id) ?? 0)),
      page: query.page,
      limit: query.limit,
      total: matches.length,
      totalPages: Math.ceil(matches.length / query.limit),
    };
  }

  get(rawId: unknown) {
    const id = parseOrThrow(idSchema, rawId);
    const card = this.cards.findById(id);
    if (!card) throw notFound('Card not found', 'CARD_NOT_FOUND');
    return toDetail(card, this.stock.available(card.id));
  }
}
