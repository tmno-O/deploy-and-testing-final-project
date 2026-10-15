import type { Card, Pack, Reservation, Stock } from './types';

/**
 * Persistence contracts. Services depend on these abstract classes (Nest injection tokens); catalog.module.ts binds
 * them to the JSON-file implementation (src/catalog/json) or PostgreSQL / Supabase (src/catalog/pg) at boot.
 */

export abstract class CardRepository {
  abstract findAll(): Promise<Card[]>;
  abstract findById(id: string): Promise<Card | undefined>;
  abstract add(card: Card): Promise<void>;
  abstract replace(card: Card): Promise<void>;
}

export abstract class PackRepository {
  abstract findActive(): Promise<Pack[]>;
  /** Includes inactive packs (admin use). */
  abstract findAll(): Promise<Pack[]>;
  abstract findById(id: string): Promise<Pack | undefined>;
  /** Inactive packs are treated as non-existent for public readers. */
  abstract findActiveById(id: string): Promise<Pack | undefined>;
  abstract add(pack: Pack): Promise<void>;
  abstract replace(pack: Pack): Promise<void>;
}

export abstract class StockRepository {
  /** cardId -> units that can still be handed out (total - reserved, never negative). */
  abstract availabilityMap(): Promise<Map<string, number>>;
  abstract available(cardId: string): Promise<number>;
}

/** Operations that must be atomic with respect to each other. Everything inside `fn` sees a consistent view. */
export interface InventoryTx {
  /** Subset of `ids` that exist as cards. */
  existingCardIds(ids: string[]): Promise<Set<string>>;
  /** Locks and returns the stock rows (missing rows are absent from the map). Always locks in cardId order. */
  lockStock(cardIds: string[]): Promise<Map<string, Stock>>;
  /** Inserts or updates stock rows. */
  saveStock(rows: Stock[]): Promise<void>;
  findReservationByKey(key: string): Promise<Reservation | undefined>;
  /** Locks the reservation row until the transaction ends. */
  lockReservation(id: string): Promise<Reservation | undefined>;
  insertReservation(reservation: Reservation): Promise<void>;
  updateReservation(reservation: Reservation): Promise<void>;
  /** Locks reservations still `reserved` whose expiry is at or before `nowMs`. */
  lockDueReservations(nowMs: number): Promise<Reservation[]>;
  /** Deletes committed/released/expired reservations last updated before `cutoffMs`. Returns how many. */
  deleteSettledBefore(cutoffMs: number): Promise<number>;
  hasActiveReservationFor(cardId: string): Promise<boolean>;
  /** Deletes the card and its stock row. */
  deleteCard(cardId: string): Promise<void>;
}

export abstract class InventoryStore {
  abstract transaction<T>(fn: (tx: InventoryTx) => Promise<T>): Promise<T>;
}
