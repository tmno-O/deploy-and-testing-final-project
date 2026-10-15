import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { conflict } from '../../common/app-error';
import { DatabaseService } from '../../database/database.service';
import {
  CardRepository,
  InventoryStore,
  PackRepository,
  StockRepository,
  type InventoryTx,
} from '../catalog.repositories';
import type { Card, Pack, Reservation, Stock } from '../types';

/** PostgreSQL (Supabase) implementations. Table definitions: db/schema.sql. */

interface CardRow {
  id: string;
  name: string;
  image_small: string;
  image_large: string;
  rarity: Card['rarity'];
  source_rarity: string | null;
  set_id: string;
  set_name: string;
  supertype: string;
  subtypes: string[];
  types: string[];
  hp: number;
  attacks: Card['attacks'];
  weaknesses: Card['weaknesses'];
  retreat_cost: number;
  artist: string | null;
}

interface PackRow {
  id: string;
  name: string;
  description: string;
  price_credits: number;
  cards_per_pack: number;
  rates: Pack['rates'];
  set_ids: string[];
  active: boolean;
}

interface ReservationRow {
  id: string;
  idempotency_key: string;
  items: Reservation['items'];
  status: Reservation['status'];
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface StockRow {
  card_id: string;
  total: number;
  reserved: number;
}

const toCard = (r: CardRow): Card => ({
  id: r.id,
  name: r.name,
  imageSmall: r.image_small,
  imageLarge: r.image_large,
  rarity: r.rarity,
  sourceRarity: r.source_rarity,
  setId: r.set_id,
  setName: r.set_name,
  supertype: r.supertype,
  subtypes: r.subtypes,
  types: r.types,
  hp: r.hp,
  attacks: r.attacks,
  weaknesses: r.weaknesses,
  retreatCost: r.retreat_cost,
  artist: r.artist,
});

const toPack = (r: PackRow): Pack => ({
  id: r.id,
  name: r.name,
  description: r.description,
  priceCredits: r.price_credits,
  cardsPerPack: r.cards_per_pack,
  rates: r.rates,
  setIds: r.set_ids,
  active: r.active,
});

const toReservation = (r: ReservationRow): Reservation => ({
  id: r.id,
  idempotencyKey: r.idempotency_key,
  items: r.items,
  status: r.status,
  expiresAt: r.expires_at.toISOString(),
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const toStock = (r: StockRow): Stock => ({ cardId: r.card_id, total: r.total, reserved: r.reserved });

const CARD_COLUMNS = `id, name, image_small, image_large, rarity, source_rarity, set_id, set_name, supertype,
  subtypes, types, hp, attacks, weaknesses, retreat_cost, artist`;
const PACK_COLUMNS = 'id, name, description, price_credits, cards_per_pack, rates, set_ids, active';
const RESERVATION_COLUMNS = 'id, idempotency_key, items, status, expires_at, created_at, updated_at';

/** Column values in CARD_COLUMNS order. jsonb parameters are sent as JSON text. */
export const cardValues = (c: Card): unknown[] => [
  c.id, c.name, c.imageSmall, c.imageLarge, c.rarity, c.sourceRarity, c.setId, c.setName, c.supertype,
  c.subtypes, c.types, c.hp, JSON.stringify(c.attacks), JSON.stringify(c.weaknesses), c.retreatCost, c.artist,
];

export const packValues = (p: Pack): unknown[] => [
  p.id, p.name, p.description, p.priceCredits, p.cardsPerPack, JSON.stringify(p.rates), p.setIds, p.active,
];

const CARD_UPSERT = `insert into cards (${CARD_COLUMNS}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
  on conflict (id) do update set name = excluded.name, image_small = excluded.image_small,
  image_large = excluded.image_large, rarity = excluded.rarity, source_rarity = excluded.source_rarity,
  set_id = excluded.set_id, set_name = excluded.set_name, supertype = excluded.supertype,
  subtypes = excluded.subtypes, types = excluded.types, hp = excluded.hp, attacks = excluded.attacks,
  weaknesses = excluded.weaknesses, retreat_cost = excluded.retreat_cost, artist = excluded.artist`;

const PACK_UPSERT = `insert into packs (${PACK_COLUMNS}) values ($1,$2,$3,$4,$5,$6,$7,$8)
  on conflict (id) do update set name = excluded.name, description = excluded.description,
  price_credits = excluded.price_credits, cards_per_pack = excluded.cards_per_pack, rates = excluded.rates,
  set_ids = excluded.set_ids, active = excluded.active`;

const isUniqueViolation = (err: unknown): boolean => (err as { code?: string })?.code === '23505';

export const SQL = { CARD_UPSERT, PACK_UPSERT };

@Injectable()
export class PgCardRepository extends CardRepository {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  async findAll(): Promise<Card[]> {
    return (await this.db.query<CardRow>(`select ${CARD_COLUMNS} from cards order by id`)).map(toCard);
  }

  async findById(id: string): Promise<Card | undefined> {
    const rows = await this.db.query<CardRow>(`select ${CARD_COLUMNS} from cards where id = $1`, [id]);
    return rows[0] ? toCard(rows[0]) : undefined;
  }

  async add(card: Card): Promise<void> {
    // plain insert: a concurrent duplicate must fail instead of silently overwriting
    try {
      await this.db.query(
        `insert into cards (${CARD_COLUMNS}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        cardValues(card),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('CARD_EXISTS', `Card ${card.id} already exists`);
      throw err;
    }
  }

  async replace(card: Card): Promise<void> {
    await this.db.query(CARD_UPSERT, cardValues(card));
  }
}

@Injectable()
export class PgPackRepository extends PackRepository {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  async findActive(): Promise<Pack[]> {
    return (await this.db.query<PackRow>(`select ${PACK_COLUMNS} from packs where active order by id`)).map(toPack);
  }

  async findAll(): Promise<Pack[]> {
    return (await this.db.query<PackRow>(`select ${PACK_COLUMNS} from packs order by id`)).map(toPack);
  }

  async findById(id: string): Promise<Pack | undefined> {
    const rows = await this.db.query<PackRow>(`select ${PACK_COLUMNS} from packs where id = $1`, [id]);
    return rows[0] ? toPack(rows[0]) : undefined;
  }

  async findActiveById(id: string): Promise<Pack | undefined> {
    const rows = await this.db.query<PackRow>(`select ${PACK_COLUMNS} from packs where id = $1 and active`, [id]);
    return rows[0] ? toPack(rows[0]) : undefined;
  }

  async add(pack: Pack): Promise<void> {
    try {
      await this.db.query(`insert into packs (${PACK_COLUMNS}) values ($1,$2,$3,$4,$5,$6,$7,$8)`, packValues(pack));
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('PACK_EXISTS', `Pack ${pack.id} already exists`);
      throw err;
    }
  }

  async replace(pack: Pack): Promise<void> {
    await this.db.query(PACK_UPSERT, packValues(pack));
  }
}

@Injectable()
export class PgStockRepository extends StockRepository {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  async availabilityMap(): Promise<Map<string, number>> {
    const rows = await this.db.query<{ card_id: string; available: number }>(
      'select card_id, greatest(0, total - reserved) as available from stock',
    );
    return new Map(rows.map((r) => [r.card_id, r.available]));
  }

  async available(cardId: string): Promise<number> {
    const rows = await this.db.query<{ available: number }>(
      'select greatest(0, total - reserved) as available from stock where card_id = $1',
      [cardId],
    );
    return rows[0]?.available ?? 0;
  }
}

@Injectable()
export class PgInventoryStore extends InventoryStore {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  transaction<T>(fn: (tx: InventoryTx) => Promise<T>): Promise<T> {
    return this.db.transaction((client) => fn(new PgTx(client)));
  }
}

class PgTx implements InventoryTx {
  constructor(private readonly client: PoolClient) {}

  async existingCardIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const { rows } = await this.client.query<{ id: string }>('select id from cards where id = any($1)', [ids]);
    return new Set(rows.map((r) => r.id));
  }

  async lockStock(cardIds: string[]): Promise<Map<string, Stock>> {
    if (cardIds.length === 0) return new Map();
    // ORDER BY makes every transaction take row locks in the same order, so two requests cannot deadlock
    const { rows } = await this.client.query<StockRow>(
      'select card_id, total, reserved from stock where card_id = any($1) order by card_id for update',
      [[...new Set(cardIds)]],
    );
    return new Map(rows.map((r) => [r.card_id, toStock(r)]));
  }

  async saveStock(rows: Stock[]): Promise<void> {
    for (const row of rows) {
      await this.client.query(
        `insert into stock (card_id, total, reserved) values ($1, $2, $3)
         on conflict (card_id) do update set total = excluded.total, reserved = excluded.reserved`,
        [row.cardId, row.total, row.reserved],
      );
    }
  }

  async findReservationByKey(key: string): Promise<Reservation | undefined> {
    const { rows } = await this.client.query<ReservationRow>(
      `select ${RESERVATION_COLUMNS} from reservations where idempotency_key = $1`,
      [key],
    );
    return rows[0] ? toReservation(rows[0]) : undefined;
  }

  async lockReservation(id: string): Promise<Reservation | undefined> {
    const { rows } = await this.client.query<ReservationRow>(
      `select ${RESERVATION_COLUMNS} from reservations where id = $1 for update`,
      [id],
    );
    return rows[0] ? toReservation(rows[0]) : undefined;
  }

  async insertReservation(r: Reservation): Promise<void> {
    await this.client.query(
      `insert into reservations (${RESERVATION_COLUMNS}) values ($1,$2,$3,$4,$5,$6,$7)`,
      [r.id, r.idempotencyKey, JSON.stringify(r.items), r.status, r.expiresAt, r.createdAt, r.updatedAt],
    );
  }

  async updateReservation(r: Reservation): Promise<void> {
    await this.client.query('update reservations set status = $2, updated_at = $3 where id = $1', [
      r.id,
      r.status,
      r.updatedAt,
    ]);
  }

  async lockDueReservations(nowMs: number): Promise<Reservation[]> {
    // SKIP LOCKED: another instance is already expiring (or committing) those rows
    const { rows } = await this.client.query<ReservationRow>(
      `select ${RESERVATION_COLUMNS} from reservations
       where status = 'reserved' and expires_at <= $1 order by expires_at for update skip locked`,
      [new Date(nowMs).toISOString()],
    );
    return rows.map(toReservation);
  }

  async deleteSettledBefore(cutoffMs: number): Promise<number> {
    const res = await this.client.query(
      `delete from reservations where status <> 'reserved' and updated_at < $1`,
      [new Date(cutoffMs).toISOString()],
    );
    return res.rowCount ?? 0;
  }

  async hasActiveReservationFor(cardId: string): Promise<boolean> {
    const { rows } = await this.client.query(
      `select 1 from reservations where status = 'reserved' and items @> $1::jsonb limit 1`,
      [JSON.stringify([{ cardId }])],
    );
    return rows.length > 0;
  }

  async deleteCard(cardId: string): Promise<void> {
    await this.client.query('delete from cards where id = $1', [cardId]); // stock row goes with it (on delete cascade)
  }
}
