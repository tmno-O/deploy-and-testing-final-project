# Wallet & Payment Service — API Contract

Base URL (local): `http://localhost:3002` · JSON in/out · Service 2 of 5.

Money is **whole credits** (integers, 1 credit = 1 baht — see `SERVICE_CONVENTIONS.md`). The wallet keeps an
append-only ledger: every change of a balance is one transaction row, and `balanceAfter` of one row equals
`balanceBefore` of the next.

## 1. For other services — quick start

| You are | You need | Call |
|---|---|---|
| **Frontend** | show balance / history | `GET /wallets/me` · `GET /wallets/me/transactions` |
| | top up | `GET /wallets/topup-methods` → `POST /wallets/me/topups` |
| **Gacha (4)** | sell a pack | `POST /internal/wallets/:userId/purchases` `{ packId }` — the wallet reads the price from card-catalog-service |
| | undo it if the draw fails | `POST /internal/wallets/:userId/refund` `{ amount, transactionId }` |
| **Collection (5)** | shipping fee | `POST /internal/wallets/:userId/charge` · `POST /internal/wallets/:userId/refund` (already matches `WalletClient`) |

Recommended pack flow (Gacha), with the catalog's reservation flow:

```
1. POST catalog /inventory/reservations           (Idempotency-Key: <pullId>)
2. POST wallet  /internal/wallets/:userId/purchases   { packId, idempotencyKey: <pullId> }
      402 INSUFFICIENT_BALANCE -> release the reservation, tell the user
      503 *_UNAVAILABLE        -> retry with the SAME key (safe), or release
3a. success -> POST catalog /inventory/reservations/:id/commit
3b. failure after paying -> POST wallet /internal/wallets/:userId/refund { amount, transactionId, idempotencyKey: "refund-<pullId>" }
```

## 2. Authentication

| Level | How | Routes |
|---|---|---|
| Public | none | `GET /wallets/topup-methods`, `/health*` |
| User | `Authorization: Bearer <JWT from user-service>` (HS256, same `JWT_SECRET` + `JWT_ISSUER`, `sub` = user id) | `/wallets/me*` — the user id always comes from the token, never from the URL or body |
| Internal | `X-Internal-Key: <INTERNAL_API_KEY>` (shared secret between services; never expose to browsers) | `/internal/*` |
| Admin | user JWT whose `sub` is in `ADMIN_USER_IDS` | `/admin/*` (read-only) |

## 3. Conventions

- Errors: `{ "error": { "code": "...", "message": "...", "details": ... } }` (`details` optional).
- Request bodies are limited to 10 KB; unknown body fields are rejected (400).
- Rate limit: 300 requests/min per IP on all routes except `/health*` → 429 `TOO_MANY_REQUESTS`.
- Tracing: `X-Request-Id` is accepted (or created), returned, logged and forwarded to the catalog.
- Pagination: `?page=&limit=` (default 1 / 20, max 100) → `{ data, page, limit, total, totalPages }`.

### Idempotency (no double charge)

Every request that moves money needs an idempotency key: the `Idempotency-Key` header **or** `idempotencyKey` in
the body (8–100 chars of `A-Z a-z 0-9 . _ : -`; if both are sent they must match). Use your own order / pull id.

| Situation | Result |
|---|---|
| first time | **201** + the new transaction |
| same key, same request again | **200** + the original result, header `Idempotent-Replayed: true`, nothing changes. Works even if the catalog or the payment provider is down |
| same key, different `amount` / `packId` / `transactionId` / type | **422** `IDEMPOTENCY_KEY_REUSED` |
| the request failed (402, 503, ...) | nothing was written, the key is **not** used up — retry with the same key |

Keys are scoped per user and kept forever (they are part of the ledger). `reason` is not part of the comparison.
Requests sent at the same time are handled one after another, so two requests can never spend the same credits.

### Operation response (all `POST` that move money)

```json
{
  "transactionId": "6f1c6c3e-5b1a-4c55-9d7e-0a2f4f0b8c11",
  "balance": 700,
  "transaction": {
    "id": "6f1c6c3e-5b1a-4c55-9d7e-0a2f4f0b8c11", "userId": "…", "type": "purchase", "direction": "debit",
    "amount": 300, "balanceBefore": 1000, "balanceAfter": 700,
    "reason": "Pack purchase: Premium Pack", "packId": "premium", "refundOf": null,
    "method": null, "provider": null, "providerRef": null,
    "idempotencyKey": "pull-0001-abcdef", "createdAt": "2026-10-15T10:00:00.000Z"
  }
}
```
`type`: `topup` (credit) · `purchase` (debit) · `charge` (debit) · `refund` (credit).

### Error codes

| HTTP | code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | bad input; `details` = `[{path, message}]` (also: missing / bad idempotency key, amount outside the top-up range, unknown method) |
| 400 | `INVALID_JSON` | malformed JSON body |
| 401 | `UNAUTHORIZED` · `INVALID_TOKEN` · `TOKEN_EXPIRED` | missing/invalid credentials |
| 402 | `INSUFFICIENT_BALANCE` | `details` = `{ balance, required }` |
| 402 | `PAYMENT_DECLINED` | the payment provider refused the top-up (real providers only) |
| 403 | `FORBIDDEN` | valid JWT but not an admin |
| 404 | `NOT_FOUND` · `TRANSACTION_NOT_FOUND` | |
| 409 | `REFUND_EXCEEDS_CHARGE` | `details` = `{ charged, refunded, requested }` |
| 413 | `PAYLOAD_TOO_LARGE` | body over 10 KB |
| 422 | `IDEMPOTENCY_KEY_REUSED` | same key, different request |
| 422 | `PACK_NOT_FOUND` | catalog does not know the pack, or it is not on sale |
| 422 | `TRANSACTION_NOT_FOUND` · `NOT_REFUNDABLE` | refund of a transaction that is not the user's / is a credit |
| 422 | `BALANCE_LIMIT_EXCEEDED` | a top-up would pass `MAX_BALANCE` |
| 429 | `TOO_MANY_REQUESTS` | rate limited |
| 503 | `CATALOG_SERVICE_UNAVAILABLE` | catalog down, timed out, answered badly, or `CATALOG_SERVICE_URL` is empty |
| 503 | `PAYMENT_PROVIDER_UNAVAILABLE` | provider down (real providers only) |

## 4. User endpoints

### `GET /wallets/topup-methods` (public)
```json
{ "provider": "mock", "methods": ["mock"], "minAmount": 1, "maxAmount": 100000, "maxBalance": 10000000 }
```
With `provider: "mock"` top-ups are **free test credits**.

### `GET /wallets/me`
```json
{ "userId": "…", "balance": 700, "createdAt": "…", "updatedAt": "…" }
```
A user who never topped up gets `balance: 0` and `createdAt/updatedAt: null` (reading never creates a wallet).

### `POST /wallets/me/topups`
Headers: `Authorization`, `Idempotency-Key`. Body: `{ "amount": 300, "method": "mock" }` (`method` optional, defaults to the provider's first).
→ **201** operation response (`type: "topup"`, with `method`, `provider`, `providerRef`) · 400 · 402 `PAYMENT_DECLINED` · 422 `BALANCE_LIMIT_EXCEEDED`.
The provider is called once per key; a replay never reaches it again.

### `GET /wallets/me/transactions`
Query: `type` (`topup|purchase|charge|refund`), `page`, `limit`. Newest first. Only your own rows.

### `GET /wallets/me/transactions/:id`
One transaction (`:id` is a UUID). Another user's id answers 404 like an unknown one.

## 5. Internal endpoints (`X-Internal-Key`)

`:userId` is `[A-Za-z0-9._-]{1,64}` (a UUID in practice).

### `GET /internal/wallets/:userId`
Same body as `GET /wallets/me`.

### `POST /internal/wallets/:userId/purchases`
Body: `{ "packId": "premium", "idempotencyKey": "pull-0001-abcdef" }`.
The wallet calls `GET {CATALOG_SERVICE_URL}/packs/:packId` and charges `priceCredits`. **A price cannot be sent**
(`price`/`amount` are rejected) and nothing is cached: a price change in the catalog applies to the next purchase.
→ **201** operation response (`type: "purchase"`, `packId`) · 402 · 422 `PACK_NOT_FOUND` · 503 `CATALOG_SERVICE_UNAVAILABLE`.

### `POST /internal/wallets/:userId/charge`
Body: `{ "amount": 50, "reason": "Shipping fee for order …", "idempotencyKey": "<orderId>" }` (`reason` optional, ≤200 chars).
→ **201** operation response (`type: "charge"`) · 402. This is the call `collection-service` makes.

### `POST /internal/wallets/:userId/refund`
Body: `{ "amount": 50, "idempotencyKey": "refund-<orderId>", "transactionId"?: "<uuid>", "reason"?: "…" }`.

- With `transactionId` (a charge or purchase of the same user): refunds add up to at most the original amount, also
  across several partial refunds → 409 `REFUND_EXCEEDS_CHARGE`; a top-up or someone else's transaction → 422.
- Without it: a plain credit (what `collection-service` sends today). The wallet cannot check it against a charge.

Refunds are not limited by `MAX_BALANCE`. → **201** operation response (`type: "refund"`, `refundOf`).

## 6. Admin endpoints (`Authorization: Bearer <JWT>` of an admin, read-only)

| Method | Path | Result |
|---|---|---|
| GET | `/admin/wallets/:userId` | wallet + `audit: { balance, ledgerBalance, transactionCount, consistent }` |
| GET | `/admin/wallets/:userId/transactions` | same list as the user endpoint (`type`, `page`, `limit`) |

`consistent: false` means the stored balance does not match the ledger replayed from the first row (or a row was
changed / removed) — investigate before anything else.

## 7. Health

`GET /health` → `{ "status": "ok" }` · `GET /health/ready` → `{ "status": "ready" }` (503 `unavailable` if the data store is not loaded).

## 8. Configuration

| Env | Default | Notes |
|---|---|---|
| `PORT` | 3002 | |
| `JWT_SECRET` | – (required) | same as user-service; ≥32 chars in production |
| `JWT_ISSUER` | `user-service` | |
| `INTERNAL_API_KEY` | – (required) | ≥32 chars in production; same value in every service |
| `ADMIN_USER_IDS` | empty | comma-separated user ids; empty = no admins |
| `CATALOG_SERVICE_URL` | `http://localhost:3003` | unset = default, empty = disabled (purchases answer 503) |
| `CATALOG_SERVICE_TIMEOUT_MS` | 3000 | |
| `PAYMENT_PROVIDER` | `mock` | the only supported value; any other value stops the service at boot |
| `TOPUP_MIN_AMOUNT` / `TOPUP_MAX_AMOUNT` | 1 / 100000 | whole credits per top-up |
| `MAX_BALANCE` | 10000000 | a wallet cannot hold more (top-ups only; refunds always go through) |
| `RATE_LIMIT_PER_MINUTE` | 300 | per IP |
| `TRUST_PROXY` | empty | set to `1` behind the API gateway |
| `CORS_ORIGIN` | `*` | comma-separated origins in production |
| `PERSIST_DATA` / `DATA_FILE` | true / `data/mock-data.json` | |

## 9. Open points to agree as a team

See [`link.md`](link.md): what is connected, what cannot be connected yet and why.
