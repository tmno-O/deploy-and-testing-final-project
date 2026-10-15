import { Injectable } from '@nestjs/common';
import { notFound } from '../common/app-error';
import { idSchema, parseOrThrow } from '../common/parse';
import { CardRepository, PackRepository, StockRepository } from '../catalog/catalog.repositories';
import { TIERS } from '../catalog/rarity';
import type { Rarity } from '../catalog/types';
import { toPackView } from '../catalog/views';

interface PoolCard {
  id: string;
  name: string;
  imageSmall: string;
  rarity: Rarity;
  setId: string;
  available: number;
}

@Injectable()
export class PacksService {
  constructor(
    private readonly packs: PackRepository,
    private readonly cards: CardRepository,
    private readonly stock: StockRepository,
  ) {}

  async list() {
    return { data: (await this.packs.findActive()).map(toPackView) };
  }

  async get(rawId: unknown) {
    return toPackView(await this.findOrThrow(rawId));
  }

  /**
   * Cards the Gacha service may draw from, grouped by rarity. Only cards in the pack's sets that are
   * in stock are returned, so an out-of-stock card can never be drawn. Tiers with no stock stay present as [].
   */
  async pool(rawId: unknown) {
    const pack = await this.findOrThrow(rawId);
    const sets = new Set(pack.setIds);
    const availability = await this.stock.availabilityMap();

    const grouped = Object.fromEntries(TIERS.map((tier) => [tier, [] as PoolCard[]])) as Record<
      Rarity,
      PoolCard[]
    >;
    for (const card of await this.cards.findAll()) {
      const available = availability.get(card.id) ?? 0;
      if (!sets.has(card.setId) || available <= 0) continue;
      grouped[card.rarity].push({
        id: card.id,
        name: card.name,
        imageSmall: card.imageSmall,
        rarity: card.rarity,
        setId: card.setId,
        available,
      });
    }

    return {
      packId: pack.id,
      cardsPerPack: pack.cardsPerPack,
      rates: pack.rates,
      pool: grouped,
      counts: Object.fromEntries(TIERS.map((tier) => [tier, grouped[tier].length])) as Record<Rarity, number>,
    };
  }

  private async findOrThrow(rawId: unknown) {
    const id = parseOrThrow(idSchema, rawId);
    const pack = await this.packs.findActiveById(id);
    if (!pack) throw notFound('Pack not found', 'PACK_NOT_FOUND');
    return pack;
  }
}
