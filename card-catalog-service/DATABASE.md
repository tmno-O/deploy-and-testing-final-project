# Database (Supabase / PostgreSQL)

The service stores cards, packs, stock and reservations in **PostgreSQL**. Without `DATABASE_URL` it falls back to the
JSON file (`data/mock-data.json`), so local development and the unit/integration tests need no database.

| Mode | When | Code |
|---|---|---|
| JSON file | `DATABASE_URL` empty | `src/catalog/json/` (+ `src/store/`) |
| PostgreSQL / Supabase | `DATABASE_URL` set | `src/catalog/pg/`, `src/database/` |

Services depend only on the abstract repositories in `src/catalog/catalog.repositories.ts`; `catalog.module.ts` picks the
implementation at boot.

## Tables (`db/schema.sql`)
`cards` · `packs` · `stock` (1 row per card, `reserved <= total`, cascades when a card is deleted) · `reservations`
(`idempotency_key` unique). RLS is enabled with no policies, so Supabase's public anon/authenticated keys cannot touch
them; the service connects with the database role (which bypasses RLS) and enforces auth itself.

## Setup on Supabase
1. Create a project. **Project Settings > Database > Connection string**, copy the **Transaction pooler** string (port 6543).
2. Put it in `.env` (never commit it):
   ```
   DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
   `DATABASE_SSL` defaults to `no-verify` (encrypted, certificate not checked). For full verification set
   `DATABASE_SSL=require` and `DATABASE_SSL_CA` to Supabase's CA certificate (Database settings > SSL).
3. Create the tables and load the 160 sample cards:
   ```bash
   npm run db:migrate          # applies db/schema.sql (idempotent)
   npm run db:seed             # refuses to run if cards already exist; add -- --force to replace everything
   ```
   (Or paste `db/schema.sql` into the Supabase SQL editor.)
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
- The other four services (user, wallet, gacha, collection) still use JSON files; each owner needs their own tables.
  Suggestion: one Supabase project, a separate Postgres schema per service.
- Card listing filters in memory after `select * from cards` (160 rows today); move filtering/pagination into SQL if the catalog grows.
