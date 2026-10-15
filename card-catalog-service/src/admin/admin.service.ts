import { Injectable, Logger } from '@nestjs/common';
import { AppError, conflict, notFound } from '../common/app-error';
import { idSchema, parseOrThrow } from '../common/parse';
import { CardRepository, PackRepository, StockRepository } from '../catalog/catalog.repositories';
import type { Card, Pack } from '../catalog/types';
import { toDetail } from '../catalog/views';
import { InventoryService } from '../inventory/inventory.service';
import {
  cardCreateSchema,
  cardPatchSchema,
  packCreateSchema,
  packPatchSchema,
  stockPutSchema,
} from './admin.schemas';

@Injectable()
export class AdminService {
  private readonly logger = new Logger('Admin');

  constructor(
    private readonly cards: CardRepository,
    private readonly packs: PackRepository,
    private readonly stocks: StockRepository,
    private readonly inventory: InventoryService,
  ) {}

  // ---------- cards ----------

  async createCard(actor: string, body: unknown) {
    const input = parseOrThrow(cardCreateSchema, body) as Card;
    if (await this.cards.findById(input.id)) throw conflict('CARD_EXISTS', `Card ${input.id} already exists`);
    await this.cards.add(input);
    this.audit(actor, 'card.create', input.id);
    return toDetail(input, 0);
  }

  async updateCard(actor: string, rawId: unknown, body: unknown) {
    const id = parseOrThrow(idSchema, rawId);
    const patch = parseOrThrow(cardPatchSchema, body) as Partial<Card>;
    const existing = await this.cards.findById(id);
    if (!existing) throw notFound('Card not found', 'CARD_NOT_FOUND');
    const updated: Card = { ...existing, ...patch, id };
    await this.cards.replace(updated);
    this.audit(actor, 'card.update', id);
    return toDetail(updated, await this.stockAvailable(id));
  }

  async deleteCard(actor: string, rawId: unknown): Promise<void> {
    const id = parseOrThrow(idSchema, rawId);
    // fresh stock: expired holds must not block deletion
    await this.inventory.withFreshStock(async (tx) => {
      if (!(await tx.existingCardIds([id])).has(id)) throw notFound('Card not found', 'CARD_NOT_FOUND');
      await tx.lockStock([id]); // serialises with reservations of this card
      if (await tx.hasActiveReservationFor(id)) {
        throw conflict('CARD_IN_USE', 'Card is part of an active reservation');
      }
      await tx.deleteCard(id);
    });
    this.audit(actor, 'card.delete', id);
  }

  // ---------- packs ----------

  async listPacks() {
    return { data: await this.packs.findAll() };
  }

  async createPack(actor: string, body: unknown) {
    const input = parseOrThrow(packCreateSchema, body) as Pack;
    this.assertRates(input.rates);
    if (await this.packs.findById(input.id)) throw conflict('PACK_EXISTS', `Pack ${input.id} already exists`);
    await this.packs.add(input);
    this.audit(actor, 'pack.create', input.id);
    return input;
  }

  async updatePack(actor: string, rawId: unknown, body: unknown) {
    const id = parseOrThrow(idSchema, rawId);
    const patch = parseOrThrow(packPatchSchema, body) as Partial<Pack>;
    const existing = await this.packs.findById(id);
    if (!existing) throw notFound('Pack not found', 'PACK_NOT_FOUND');
    if (patch.rates) this.assertRates(patch.rates);
    const updated: Pack = { ...existing, ...patch, id };
    await this.packs.replace(updated);
    this.audit(actor, 'pack.update', id);
    return updated;
  }

  // ---------- inventory ----------

  async setStock(actor: string, rawCardId: unknown, body: unknown) {
    const cardId = parseOrThrow(idSchema, rawCardId);
    const { total } = parseOrThrow(stockPutSchema, body);
    // fresh stock: free expired holds first so `reserved` is accurate
    const row = await this.inventory.withFreshStock(async (tx) => {
      if (!(await tx.existingCardIds([cardId])).has(cardId)) throw notFound('Card not found', 'CARD_NOT_FOUND');
      const current = (await tx.lockStock([cardId])).get(cardId);
      const reserved = current?.reserved ?? 0;
      if (total < reserved) {
        throw new AppError(409, 'TOTAL_BELOW_RESERVED', 'Total cannot be lower than the currently reserved quantity', {
          reserved,
        });
      }
      const saved = { cardId, total, reserved };
      await tx.saveStock([saved]);
      return saved;
    });
    this.audit(actor, 'stock.set', `${cardId}=${total}`);
    return { cardId, total: row.total, reserved: row.reserved, available: row.total - row.reserved };
  }

  // ---------- helpers ----------

  private assertRates(rates: Record<string, number>): void {
    const sum = Object.values(rates).reduce((a, b) => a + b, 0);
    if (sum !== 100) {
      throw new AppError(422, 'INVALID_RATES', 'Rates must add up to exactly 100', { sum });
    }
  }

  private stockAvailable(cardId: string): Promise<number> {
    return this.stocks.available(cardId);
  }

  /** Who did what; never logs request bodies or credentials. */
  private audit(actor: string, action: string, target: string): void {
    this.logger.log(`${action} ${target} by user ${actor}`);
  }
}
