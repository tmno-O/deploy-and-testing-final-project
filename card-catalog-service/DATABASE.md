# Database readiness (Supabase / PostgreSQL)

## Current state
- Persistence is a JSON file (`data/mock-data.json`) loaded into memory by `src/store/store.service.ts`; there is no database driver, no connection config and no migrations.
- Data: 160 cards, 3 packs, 160 stock rows, 3 reservations. Entities: `cards`, `packs`, `stock`, `reservations` (see `src/catalog/types.ts`).
- Draft schema: [`db/schema.sql`](db/schema.sql) (tables, constraints, indexes, RLS enabled with no policies).

## Not ready to switch yet. Remaining work
1. Add a Postgres client (`pg` or `postgres`) and `DATABASE_URL` (+ SSL) to `app-config.ts` and `.env.example`; use the Supabase pooler connection string.
2. Repositories (`catalog.repositories.ts`) are synchronous and mutate `store.data`; they must become async DB queries, and callers (`cards`, `packs`, `inventory`, `admin` services) must `await`.
3. `InventoryService` reserve/commit/release/expire must run in a transaction using `SELECT ... FOR UPDATE` (or atomic `UPDATE stock SET reserved = reserved + $qty WHERE total - reserved >= $qty`). Today atomicity relies on Node being single-threaded.
4. Replace the in-process expiry sweep with a query (`status='reserved' AND expires_at <= now()`), safe for multiple instances.
5. Seed script: load `mock-data.json` into the tables (idempotent upsert).
6. Update tests (they use `StoreService.reset`) to use a test database or an in-memory repository implementation.
7. Never commit `DATABASE_URL`; note the other four services also still use JSON files, so each owner needs their own tables/schema (or a separate schema per service in the same Supabase project).
