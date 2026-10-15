import { Injectable } from '@nestjs/common';
import { StoreService } from '../../store/store.service';
import {
  CardRepository,
  InventoryStore,
  PackRepository,
  StockRepository,
  type InventoryTx,
} from '../catalog.repositories';
import type { Card, Pack, Reservation, Stock } from '../types';

/** JSON-file implementations (mock data / local development). Every write persists through StoreService.save(). */

@Injectable()
export class JsonCardRepository extends CardRepository {
  constructor(private readonly store: StoreService) {
    super();
  }

  async findAll(): Promise<Card[]> {
    return this.store.data.cards;
  }

  async findById(id: string): Promise<Card | undefined> {
    return this.store.data.cards.find((card) => card.id === id);
  }

  async add(card: Card): Promise<void> {
    this.store.data.cards.push(card);
    this.store.save();
  }

  async replace(card: Card): Promise<void> {
    this.store.data.cards = this.store.data.cards.map((c) => (c.id === card.id ? card : c));
    this.store.save();
  }
}

@Injectable()
export class JsonPackRepository extends PackRepository {
  constructor(private readonly store: StoreService) {
    super();
  }

  async findActive(): Promise<Pack[]> {
    return this.store.data.packs.filter((pack) => pack.active);
  }

  async findAll(): Promise<Pack[]> {
    return this.store.data.packs;
  }

  async findById(id: string): Promise<Pack | undefined> {
    return this.store.data.packs.find((pack) => pack.id === id);
  }

  async findActiveById(id: string): Promise<Pack | undefined> {
    return this.store.data.packs.find((pack) => pack.id === id && pack.active);
  }

  async add(pack: Pack): Promise<void> {
    this.store.data.packs.push(pack);
    this.store.save();
  }

  async replace(pack: Pack): Promise<void> {
    this.store.data.packs = this.store.data.packs.map((p) => (p.id === pack.id ? pack : p));
    this.store.save();
  }
}

@Injectable()
export class JsonStockRepository extends StockRepository {
  constructor(private readonly store: StoreService) {
    super();
  }

  async availabilityMap(): Promise<Map<string, number>> {
    return new Map(this.store.data.stock.map((s) => [s.cardId, Math.max(0, s.total - s.reserved)]));
  }

  async available(cardId: string): Promise<number> {
    const row = this.store.data.stock.find((s) => s.cardId === cardId);
    return row ? Math.max(0, row.total - row.reserved) : 0;
  }
}

/**
 * Transactions run one at a time (promise-chain mutex) so awaits inside a transaction cannot interleave with another
 * request. This keeps the JSON mode as safe as the old synchronous code. There is no rollback: services validate first.
 */
@Injectable()
export class JsonInventoryStore extends InventoryStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: StoreService) {
    super();
  }

  transaction<T>(fn: (tx: InventoryTx) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      try {
        return await fn(new JsonTx(this.store));
      } finally {
        this.store.save();
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}

class JsonTx implements InventoryTx {
  constructor(private readonly store: StoreService) {}

  async existingCardIds(ids: string[]): Promise<Set<string>> {
    const known = new Set(this.store.data.cards.map((c) => c.id));
    return new Set(ids.filter((id) => known.has(id)));
  }

  async lockStock(cardIds: string[]): Promise<Map<string, Stock>> {
    const wanted = new Set(cardIds);
    return new Map(this.store.data.stock.filter((s) => wanted.has(s.cardId)).map((s) => [s.cardId, s]));
  }

  async saveStock(rows: Stock[]): Promise<void> {
    for (const row of rows) {
      const existing = this.store.data.stock.find((s) => s.cardId === row.cardId);
      if (!existing) this.store.data.stock.push({ ...row });
      else if (existing !== row) Object.assign(existing, row);
    }
  }

  async findReservationByKey(key: string): Promise<Reservation | undefined> {
    return this.store.data.reservations.find((r) => r.idempotencyKey === key);
  }

  async lockReservation(id: string): Promise<Reservation | undefined> {
    return this.store.data.reservations.find((r) => r.id === id);
  }

  async insertReservation(reservation: Reservation): Promise<void> {
    this.store.data.reservations.push(reservation);
  }

  async updateReservation(reservation: Reservation): Promise<void> {
    const i = this.store.data.reservations.findIndex((r) => r.id === reservation.id);
    if (i >= 0) this.store.data.reservations[i] = reservation;
  }

  async lockDueReservations(nowMs: number): Promise<Reservation[]> {
    return this.store.data.reservations.filter((r) => r.status === 'reserved' && Date.parse(r.expiresAt) <= nowMs);
  }

  async deleteSettledBefore(cutoffMs: number): Promise<number> {
    const before = this.store.data.reservations.length;
    this.store.data.reservations = this.store.data.reservations.filter(
      (r) => !(r.status !== 'reserved' && Date.parse(r.updatedAt) < cutoffMs),
    );
    return before - this.store.data.reservations.length;
  }

  async hasActiveReservationFor(cardId: string): Promise<boolean> {
    return this.store.data.reservations.some(
      (r) => r.status === 'reserved' && r.items.some((item) => item.cardId === cardId),
    );
  }

  async deleteCard(cardId: string): Promise<void> {
    this.store.data.cards = this.store.data.cards.filter((c) => c.id !== cardId);
    this.store.data.stock = this.store.data.stock.filter((s) => s.cardId !== cardId);
  }
}
