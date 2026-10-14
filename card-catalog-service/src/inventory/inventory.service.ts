import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AppError, badRequest, conflict, gone, notFound, unprocessable } from '../common/app-error';
import { idSchema, parseOrThrow } from '../common/parse';
import {
  CardRepository,
  ReservationRepository,
  StockRepository,
  StockWriter,
} from '../catalog/catalog.repositories';
import type { Reservation } from '../catalog/types';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { idempotencyKeySchema, itemsBodySchema, reservationIdSchema } from './inventory.schemas';

type Item = { cardId: string; qty: number };

/** Terminal reservations are kept this long so a retried request with the same key still gets its answer. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

export function toReservationView(r: Reservation) {
  return {
    id: r.id,
    items: r.items,
    status: r.status,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Stock reservations. Every public method runs synchronously on Node's single thread, so each call is atomic
 * (no lock needed in mock-data mode; a database implementation must wrap these in a transaction).
 */
@Injectable()
export class InventoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventoryService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly cards: CardRepository,
    private readonly stock: StockRepository,
    private readonly stockWriter: StockWriter,
    private readonly reservations: ReservationRepository,
  ) {}

  onModuleInit(): void {
    // background sweep so abandoned reservations free their stock even when nobody calls the API
    this.timer = setInterval(() => this.sweep(), this.config.reservationSweepMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  // ---------- read ----------

  getStock(rawCardId: unknown) {
    const cardId = parseOrThrow(idSchema, rawCardId);
    this.expireDue();
    const row = this.stockWriter.find(cardId);
    if (!this.cards.findById(cardId)) throw notFound('Card not found', 'CARD_NOT_FOUND');
    const total = row?.total ?? 0;
    const reserved = row?.reserved ?? 0;
    return { cardId, total, reserved, available: Math.max(0, total - reserved) };
  }

  /** Read-only: can every requested item be fulfilled right now? Does not hold any stock. */
  check(rawBody: unknown) {
    const items = parseOrThrow(itemsBodySchema, rawBody);
    this.expireDue();
    const results = items.map(({ cardId, qty }) => {
      const known = !!this.cards.findById(cardId);
      const available = known ? this.stock.available(cardId) : 0;
      return { cardId, qty, available, ok: known && available >= qty };
    });
    return { allAvailable: results.every((r) => r.ok), items: results };
  }

  // ---------- reserve ----------

  /**
   * All-or-nothing reservation. Same Idempotency-Key + same items replays the stored reservation (`replayed: true`);
   * same key with different items is rejected so a key can never silently mean two different things.
   */
  reserve(rawKey: unknown, rawBody: unknown): { reservation: Reservation; replayed: boolean } {
    const key = this.parseKey(rawKey);
    const items = parseOrThrow(itemsBodySchema, rawBody);
    this.expireDue();

    const existing = this.reservations.findByKey(key);
    if (existing) {
      if (!sameItems(existing.items, items)) {
        throw unprocessable('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
      }
      return { reservation: existing, replayed: true };
    }

    const shortages: { cardId: string; requested: number; available: number }[] = [];
    for (const { cardId, qty } of items) {
      if (!this.cards.findById(cardId)) throw notFound(`Card ${cardId} not found`, 'CARD_NOT_FOUND');
      const available = this.stock.available(cardId);
      if (available < qty) shortages.push({ cardId, requested: qty, available });
    }
    if (shortages.length > 0) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock for the requested cards', shortages);
    }

    for (const { cardId, qty } of items) this.stockWriter.find(cardId)!.reserved += qty;
    const now = Date.now();
    const reservation: Reservation = {
      id: randomUUID(),
      idempotencyKey: key,
      items,
      status: 'reserved',
      expiresAt: new Date(now + this.config.reservationTtlMs).toISOString(),
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
    this.reservations.add(reservation);
    this.reservations.save();
    return { reservation, replayed: false };
  }

  // ---------- commit / release ----------

  /** Turns a held reservation into a real stock deduction. Repeating a commit is a no-op that returns the same result. */
  commit(rawId: unknown): Reservation {
    const reservation = this.findActiveOrTerminal(rawId, 'committed');
    if (reservation.status === 'committed') return reservation;

    for (const { cardId, qty } of reservation.items) {
      const row = this.stockWriter.find(cardId);
      if (!row) continue;
      row.total = Math.max(0, row.total - qty);
      row.reserved = Math.max(0, row.reserved - qty);
    }
    return this.finish(reservation, 'committed');
  }

  /** Gives held stock back (e.g. payment failed). Repeating a release is a no-op. */
  release(rawId: unknown): Reservation {
    const reservation = this.findActiveOrTerminal(rawId, 'released');
    if (reservation.status === 'released') return reservation;

    this.returnReservedStock(reservation);
    return this.finish(reservation, 'released');
  }

  // ---------- expiry ----------

  /** Expires every due reservation and drops old terminal ones. Returns how many were expired. */
  sweep(): number {
    const expired = this.expireDue();
    const cutoff = Date.now() - RETENTION_MS;
    const removed = this.reservations.removeWhere(
      (r) => r.status !== 'reserved' && Date.parse(r.updatedAt) < cutoff,
    );
    if (expired > 0 || removed > 0) {
      this.reservations.save();
      this.logger.log(`sweep: expired ${expired}, pruned ${removed}`);
    }
    return expired;
  }

  private expireDue(): number {
    const now = Date.now();
    let count = 0;
    for (const r of this.reservations.all()) {
      if (r.status === 'reserved' && Date.parse(r.expiresAt) <= now) {
        this.returnReservedStock(r);
        r.status = 'expired';
        r.updatedAt = new Date(now).toISOString();
        count += 1;
      }
    }
    if (count > 0) this.reservations.save();
    return count;
  }

  // ---------- helpers ----------

  private findActiveOrTerminal(rawId: unknown, wanted: 'committed' | 'released'): Reservation {
    const id = parseOrThrow(reservationIdSchema, rawId);
    this.expireDue();
    const reservation = this.reservations.findById(id);
    if (!reservation) throw notFound('Reservation not found', 'RESERVATION_NOT_FOUND');
    if (reservation.status === 'expired') {
      throw gone('RESERVATION_EXPIRED', 'Reservation expired and its stock was returned');
    }
    if (reservation.status !== 'reserved' && reservation.status !== wanted) {
      throw conflict('RESERVATION_NOT_ACTIVE', `Reservation is already ${reservation.status}`);
    }
    return reservation;
  }

  private returnReservedStock(reservation: Reservation): void {
    for (const { cardId, qty } of reservation.items) {
      const row = this.stockWriter.find(cardId);
      if (row) row.reserved = Math.max(0, row.reserved - qty);
    }
  }

  private finish(reservation: Reservation, status: 'committed' | 'released'): Reservation {
    reservation.status = status;
    reservation.updatedAt = new Date().toISOString();
    this.reservations.save();
    return reservation;
  }

  private parseKey(raw: unknown): string {
    if (raw === undefined) {
      throw badRequest('Idempotency-Key header is required', [{ path: 'Idempotency-Key', message: 'required' }]);
    }
    return parseOrThrow(z.object({ key: idempotencyKeySchema }), { key: raw }).key;
  }
}

function sameItems(a: Item[], b: Item[]): boolean {
  return a.length === b.length && a.every((item, i) => item.cardId === b[i].cardId && item.qty === b[i].qty);
}
