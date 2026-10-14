# Card Catalog & Inventory Service — API Contract

Base URL (local): `http://localhost:3003` · JSON in/out · Service 3 of 5.

## 1. For other services — quick start

| You are | You need | Call |
|---|---|---|
| **Gacha (4)** | pack odds + cards you may draw | `GET /packs/:id/pool` (public) |
| | hold stock before giving a card | `POST /inventory/reservations` → later `commit` or `release` |
| **Collection (5)** | check a card can be shipped | `POST /inventory/reservations` (preferred) or `POST /inventory/check` |
| **Wallet (2)** | pack price | `GET /packs/:id` → `priceCredits` |
| **Frontend** | catalog pages | `GET /cards`, `GET /cards/:id`, `GET /packs` |

Recommended draw flow (Gacha):

```
1. GET  /packs/:id/pool                      -> draw cards locally using `rates` and `pool`
2. POST /inventory/reservations              (Idempotency-Key: <orderId>)   -> 201 { id }   | 409 INSUFFICIENT_STOCK -> redraw
3. charge the wallet
4a. success -> POST /inventory/reservations/:id/commit
4b. failure -> POST /inventory/reservations/:id/release
```

On a network error at step 2 or 4, **retry with the same `Idempotency-Key` / reservation id** — it is safe. A reservation expires after 10 minutes if neither commit nor release arrives (410 `RESERVATION_EXPIRED` → start again from step 1).

## 2. Authentication

| Level | How | Routes |
|---|---|---|
| Public | none | `/cards*`, `/packs*`, `GET /inventory/:cardId`, `POST /inventory/check`, `/health*` |
| Internal | `X-Internal-Key: <INTERNAL_API_KEY>` (shared secret between services; never expose to browsers) | `/inventory/reservations*` |
| Admin | `Authorization: Bearer <JWT from user-service>`; the token `sub` must be in `ADMIN_USER_IDS` | `/admin/*` |

JWT: HS256, same `JWT_SECRET` + `JWT_ISSUER` as user-service, `sub` required.

## 3. Conventions

- Errors: `{ "error": { "code": "...", "message": "...", "details": ... } }` (`details` optional).
- Rarity tiers: `common`, `rare`, `epic`, `legendary`.
- `available = total - reserved` (never negative; `0` if the card has no stock row).
- Ids match `^[A-Za-z0-9._-]{1,40}$`. Request bodies are limited to 10 KB.
- Rate limit: 300 requests/min per IP on all routes except `/health*` → 429 `TOO_MANY_REQUESTS`.

### Error codes

| HTTP | code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | bad input; `details` = `[{path, message}]` |
| 400 | `INVALID_JSON` | malformed JSON body |
| 401 | `UNAUTHORIZED` · `INVALID_TOKEN` · `TOKEN_EXPIRED` | missing/invalid credentials |
| 403 | `FORBIDDEN` | valid JWT but not an admin |
| 404 | `NOT_FOUND` · `CARD_NOT_FOUND` · `PACK_NOT_FOUND` · `RESERVATION_NOT_FOUND` | |
| 409 | `INSUFFICIENT_STOCK` | `details` = `[{cardId, requested, available}]` |
| 409 | `RESERVATION_NOT_ACTIVE` | commit after release, or release after commit |
| 409 | `CARD_EXISTS` · `PACK_EXISTS` · `CARD_IN_USE` · `TOTAL_BELOW_RESERVED` | admin conflicts |
| 410 | `RESERVATION_EXPIRED` | reservation timed out; its stock was returned |
| 413 | `PAYLOAD_TOO_LARGE` | body over 10 KB |
| 422 | `IDEMPOTENCY_KEY_REUSED` | same key, different items |
| 422 | `INVALID_RATES` | pack rates do not sum to 100 |
| 429 | `TOO_MANY_REQUESTS` | rate limited |

## 4. Public endpoints

### `GET /cards`
Query (all optional): `q` (name contains, ≤50 chars), `rarity`, `type`, `setId`, `page` (default 1), `limit` (default 20, max 100).

```json
{
  "data": [
    { "id": "sv3pt5-1", "name": "Bulbasaur", "imageSmall": "https://images.pokemontcg.io/sv3pt5/1.png",
      "rarity": "common", "setId": "sv3pt5", "setName": "151", "types": ["Grass"], "hp": 70, "available": 200 }
  ],
  "page": 1, "limit": 20, "total": 160, "totalPages": 8
}
```

### `GET /cards/:id`
Full card: `id, name, imageSmall, imageLarge, rarity, sourceRarity, setId, setName, supertype, subtypes[], types[], hp, attacks[{name,cost[],convertedEnergyCost,damage,text}], weaknesses[{type,value}], retreatCost, artist, available`. 404 `CARD_NOT_FOUND`.

### `GET /packs` · `GET /packs/:id`
Only active packs (inactive → 404 `PACK_NOT_FOUND`).

```json
{ "id": "starter", "name": "Starter Pack", "description": "...", "priceCredits": 100, "cardsPerPack": 5,
  "rates": { "common": 70, "rare": 25, "epic": 4, "legendary": 1 }, "setIds": ["sv3pt5", "swsh7", "base1"] }
```
`/packs` wraps these in `{ "data": [...] }`.

### `GET /packs/:id/pool`
In-stock cards of the pack's sets, grouped by rarity. Out-of-stock cards are never listed. Call it fresh for every draw — stock changes.

```json
{ "packId": "starter", "cardsPerPack": 5,
  "rates": { "common": 70, "rare": 25, "epic": 4, "legendary": 1 },
  "counts": { "common": 60, "rare": 40, "epic": 40, "legendary": 20 },
  "pool": { "common": [ { "id": "base1-23", "name": "Arcanine", "imageSmall": "...", "rarity": "common", "setId": "base1", "available": 200 } ],
            "rare": [], "epic": [], "legendary": [] } }
```
A tier can be an empty array when all its cards are out of stock — handle it (e.g. redraw from another tier).

### `GET /inventory/:cardId`
`{ "cardId": "base1-23", "total": 200, "reserved": 3, "available": 197 }` · 404 `CARD_NOT_FOUND`.

### `POST /inventory/check`
Read-only — holds nothing. Body `{ "items": [{ "cardId": "base1-23", "qty": 2 }] }` (1–50 items, qty 1–100).

```json
{ "allAvailable": true, "items": [ { "cardId": "base1-23", "qty": 2, "available": 197, "ok": true } ] }
```

### `GET /health` · `GET /health/ready`
`{ "status": "ok" }` · `{ "status": "ready" }` (503 `unavailable` if the data store is not loaded).

## 5. Internal endpoints (`X-Internal-Key`)

### `POST /inventory/reservations`
Headers: `X-Internal-Key`, `Idempotency-Key` (8–100 chars of `A-Z a-z 0-9 . _ : -`; use your order/draw id).
Body: `{ "items": [{ "cardId": "base1-23", "qty": 1 }] }` — duplicate cardIds are summed.

- **201** new reservation · **200** replay (same key + same items; header `Idempotent-Replayed: true`, no extra stock held)
- All-or-nothing: if any card is short → 409 `INSUFFICIENT_STOCK` and nothing is held. A failed attempt does not consume the key.
- Same key with different items → 422 `IDEMPOTENCY_KEY_REUSED`. Keys are remembered for 24 h after the reservation finishes.

```json
{ "id": "6f1c6c3e-5b1a-4c55-9d7e-0a2f4f0b8c11", "items": [{ "cardId": "base1-23", "qty": 1 }],
  "status": "reserved", "expiresAt": "2026-10-15T10:10:00.000Z",
  "createdAt": "2026-10-15T10:00:00.000Z", "updatedAt": "2026-10-15T10:00:00.000Z" }
```
`status`: `reserved` → `committed` | `released` | `expired`.

### `POST /inventory/reservations/:id/commit`
Deducts `total` and `reserved`. 200 with the reservation. Repeating returns the same result (stock is not deducted twice).

### `POST /inventory/reservations/:id/release`
Returns the held stock. 200. Repeating is a no-op.

Both: 404 `RESERVATION_NOT_FOUND`, 409 `RESERVATION_NOT_ACTIVE` (opposite action already done), 410 `RESERVATION_EXPIRED`. `:id` must be a UUID.

## 6. Admin endpoints (`Authorization: Bearer <JWT>`)

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/admin/cards` | Card fields (`id`, `name`, `imageSmall`, `imageLarge`, `rarity`, `setId`, `setName`, `hp` required; `https` image URLs) | 201 card (stock starts at 0) · 409 `CARD_EXISTS` |
| PATCH | `/admin/cards/:id` | any subset of the fields (not `id`) | 200 card |
| DELETE | `/admin/cards/:id` | – | 204 · 409 `CARD_IN_USE` while an active reservation holds it |
| GET | `/admin/packs` | – | `{data}` including inactive packs |
| POST | `/admin/packs` | `id, name, priceCredits, cardsPerPack, rates{common,rare,epic,legendary}, setIds[]`, optional `description`, `active` | 201 pack · 422 `INVALID_RATES` · 409 `PACK_EXISTS` |
| PATCH | `/admin/packs/:id` | any subset (`active:false` hides the pack) | 200 pack |
| PUT | `/admin/inventory/:cardId` | `{ "total": 120 }` | 200 `{cardId,total,reserved,available}` · 409 `TOTAL_BELOW_RESERVED` |

Unknown body fields are rejected (400). Admin writes are logged as `action target by user <id>`.

## 7. Configuration

| Env | Default | Notes |
|---|---|---|
| `PORT` | 3003 | |
| `JWT_SECRET` | – (required) | same as user-service; ≥32 chars in production |
| `JWT_ISSUER` | `user-service` | |
| `INTERNAL_API_KEY` | – (required) | ≥32 chars in production; share with Gacha/Collection only |
| `ADMIN_USER_IDS` | empty | comma-separated user ids; empty = no admins |
| `RESERVATION_TTL_SECONDS` | 600 | |
| `RESERVATION_SWEEP_SECONDS` | 30 | background expiry sweep |
| `RATE_LIMIT_PER_MINUTE` | 300 | per IP |
| `TRUST_PROXY` | empty | set to `1` behind the API gateway |
| `CORS_ORIGIN` | `*` | comma-separated origins in production |
| `PERSIST_DATA` / `DATA_FILE` | true / `data/mock-data.json` | |

## 8. Open points to agree as a team

- Rarity tier names and the `rates` shape (Gacha).
- Who is in `ADMIN_USER_IDS`, and the value of `INTERNAL_API_KEY` for all services.
- Mock JSON for the whole project, or move to PostgreSQL at integration time (reservation logic then needs DB transactions).
- Whether Collection uses reservations (recommended) or only `/inventory/check` before shipping.
