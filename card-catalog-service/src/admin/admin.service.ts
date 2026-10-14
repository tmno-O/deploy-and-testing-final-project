import { Injectable, Logger } from '@nestjs/common';
import { AppError, conflict, notFound } from '../common/app-error';
import { idSchema, parseOrThrow } from '../common/parse';
import {
  CardRepository,
  PackRepository,
  ReservationRepository,
  StockWriter,
} from '../catalog/catalog.repositories';
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
    private readonly stock: StockWriter,
    private readonly reservations: ReservationRepository,
    private readonly inventory: InventoryService,
  ) {}

  // ---------- cards ----------

  createCard(actor: string, body: unknown) {
    const input = parseOrThrow(cardCreateSchema, body) as Card;
    if (this.cards.findById(input.id)) throw conflict('CARD_EXISTS', `Card ${input.id} already exists`);
    this.cards.add(input);
    this.cards.save();
    this.audit(actor, 'card.create', input.id);
    return toDetail(input, 0);
  }

  updateCard(actor: string, rawId: unknown, body: unknown) {
    const id = parseOrThrow(idSchema, rawId);
    const patch = parseOrThrow(cardPatchSchema, body) as Partial<Card>;
    const existing = this.cards.findById(id);
    if (!existing) throw notFound('Card not found', 'CARD_NOT_FOUND');
    const updated: Card = { ...existing, ...patch, id };
    this.cards.replace(updated);
    this.cards.save();
    this.audit(actor, 'card.update', id);
    return toDetail(updated, this.stockAvailable(id));
  }

  deleteCard(actor: string, rawId: unknown): void {
    const id = parseOrThrow(idSchema, rawId);
    if (!this.cards.findById(id)) throw notFound('Card not found', 'CARD_NOT_FOUND');
    this.inventory.sweep(); // expired holds must not block deletion
    const held = this.reservations
      .all()
      .some((r) => r.status === 'reserved' && r.items.some((item) => item.cardId === id));
    if (held) throw conflict('CARD_IN_USE', 'Card is part of an active reservation');
    this.cards.remove(id);
    this.stock.remove(id);
    this.cards.save();
    this.audit(actor, 'card.delete', id);
  }

  // ---------- packs ----------

  listPacks() {
    return { data: this.packs.findAll() };
  }

  createPack(actor: string, body: unknown) {
    const input = parseOrThrow(packCreateSchema, body) as Pack;
    this.assertRates(input.rates);
    if (this.packs.findById(input.id)) throw conflict('PACK_EXISTS', `Pack ${input.id} already exists`);
    this.packs.add(input);
    this.packs.save();
    this.audit(actor, 'pack.create', input.id);
    return input;
  }

  updatePack(actor: string, rawId: unknown, body: unknown) {
    const id = parseOrThrow(idSchema, rawId);
    const patch = parseOrThrow(packPatchSchema, body) as Partial<Pack>;
    const existing = this.packs.findById(id);
    if (!existing) throw notFound('Pack not found', 'PACK_NOT_FOUND');
    if (patch.rates) this.assertRates(patch.rates);
    const updated: Pack = { ...existing, ...patch, id };
    this.packs.replace(updated);
    this.packs.save();
    this.audit(actor, 'pack.update', id);
    return updated;
  }

  // ---------- inventory ----------

  setStock(actor: string, rawCardId: unknown, body: unknown) {
    const cardId = parseOrThrow(idSchema, rawCardId);
    const { total } = parseOrThrow(stockPutSchema, body);
    if (!this.cards.findById(cardId)) throw notFound('Card not found', 'CARD_NOT_FOUND');
    this.inventory.sweep(); // free expired holds first so `reserved` is accurate
    const reserved = this.stock.find(cardId)?.reserved ?? 0;
    if (total < reserved) {
      throw new AppError(409, 'TOTAL_BELOW_RESERVED', 'Total cannot be lower than the currently reserved quantity', {
        reserved,
      });
    }
    const row = this.stock.upsert(cardId, total);
    this.stock.save();
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

  private stockAvailable(cardId: string): number {
    const row = this.stock.find(cardId);
    return row ? Math.max(0, row.total - row.reserved) : 0;
  }

  /** Who did what; never logs request bodies or credentials. */
  private audit(actor: string, action: string, target: string): void {
    this.logger.log(`${action} ${target} by user ${actor}`);
  }
}
