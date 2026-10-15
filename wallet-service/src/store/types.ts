/** topup/refund add credit; purchase/charge take it away. */
export type TransactionType = 'topup' | 'purchase' | 'charge' | 'refund';
export type Direction = 'credit' | 'debit';

export interface Wallet {
  userId: string;
  /** whole credits (1 credit = 1 baht, see SERVICE_CONVENTIONS.md) */
  balance: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of the append-only ledger. Rows are never edited or deleted:
 * `balanceAfter` of a user's n-th row equals `balanceBefore` of the (n+1)-th.
 */
export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  direction: Direction;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  /** unique per user: a repeated key replays this row instead of moving money again */
  idempotencyKey: string;
  /** fingerprint of the money-relevant request fields, to reject a reused key with different content */
  requestHash: string;
  reason: string | null;
  /** purchase: the pack bought */
  packId: string | null;
  /** refund: the charge/purchase this refund is for (optional) */
  refundOf: string | null;
  /** topup: how it was paid and which provider handled it */
  method: string | null;
  provider: string | null;
  providerRef: string | null;
  createdAt: string;
}

export interface WalletData {
  wallets: Wallet[];
  transactions: Transaction[];
}
