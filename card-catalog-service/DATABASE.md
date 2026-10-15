# Database (Supabase / PostgreSQL)

The service stores cards, packs, stock and reservations in **PostgreSQL**. Without `DATABASE_URL` it falls back to the
JSON file (`data/mock-data.json`), so local development and the unit/integration tests need no database.

| Mode | When | Code |
|---|---|---|
| JSON file | `DATABASE_URL` empty | `src/catalog/json/` (+ `src/store/`) |
| PostgreSQL / Supabase | `DATABASE_URL` set | `src/catalog/pg/`, `src/database/` |

Services depend only on the abstract repositories in `src/catalog/catalog.repositories.ts`; `catalog.module.ts` picks the
implementation at boot.

## One database for the whole platform (`../db/schema.sql`)
All five services share **one** Supabase database and one `DATABASE_URL`. Each table is written only by its owning service;
other services go through that service's API.

| Owner | Tables |
|---|---|
| user-service | `users`, `addresses` |
| wallet-service | `wallets`, `wallet_transactions` (append-only ledger, enforced by a trigger) |
| card-catalog-service | `cards`, `packs`, `stock`, `reservations` |
| gacha-service | `gacha_pulls`, `gacha_pull_cards` |
| collection-service | `collections`, `collection_pulls`, `orders`, `order_items`, `order_status_history` |

Design rules:
- Rows owned by a user reference `users(id)`; `wallet_transactions` and `gacha_pulls` reference `packs(id)`.
- History that must survive catalog changes (collections, orders, pulled cards) stores a **snapshot** of card name/rarity/image
  and has **no foreign key to `cards`**, so an admin can delete a card without breaking history. Orders also snapshot the
  shipping address.
- Integrity lives in the database: `reserved <= total`, `redeemed_quantity <= quantity`, wallet balance arithmetic
  (`balance_after = balance_before ± amount`), credit/debit matches the transaction type, unique idempotency keys,
  one default address per user, tracking number required once an order is SHIPPED.
- Only card-catalog-service is connected so far; the other tables are created but unused until their owners wire them.

`stock`: 1 row per card, cascades when a card is deleted. `reservations`: `idempotency_key` unique. RLS is enabled with no policies, so Supabase's public anon/authenticated keys cannot touch
them; the service connects with the database role (which bypasses RLS) and enforces auth itself.

## Setup on Supabase
1. Create a project. **Project Settings > Database > Connection string**, copy the **Transaction pooler** string (port 6543).
2. Put it in `.env` (never commit it):
   ```
   DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
   `DATABASE_SSL` defaults to `no-verify` (encrypted, certificate not checked). For full verification set
   `DATABASE_SSL=require` and `DATABASE_SSL_CA` to Supabase's CA certificate (Database settings > SSL).
3. Create all tables and load the 160 sample cards (run from `card-catalog-service/`):
   ```bash
   npm run db:migrate          # applies db/schema.sql (idempotent)
   npm run db:seed             # refuses to run if cards already exist; add -- --force to replace everything
   ```
   (Or paste `../db/schema.sql` into the Supabase SQL editor.)
4. Start the service (`npm run dev`); `GET /health/ready` now pings the database.

Keep `DATABASE_POOL_MAX` small (default 5): Supabase limits concurrent connections.

## How consistency is kept
- `InventoryStore.transaction()` wraps every reserve / commit / release / expire. In PostgreSQL it opens a transaction and
  locks the stock rows with `SELECT ... FOR UPDATE`, always in `card_id` order (no deadlocks), so concurrent requests
  cannot oversell. The `reserved <= total` check constraint is a second safety net.
- The same `Idempotency-Key` sent concurrently creates one reservation (key is re-checked after the locks, plus a unique index).
- Expiry runs as a query (`status='reserved' AND expires_at <= now()`, `FOR UPDATE SKIP LOCKED`), so several instances can share one database.
- In JSON mode transactions are serialised by a mutex, preserving the old behaviour.

## Tests
- `npm test` runs against the JSON store (no database).
- `tests/integration/postgres.test.ts` runs the API against PostgreSQL when `TEST_DATABASE_URL` is set (CI does this with a
  Postgres service). **It truncates the tables; use a throwaway database, never your Supabase project.**
  ```bash
  TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/catalog_test npm run test:integration
  ```

## Not covered yet
- The other four services (user, wallet, gacha, collection) still use JSON files; their tables exist in `db/schema.sql`
  but their code does not use them yet. Their mock data is not seeded (`db:seed` only loads the catalog).
- Card listing filters in memory after `select * from cards` (160 rows today); move filtering/pagination into SQL if the catalog grows.
