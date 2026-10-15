import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { CatalogClient } from '../clients/catalog.client';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../common/app-error';
import { paginate, type Page } from '../common/parse';
import type { CallContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/payment-provider';
import { StoreService } from '../store/store.service';
import type { Direction, Transaction, TransactionType } from '../store/types';
import { toTransactionView, toWalletView, type WalletView } from './wallet.views';

export interface OperationResult {
  /** true when the Idempotency key was already used: nothing new happened, this is the original result */
  replayed: boolean;
  transaction: Transaction;
}

interface PostSpec {
  type: TransactionType;
  direction: Direction;
  amount: number;
  key: string;
  hash: string;
  reason?: string | null;
  packId?: string;
  refundOf?: string;
  method?: string;
  providerRef?: string;
}

/** Fingerprint of the fields that decide how much money moves; reusing a key with a different one is an error. */
const fingerprint = (...parts: unknown[]): string =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');

@Injectable()
export class WalletService {
  constructor(
    private readonly store: StoreService,
    private readonly catalog: CatalogClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // ---------- reads ----------

  getWallet(userId: string): WalletView {
    return toWalletView(userId, this.store.data.wallets.find((w) => w.userId === userId));
  }

  topupOptions() {
    const { topupMinAmount, topupMaxAmount, maxBalance } = this.config.payment;
    return {
      provider: this.provider.name,
      methods: [...this.provider.methods],
      minAmount: topupMinAmount,
      maxAmount: topupMaxAmount,
      maxBalance,
    };
  }

  /** Newest first. */
  listTransactions(
    userId: string,
    query: { page: number; limit: number; type?: TransactionType },
  ): Page<ReturnType<typeof toTransactionView>> {
    const mine = this.store.data.transactions
      .filter((t) => t.userId === userId && (!query.type || t.type === query.type))
      .reverse();
    return paginate(mine.map(toTransactionView), query);
  }

  getTransaction(userId: string, id: string) {
    const tx = this.store.data.transactions.find((t) => t.id === id && t.userId === userId);
    if (!tx) throw notFound('Transaction not found', 'TRANSACTION_NOT_FOUND');
    return toTransactionView(tx);
  }

  /**
   * Replays the whole ledger of one user and compares it with the stored balance:
   * every row must start where the previous one ended, and the last row must equal the balance.
   */
  audit(userId: string) {
    let running = 0;
    let consistent = true;
    const rows = this.store.data.transactions.filter((t) => t.userId === userId);
    for (const t of rows) {
      const expectedAfter = t.direction === 'credit' ? t.balanceBefore + t.amount : t.balanceBefore - t.amount;
      if (t.balanceBefore !== running || t.balanceAfter !== expectedAfter) consistent = false;
      running = t.balanceAfter;
    }
    const balance = this.getWallet(userId).balance;
    if (running !== balance) consistent = false;
    return { balance, ledgerBalance: running, transactionCount: rows.length, consistent };
  }

  // ---------- writes ----------

  /** Add credit through the payment provider. */
  async topup(userId: string, input: { amount: number; method?: string; key: string }): Promise<OperationResult> {
    const { topupMinAmount, topupMaxAmount, maxBalance } = this.config.payment;
    const method = input.method ?? this.provider.methods[0];
    if (!this.provider.methods.includes(method)) {
      throw badRequest('Invalid request', [
        { path: 'method', message: `Unsupported payment method (supported: ${this.provider.methods.join(', ')})` },
      ]);
    }
    if (input.amount < topupMinAmount || input.amount > topupMaxAmount) {
      throw badRequest('Invalid request', [
        { path: 'amount', message: `Must be between ${topupMinAmount} and ${topupMaxAmount}` },
      ]);
    }

    // a repeated key never reaches the provider again: nothing is taken twice
    const known = this.findByKey(userId, input.key);
    let providerRef = known?.providerRef ?? '';
    if (!known) {
      if (this.getWallet(userId).balance + input.amount > maxBalance) throw balanceLimit(maxBalance);
      ({ providerRef } = await this.provider.charge({
        userId,
        amount: input.amount,
        method,
        idempotencyKey: input.key,
      }));
    }

    return this.post(userId, {
      type: 'topup',
      direction: 'credit',
      amount: input.amount,
      key: input.key,
      hash: fingerprint('topup', userId, input.amount, method),
      method,
      providerRef,
    });
  }

  /** Take credit for something the caller sells (e.g. the shipping fee of collection-service). */
  charge(userId: string, input: { amount: number; reason?: string; key: string }): Promise<OperationResult> {
    return this.post(userId, {
      type: 'charge',
      direction: 'debit',
      amount: input.amount,
      key: input.key,
      hash: fingerprint('charge', userId, input.amount),
      reason: input.reason ?? null,
    });
  }

  /** Buy one pack. The price is read from card-catalog-service, never from the caller. */
  async purchasePack(userId: string, input: { packId: string; key: string }, ctx: CallContext = {}): Promise<OperationResult> {
    const base = {
      type: 'purchase',
      direction: 'debit',
      key: input.key,
      hash: fingerprint('purchase', userId, input.packId),
      packId: input.packId,
    } as const;

    // a repeated key does not need the catalog (and must still work while the catalog is down);
    // post() replays the original row, or rejects the key if it was used for something else
    const known = this.findByKey(userId, input.key);
    if (known) return this.post(userId, { ...base, amount: known.amount, reason: known.reason });

    const pack = await this.catalog.getPack(input.packId, ctx);
    return this.post(userId, {
      ...base,
      amount: pack.priceCredits,
      reason: `Pack purchase: ${pack.name}`.slice(0, 200),
    });
  }

  /**
   * Give credit back. With `transactionId` the refund is tied to that charge/purchase and can never exceed it
   * (also across several partial refunds). Without it, it is a plain credit (the contract collection-service uses today).
   */
  refund(
    userId: string,
    input: { amount: number; key: string; transactionId?: string; reason?: string },
  ): Promise<OperationResult> {
    return this.post(userId, {
      type: 'refund',
      direction: 'credit',
      amount: input.amount,
      key: input.key,
      hash: fingerprint('refund', userId, input.amount, input.transactionId ?? null),
      refundOf: input.transactionId,
      reason: input.reason ?? null,
    });
  }

  // ---------- ledger core ----------

  private findByKey(userId: string, key: string): Transaction | undefined {
    return this.store.data.transactions.find((t) => t.userId === userId && t.idempotencyKey === key);
  }

  /**
   * The only place the ledger changes. Runs inside the store mutex, so "check balance, write row, update balance"
   * is one step: two requests can never both spend the same credits, and a failed request leaves no trace.
   */
  private post(userId: string, spec: PostSpec): Promise<OperationResult> {
    return this.store.transaction((): OperationResult => {
      const existing = this.findByKey(userId, spec.key);
      if (existing) {
        if (existing.requestHash !== spec.hash) {
          throw unprocessable(
            'IDEMPOTENCY_KEY_REUSED',
            'This idempotency key was already used for a different request',
          );
        }
        return { replayed: true, transaction: existing };
      }

      if (spec.refundOf) this.assertRefundable(userId, spec.refundOf, spec.amount);

      const { wallets, transactions } = this.store.data;
      const now = new Date().toISOString();
      let wallet = wallets.find((w) => w.userId === userId);
      if (!wallet) {
        wallet = { userId, balance: 0, createdAt: now, updatedAt: now };
        wallets.push(wallet);
      }

      const before = wallet.balance;
      const after = spec.direction === 'credit' ? before + spec.amount : before - spec.amount;
      if (after < 0) {
        throw new AppError(402, 'INSUFFICIENT_BALANCE', 'Not enough credits', { balance: before, required: spec.amount });
      }
      // only new money from outside is capped; a refund is the user's own credit coming back
      if (spec.type === 'topup' && after > this.config.payment.maxBalance) {
        throw balanceLimit(this.config.payment.maxBalance);
      }

      wallet.balance = after;
      wallet.updatedAt = now;
      const transaction: Transaction = {
        id: randomUUID(),
        userId,
        type: spec.type,
        direction: spec.direction,
        amount: spec.amount,
        balanceBefore: before,
        balanceAfter: after,
        idempotencyKey: spec.key,
        requestHash: spec.hash,
        reason: spec.reason ?? null,
        packId: spec.packId ?? null,
        refundOf: spec.refundOf ?? null,
        method: spec.method ?? null,
        provider: spec.type === 'topup' ? this.provider.name : null,
        providerRef: spec.type === 'topup' ? spec.providerRef || null : null,
        createdAt: now,
      };
      transactions.push(transaction);
      return { replayed: false, transaction };
    });
  }

  private assertRefundable(userId: string, originalId: string, amount: number): void {
    const transactions = this.store.data.transactions;
    const original = transactions.find((t) => t.id === originalId && t.userId === userId);
    if (!original) throw unprocessable('TRANSACTION_NOT_FOUND', 'The transaction to refund does not exist for this user');
    if (original.direction !== 'debit') {
      throw unprocessable('NOT_REFUNDABLE', 'Only a charge or a purchase can be refunded');
    }
    const refunded = transactions
      .filter((t) => t.type === 'refund' && t.refundOf === original.id)
      .reduce((sum, t) => sum + t.amount, 0);
    if (refunded + amount > original.amount) {
      throw conflict('REFUND_EXCEEDS_CHARGE', 'Refund is more than what was charged', {
        charged: original.amount,
        refunded,
        requested: amount,
      });
    }
  }
}

function balanceLimit(maxBalance: number): AppError {
  return unprocessable('BALANCE_LIMIT_EXCEEDED', `A wallet cannot hold more than ${maxBalance} credits`);
}
