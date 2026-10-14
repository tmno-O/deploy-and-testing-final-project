# Card Catalog & Inventory Service (Service 3)

Source of truth for cards, packs, rarity, drop rates and physical card stock.
Default port: **3003**. Built with **NestJS 11 + TypeScript**. Status: complete per the plan (catalog, packs, stock reservations, admin, auth). **Full API contract for the team: [API.md](API.md).**

## Run locally

```bash
cp .env.example .env     # then set JWT_SECRET and INTERNAL_API_KEY (openssl rand -hex 32)
npm install
npm run dev
```

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Nest watch mode |
| `npm run build` / `npm start` | compile to `dist/` / run compiled build |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm run import:cards` | regenerate seed data (see below) |
| `npm test` | all tests |
| `npm run test:coverage` | tests with coverage |

## Seed data

`data/mock-data.json` is generated once from the [Pokémon TCG API](https://pokemontcg.io) and committed; the service only reads that file and never calls the API at runtime.

```bash
npm run import:cards                                   # default sets: sv3pt5, swsh7, base1
npm run import:cards -- --sets sv3pt5,swsh7 --dry-run  # preview without writing
```

- Keeps Pokémon cards that have HP: 160 cards (60 common, 40 rare, 40 epic, 20 legendary), picked deterministically across sets.
- Rarity mapping lives in `src/catalog/rarity.ts`; unknown API rarities become `common` with a warning.
- Stock: common 200, rare 80, epic 25, legendary 5 per card. Packs: `starter`, `premium`, `legendary` (rates sum to 100).
- Only image URLs on `images.pokemontcg.io` are accepted. Optional `POKEMONTCG_API_KEY` env var raises rate limits.
- Re-running overwrites the data file, including reservations. The API is flaky, so the script retries with backoff.

Card names and images are trademarks of Nintendo / Creatures Inc. / GAME FREAK inc. / The Pokémon Company, used here for educational purposes only.

## Endpoints (public, no login)

| Method | Path | Description |
|---|---|---|
| GET | `/cards` | list; query `q` (name), `rarity`, `type`, `setId`, `page` (default 1), `limit` (default 20, max 100). Returns `{data, page, limit, total, totalPages}` |
| GET | `/cards/:id` | full card details plus `available` |
| GET | `/packs` | active packs with `priceCredits`, `cardsPerPack`, `rates`, `setIds` |
| GET | `/packs/:id` | one pack |
| GET | `/packs/:id/pool` | in-stock cards of the pack's sets grouped by rarity (`pool.common/rare/epic/legendary`), plus `rates`, `cardsPerPack`, `counts` — for the Gacha service |
| GET | `/health` · `/health/ready` | liveness / readiness |

## Inventory (stock)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/inventory/:cardId` | public | `{cardId, total, reserved, available}` |
| POST | `/inventory/check` | public | body `{items:[{cardId,qty}]}` → `{allAvailable, items:[{cardId,qty,available,ok}]}`; holds nothing |
| POST | `/inventory/reservations` | `X-Internal-Key` | hold stock; header `Idempotency-Key` required; body `{items:[{cardId,qty}]}` → 201 `{id,items,status,expiresAt,...}` |
| POST | `/inventory/reservations/:id/commit` | `X-Internal-Key` | confirm: deducts `total` and `reserved` |
| POST | `/inventory/reservations/:id/release` | `X-Internal-Key` | cancel: gives the held stock back (e.g. payment failed) |

Rules:
- **All or nothing**: if any card is short the whole request fails with 409 `INSUFFICIENT_STOCK` (`details` lists `cardId/requested/available`) and nothing is held.
- **Idempotency**: same `Idempotency-Key` + same items → 200 with the original reservation (`Idempotent-Replayed: true`), no extra stock held. Same key with different items → 422 `IDEMPOTENCY_KEY_REUSED`. Key format: 8–100 chars of `A-Z a-z 0-9 . _ : -`. A failed attempt (e.g. 409) does not consume the key. Keys are remembered for 24 h after the reservation finishes.
- **Commit / release are repeatable**: repeating returns the same result without deducting or returning stock twice. Committing a released reservation (or releasing a committed one) → 409 `RESERVATION_NOT_ACTIVE`.
- **Expiry**: a reservation not committed within `RESERVATION_TTL_SECONDS` (default 600) expires; its stock is returned lazily on the next request and by a background sweep every `RESERVATION_SWEEP_SECONDS` (default 30). Commit/release of an expired reservation → 410 `RESERVATION_EXPIRED`. Callers should commit or release, and treat 410 as "start again".
- Limits: max 50 distinct cards per request, qty 1–100 per card. Duplicate `cardId`s are summed.
- Operations are synchronous on Node's single thread so they are atomic in mock-data mode; a database version must use transactions.

`available = total - reserved` (0 when a card has no stock row). Inactive packs are hidden (404).
Errors: `{ "error": { "code", "message", "details" } }` with `VALIDATION_ERROR` 400, `CARD_NOT_FOUND` / `PACK_NOT_FOUND` 404, `TOO_MANY_REQUESTS` 429.

## Authentication & admin

Three access levels:

| Level | How | Used for |
|---|---|---|
| Public | none | `/cards`, `/packs`, `/inventory/:cardId`, `/inventory/check`, `/health` |
| Internal | header `X-Internal-Key: <INTERNAL_API_KEY>` | `/inventory/reservations*` (Gacha / Collection) |
| Admin | header `Authorization: Bearer <JWT from user-service>` and the token's `sub` is in `ADMIN_USER_IDS` | `/admin/*` |

JWT rules (same as user-service): HS256 only, same `JWT_SECRET` and `JWT_ISSUER`, `sub` required. Errors: 401 `UNAUTHORIZED` (missing/malformed header), `INVALID_TOKEN`, `TOKEN_EXPIRED`; 403 `FORBIDDEN` (valid token, not an admin). An empty `ADMIN_USER_IDS` means nobody is admin. The JWT and the internal key are not interchangeable.

| Method | Path | Description |
|---|---|---|
| POST | `/admin/cards` | create a card (body = Card fields, `id` required; 409 `CARD_EXISTS`). New cards have 0 stock until set below |
| PATCH | `/admin/cards/:id` | partial update (the id cannot change) |
| DELETE | `/admin/cards/:id` | delete card + stock row (204); 409 `CARD_IN_USE` while an active reservation holds it |
| GET | `/admin/packs` | all packs including inactive |
| POST | `/admin/packs` | create (`rates` must be exactly `common/rare/epic/legendary` and sum to 100, else 422 `INVALID_RATES`) |
| PATCH | `/admin/packs/:id` | partial update; `active:false` hides it from the public API |
| PUT | `/admin/inventory/:cardId` | body `{total}`; 409 `TOTAL_BELOW_RESERVED` if lower than what is currently reserved |

Admin bodies are strict: unknown fields are rejected, strings have length caps and no control characters, image URLs must be `https`. Every admin write is logged as `action target by user <id>` (never the body).

## Security notes

- Internal endpoints compare `X-Internal-Key` in constant time (SHA-256 + `timingSafeEqual`); the key is never logged or returned.
- Public routes are rate limited per IP (`RATE_LIMIT_PER_MINUTE`, default 300; health is exempt). Set `TRUST_PROXY` behind a gateway so the real client IP is used.
- All query/path input is validated with zod (length caps, enum rarity, id pattern); search text is matched literally, never as a regex.
- Responses use explicit field lists; the Gacha service should call `/packs/:id/pool` fresh for each draw because stock changes.
- `JWT_SECRET` and `INTERNAL_API_KEY` are required; in production they must be >= 32 characters.
- The container runs as the non-root `node` user; `.env` is excluded from the image and from git.
- Tests never write to `data/mock-data.json`.
