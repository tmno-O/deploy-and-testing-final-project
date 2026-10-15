// Loads data/mock-data.json into PostgreSQL in one transaction. Usage: npm run db:seed [-- --force]
// Refuses to run when the cards table already has rows (so it can never overwrite live stock) unless --force,
// which replaces cards, packs, stock and reservations with the file's contents.
import * as fs from 'fs';
import * as path from 'path';
import type { CatalogData } from '../src/catalog/types';
import { SQL, cardValues, packValues } from '../src/catalog/pg/pg.repositories';
import { connect } from './lib/db';

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const file = path.join(__dirname, '..', 'data', 'mock-data.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as CatalogData;

  const pool = connect();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ n: string }>('select count(*) as n from cards');
    if (Number(rows[0].n) > 0 && !force) {
      throw new Error('cards table is not empty; re-run with --force to replace it');
    }
    if (force) {
      // plain deletes (not TRUNCATE ... CASCADE): fails loudly instead of wiping wallet / gacha rows that reference packs
      for (const table of ['reservations', 'stock', 'packs', 'cards']) await client.query(`delete from ${table}`);
    }

    for (const card of data.cards) await client.query(SQL.CARD_UPSERT, cardValues(card));
    for (const pack of data.packs) await client.query(SQL.PACK_UPSERT, packValues(pack));
    for (const s of data.stock) {
      await client.query('insert into stock (card_id, total, reserved) values ($1, $2, $3)', [s.cardId, s.total, s.reserved]);
    }
    for (const r of data.reservations) {
      await client.query(
        `insert into reservations (id, idempotency_key, items, status, expires_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [r.id, r.idempotencyKey, JSON.stringify(r.items), r.status, r.expiresAt, r.createdAt, r.updatedAt],
      );
    }
    await client.query('COMMIT');
    console.log(
      `seeded ${data.cards.length} cards, ${data.packs.length} packs, ${data.stock.length} stock rows, ${data.reservations.length} reservations`,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
