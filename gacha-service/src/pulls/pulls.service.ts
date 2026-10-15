import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CatalogClient } from '../clients/catalog.client';
import { CollectionClient } from '../clients/collection.client';
import { WalletClient } from '../clients/wallet.client';
import type { PoolCard, Reservation } from '../clients/types';
import { AppError, conflict, notFound, unprocessable } from '../common/app-error';
import { drawCards } from './draw';
import { PullsRepository } from './pulls.repository';
import type { PullRecord } from './types';

/** group the drawn cards by id: [{cardId, qty}] */
function toItems(cards: PoolCard[]): { cardId: string; qty: number }[] {
  const qty = new Map<string, number>();
  for (const c of cards) qty.set(c.id, (qty.get(c.id) ?? 0) + 1);
  return [...qty].map(([cardId, q]) => ({ cardId, qty: q }));
}

/** The other service refused for good (so no money moved), as opposed to "down / timed out" where we cannot know. */
function isDefinitiveFailure(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  const status = err.getStatus();
  return (status >= 400 && status < 500) || err.code === 'UPSTREAM_ERROR';
}

@Injectable()
export class PullsService {
  private readonly logger = new Logger(PullsService.name);
  /** pulls being processed right now (stops two parallel requests with the same key) */
  private readonly inflight = new Set<string>();

  constructor(
    private readonly repo: PullsRepository,
    private readonly catalog: CatalogClient,
    private readonly wallet: WalletClient,
    private readonly collection: CollectionClient,
  ) {}

  /** Opens a pack. Sending the same pullId again continues or replays the same pull, it never charges twice. */
  async open(
    userId: string,
    packId: string,
    pullId: string,
    requestId?: string,
  ): Promise<{ pull: PullRecord; replay: boolean }> {
    const existing = this.repo.find(pullId);
    if (existing && existing.userId !== userId) {
      throw conflict('PULL_ID_CONFLICT', 'This Idempotency-Key belongs to another user');
    }
    if (existing && existing.packId !== packId) {
      throw unprocessable('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different pack');
    }
    if (this.inflight.has(pullId)) throw conflict('PULL_IN_PROGRESS', 'This pull is already being processed');

    this.inflight.add(pullId);
    try {
      if (existing) {
        if (existing.status !== 'COMPLETED' && existing.status !== 'FAILED') await this.finish(existing, requestId);
        return { pull: existing, replay: true };
      }
      const pull = await this.start(userId, packId, pullId, requestId);
      await this.finish(pull, requestId);
      return { pull, replay: false };
    } finally {
      this.inflight.delete(pullId);
    }
  }

  getOwn(userId: string, id: string): PullRecord {
    const pull = this.repo.find(id);
    if (!pull || pull.userId !== userId) throw notFound('Pull not found', 'PULL_NOT_FOUND');
    return pull;
  }

  list(userId: string, page: number, limit: number) {
    const all = this.repo.listByUser(userId);
    return {
      data: all.slice((page - 1) * limit, page * limit),
      page,
      limit,
      total: all.length,
      totalPages: Math.ceil(all.length / limit),
    };
  }

  // ---- steps ----

  /** draw + hold the stock + save the pull as PENDING */
  private async start(userId: string, packId: string, pullId: string, requestId?: string): Promise<PullRecord> {
    const { picked, reservation } = await this.reserveStock(packId, pullId, requestId);
    const now = new Date().toISOString();
    const pull: PullRecord = {
      id: pullId,
      userId,
      packId,
      status: 'PENDING',
      price: null,
      cards: picked.map((c) => ({
        cardId: c.id,
        cardName: c.name,
        rarity: c.rarity,
        imageUrl: c.imageSmall,
        collectionPullId: randomUUID(),
        delivered: false,
      })),
      reservationId: reservation.id,
      walletTransactionId: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.repo.insert(pull);
    return pull;
  }

  private async reserveStock(
    packId: string,
    pullId: string,
    requestId?: string,
  ): Promise<{ picked: PoolCard[]; reservation: Reservation }> {
    for (let attempt = 1; ; attempt++) {
      const pool = await this.catalog.getPool(packId, requestId);
      const picked = drawCards(pool);
      try {
        const reservation = await this.catalog.reserve(toItems(picked), pullId, requestId);
        return { picked, reservation };
      } catch (err) {
        // someone took the last copy between our read and our reservation: draw again
        const outOfStock = err instanceof AppError && err.code === 'INSUFFICIENT_STOCK';
        if (!outOfStock || attempt >= 3) throw err;
      }
    }
  }

  /** continues from wherever the pull stopped */
  private async finish(pull: PullRecord, requestId?: string): Promise<void> {
    if (pull.status === 'PENDING') await this.pay(pull, requestId);
    if (pull.status === 'PAID') {
      await this.commitStock(pull, requestId);
      await this.deliver(pull, requestId);
    }
  }

  private async pay(pull: PullRecord, requestId?: string): Promise<void> {
    try {
      // the wallet reads the price from the catalog: we only send the packId
      const result = await this.wallet.purchase(pull.userId, pull.packId, pull.id, requestId);
      pull.status = 'PAID';
      pull.price = result.transaction.amount;
      pull.walletTransactionId = result.transactionId;
      this.repo.save(pull);
    } catch (err) {
      if (isDefinitiveFailure(err)) {
        pull.status = 'FAILED';
        pull.failureReason = err instanceof AppError ? err.code : 'PAYMENT_FAILED';
        this.repo.save(pull);
        await this.releaseStock(pull, requestId);
      }
      throw err;
    }
  }

  private async commitStock(pull: PullRecord, requestId?: string): Promise<void> {
    if (!pull.reservationId) return;
    try {
      await this.catalog.commit(pull.reservationId, requestId); // repeating it is safe
    } catch (err) {
      const reservationLost =
        err instanceof AppError &&
        ['RESERVATION_EXPIRED', 'RESERVATION_NOT_ACTIVE', 'RESERVATION_NOT_FOUND'].includes(err.code);
      if (reservationLost) {
        this.logger.error(`pull ${pull.id}: reservation lost after payment, refunding`);
        await this.refundAndFail(pull, (err as AppError).code, requestId);
      }
      throw err;
    }
  }

  private async deliver(pull: PullRecord, requestId?: string): Promise<void> {
    for (const card of pull.cards) {
      if (card.delivered) continue; // already sent before a previous failure
      await this.collection.addCard(pull.userId, card.collectionPullId, card.cardId, requestId);
      card.delivered = true;
      this.repo.save(pull);
    }
    pull.status = 'COMPLETED';
    this.repo.save(pull);
  }

  private async releaseStock(pull: PullRecord, requestId?: string): Promise<void> {
    if (!pull.reservationId) return;
    // best effort: the catalog frees an unused reservation by itself after its TTL
    await this.catalog.release(pull.reservationId, requestId).catch((err: unknown) => {
      this.logger.warn(`pull ${pull.id}: release failed (${err instanceof Error ? err.message : String(err)})`);
    });
  }

  private async refundAndFail(pull: PullRecord, reason: string, requestId?: string): Promise<void> {
    await this.wallet.refund(
      pull.userId,
      pull.price ?? 0,
      pull.walletTransactionId ?? '',
      `refund-${pull.id}`,
      requestId,
    );
    pull.status = 'FAILED'; // only after the refund went through; otherwise a retry tries again
    pull.failureReason = reason;
    this.repo.save(pull);
  }
}