import type { Transaction, Wallet } from '../store/types';

export interface WalletView {
  userId: string;
  balance: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/** A user who has never topped up has no wallet row yet: balance 0, no timestamps. Reading never creates one. */
export function toWalletView(userId: string, wallet: Wallet | undefined): WalletView {
  return {
    userId,
    balance: wallet?.balance ?? 0,
    createdAt: wallet?.createdAt ?? null,
    updatedAt: wallet?.updatedAt ?? null,
  };
}

export function toTransactionView(tx: Transaction) {
  return {
    id: tx.id,
    userId: tx.userId,
    type: tx.type,
    direction: tx.direction,
    amount: tx.amount,
    balanceBefore: tx.balanceBefore,
    balanceAfter: tx.balanceAfter,
    reason: tx.reason,
    packId: tx.packId,
    refundOf: tx.refundOf,
    method: tx.method,
    provider: tx.provider,
    providerRef: tx.providerRef,
    idempotencyKey: tx.idempotencyKey,
    createdAt: tx.createdAt,
  };
}

/** What every money-moving endpoint answers (collection-service reads `transactionId`). */
export function toOperationView(tx: Transaction) {
  return { transactionId: tx.id, balance: tx.balanceAfter, transaction: toTransactionView(tx) };
}
