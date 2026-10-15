import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AppError, badRequest, conflict, gone, notFound, unprocessable } from '../common/app-error';
import { idSchema, parseOrThrow } from '../common/parse';
import { InventoryStore, type InventoryTx } from '../catalog/catalog.repositories';
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
 * Stock reservations. Every public method runs in one InventoryStore transaction: in PostgreSQL the stock rows are
 * locked (SELECT ... FOR UPDATE) so concurrent requests cannot oversell; in JSON mode transactions run one at a time.
 */
@Injectable()
export class InventoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventoryService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly store: InventoryStore,
  ) {}

  onModuleInit(): void {
    // background sweep so abandoned reservations free their stock even when nobody calls the API
    this.timer = setInterval(() => {
      this.sweep().catch((err: unknown) => this.logger.error(`sweep failed: ${String(err)}`));
    }, this.config.reservationSweepMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Runs `fn` in a transaction after expired holds were returned, so `reserved` is accurate (admin operations). */
  withFreshStock<T>(fn: (tx: InventoryTx) => Promise<T>): Promise<T> {
    return this.store.transaction(async (tx) => {
      await this.expireDue(tx);
      return fn(tx);
    });
  }

  // ---------- read ----------

  async getStock(rawCardId: unknown) {
    const cardId = parseOrThrow(idSchema, rawCardId);
    return this.store.transaction(async (tx) => {
      await this.expireDue(tx);
      if (!(await tx.existingCardIds([cardId])).has(cardId)) throw notFound('Card not found', 'CARD_NOT_FOUND');
      const row = (await tx.lockStock([cardId])).get(cardId);
      const total = row?.total ?? 0;
      const reserved = row?.reserved ?? 0;
      return { cardId, total, reserved, available: Math.max(0, total - reserved) };
    });
  }

  /** Read-only: can every requested item be fulfilled right now? Does not hold any stock. */
  async check(rawBody: unknown) {
    const items = parseOrThrow(itemsBodySchema, rawBody);
    return this.store.transaction(async (tx) => {
      await this.expireDue(tx);
      const ids = items.map((i) => i.cardId);
      const known = await tx.existingCardIds(ids);
      const rows = await tx.lockStock(ids);
      const results = items.map(({ cardId, qty }) => {
        const row = rows.get(cardId);
        const available = known.has(cardId) && row ? Math.max(0, row.total - row.reserved) : 0;
        return { cardId, qty, available, ok: known.has(cardId) && available >= qty };
      });
      return { allAvailable: results.every((r) => r.ok), items: results };
    });
  }

  // ---------- reserve ----------

  /**
   * All-or-nothing reservation. Same Idempotency-Key + same items replays the stored reservation (`replayed: true`);
   * same key with different items is rejected so a key can never silently mean two different things.
   */
  async reserve(rawKey: unknown, rawBody: unknown): Promise<{ reservation: Reservation; replayed: boolean }> {
    const key = this.parseKey(rawKey);
    const items = parseOrThrow(itemsBodySchema, rawBody);

    return this.store.transaction(async (tx) => {
      await this.expireDue(tx);

      const replay = await this.replayOf(tx, key, items);
      if (replay) return { reservation: replay, replayed: true };

      const ids = items.map((i) => i.cardId);
      const known = await tx.existingCardIds(ids);
      for (const id of ids) if (!known.has(id)) throw notFound(`Card ${id} not found`, 'CARD_NOT_FOUND');

      const rows = await tx.lockStock(ids);
      // a concurrent request with the same key may have committed while we waited for the row locks
      const raced = await this.replayOf(tx, key, items);
      if (raced) return { reservation: raced, replayed: true };

      const shortages: { cardId: string; requested: number; available: number }[] = [];
      for (const { cardId, qty } of items) {
        const row = rows.get(cardId);
        const available = row ? Math.max(0, row.total - row.reserved) : 0;
        if (available < qty) shortages.push({ cardId, requested: qty, available });
      }
      if (shortages.length > 0) {
        throw new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock for the requested cards', shortages);
      }

      for (const { cardId, qty } of items) rows.get(cardId)!.reserved += qty;
      await tx.saveStock([...rows.values()]);

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
      await tx.insertReservation(reservation);
      return { reservation, replayed: false };
    });
  }

  // ---------- commit / release ----------

  /** Turns a held reservation into a real stock deduction. Repeating a commit is a no-op that returns the same result. */
  commit(rawId: unknown): Promise<Reservation> {
    return this.settle(rawId, 'committed');
  }

  /** Gives held stock back (e.g. payment failed). Repeating a release is a no-op. */
  release(rawId: unknown): Promise<Reservation> {
    return this.settle(rawId, 'released');
  }

  private settle(rawId: unknown, wanted: 'committed' | 'released'): Promise<Reservation> {
    const id = parseOrThrow(reservationIdSchema, rawId);
    return this.store.transaction(async (tx) => {
      const reservation = await tx.lockReservation(id);
      if (!reservation) throw notFound('Reservation not found', 'RESERVATION_NOT_FOUND');
      if (reservation.status === wanted) return reservation;

      if (reservation.status === 'reserved' && Date.parse(reservation.expiresAt) <= Date.now()) {
        await this.expireDue(tx);
        throw gone('RESERVATION_EXPIRED', 'Reservation expired and its stock was returned');
      }
      if (reservation.status === 'expired') {
        throw gone('RESERVATION_EXPIRED', 'Reservation expired and its stock was returned');
      }
      if (reservation.status !== 'reserved') {
        throw conflict('RESERVATION_NOT_ACTIVE', `Reservation is already ${reservation.status}`);
      }

      const rows = await tx.lockStock(reservation.items.map((i) => i.cardId));
      for (const { cardId, qty } of reservation.items) {
        const row = rows.get(cardId);
        if (!row) continue;
        row.reserved = Math.max(0, row.reserved - qty);
        if (wanted === 'committed') row.total = Math.max(0, row.total - qty);
      }
      await tx.saveStock([...rows.values()]);
      return this.finish(tx, reservation, wanted);
    });
  }

  // ---------- expiry ----------

  /** Expires every due reservation and drops old terminal ones. Returns how many were expired. */
  async sweep(): Promise<number> {
    return this.store.transaction(async (tx) => {
      const expired = await this.expireDue(tx);
      const removed = await tx.deleteSettledBefore(Date.now() - RETENTION_MS);
      if (expired > 0 || removed > 0) this.logger.log(`sweep: expired ${expired}, pruned ${removed}`);
      return expired;
    });
  }

  /** Returns the held stock of every due reservation and marks it expired. Must run inside a transaction. */
  private async expireDue(tx: InventoryTx): Promise<number> {
    const now = Date.now();
    const due = await tx.lockDueReservations(now);
    if (due.length === 0) return 0;

    const rows = await tx.lockStock(due.flatMap((r) => r.items.map((i) => i.cardId)));
    for (const r of due) {
      for (const { cardId, qty } of r.items) {
        const row = rows.get(cardId);
        if (row) row.reserved = Math.max(0, row.reserved - qty);
      }
    }
    await tx.saveStock([...rows.values()]);
    for (const r of due) {
      r.status = 'expired';
      r.updatedAt = new Date(now).toISOString();
      await tx.updateReservation(r);
    }
    return due.length;
  }

  // ---------- helpers ----------

  private async replayOf(tx: InventoryTx, key: string, items: Item[]): Promise<Reservation | undefined> {
    const existing = await tx.findReservationByKey(key);
    if (!existing) return undefined;
    if (!sameItems(existing.items, items)) {
      throw unprocessable('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
    }
    return existing;
  }

  private async finish(
    tx: InventoryTx,
    reservation: Reservation,
    status: 'committed' | 'released',
  ): Promise<Reservation> {
    reservation.status = status;
    reservation.updatedAt = new Date().toISOString();
    await tx.updateReservation(reservation);
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
