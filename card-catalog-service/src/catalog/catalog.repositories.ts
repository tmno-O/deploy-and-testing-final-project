import { Injectable } from '@nestjs/common';
import { StoreService } from '../store/store.service';
import type { Card, Pack, Reservation, Stock } from './types';

/** Read access to cards. All persistence goes through StoreService so a database can replace it later. */
@Injectable()
export class CardRepository {
  constructor(private readonly store: StoreService) {}

  findAll(): Card[] {
    return this.store.data.cards;
  }

  findById(id: string): Card | undefined {
    return this.store.data.cards.find((card) => card.id === id);
  }

  add(card: Card): void {
    this.store.data.cards.push(card);
  }

  replace(card: Card): void {
    this.store.data.cards = this.store.data.cards.map((c) => (c.id === card.id ? card : c));
  }

  remove(id: string): void {
    this.store.data.cards = this.store.data.cards.filter((c) => c.id !== id);
  }

  save(): void {
    this.store.save();
  }
}

@Injectable()
export class PackRepository {
  constructor(private readonly store: StoreService) {}

  findActive(): Pack[] {
    return this.store.data.packs.filter((pack) => pack.active);
  }

  /** Includes inactive packs (admin use). */
  findAll(): Pack[] {
    return this.store.data.packs;
  }

  findById(id: string): Pack | undefined {
    return this.store.data.packs.find((pack) => pack.id === id);
  }

  add(pack: Pack): void {
    this.store.data.packs.push(pack);
  }

  replace(pack: Pack): void {
    this.store.data.packs = this.store.data.packs.map((p) => (p.id === pack.id ? pack : p));
  }

  save(): void {
    this.store.save();
  }

  /** Inactive packs are treated as non-existent for public readers. */
  findActiveById(id: string): Pack | undefined {
    return this.store.data.packs.find((pack) => pack.id === id && pack.active);
  }
}

@Injectable()
export class StockRepository {
  constructor(private readonly store: StoreService) {}

  /** cardId -> units that can still be handed out (total - reserved, never negative). */
  availabilityMap(): Map<string, number> {
    return new Map(this.store.data.stock.map((s) => [s.cardId, Math.max(0, s.total - s.reserved)]));
  }

  available(cardId: string): number {
    const row = this.store.data.stock.find((s) => s.cardId === cardId);
    return row ? Math.max(0, row.total - row.reserved) : 0;
  }
}

/** Write access to stock rows. Callers must `store.save()` after a batch of changes. */
@Injectable()
export class StockWriter {
  constructor(private readonly store: StoreService) {}

  find(cardId: string): Stock | undefined {
    return this.store.data.stock.find((s) => s.cardId === cardId);
  }

  upsert(cardId: string, total: number): Stock {
    let row = this.find(cardId);
    if (!row) {
      row = { cardId, total, reserved: 0 };
      this.store.data.stock.push(row);
    } else {
      row.total = total;
    }
    return row;
  }

  remove(cardId: string): void {
    this.store.data.stock = this.store.data.stock.filter((s) => s.cardId !== cardId);
  }

  save(): void {
    this.store.save();
  }
}

@Injectable()
export class ReservationRepository {
  constructor(private readonly store: StoreService) {}

  all(): Reservation[] {
    return this.store.data.reservations;
  }

  findById(id: string): Reservation | undefined {
    return this.store.data.reservations.find((r) => r.id === id);
  }

  findByKey(idempotencyKey: string): Reservation | undefined {
    return this.store.data.reservations.find((r) => r.idempotencyKey === idempotencyKey);
  }

  add(reservation: Reservation): void {
    this.store.data.reservations.push(reservation);
  }

  removeWhere(predicate: (r: Reservation) => boolean): number {
    const before = this.store.data.reservations.length;
    this.store.data.reservations = this.store.data.reservations.filter((r) => !predicate(r));
    return before - this.store.data.reservations.length;
  }

  save(): void {
    this.store.save();
  }
}
