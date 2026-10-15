# Collection & Fulfillment Service — API Contract

Base URL (local): `http://localhost:3005` · JSON in/out · Service 5 of 5.
Machine-readable spec: [docs/openapi.yaml](docs/openapi.yaml) (open it in https://editor.swagger.io).

## 1. For other services — quick start

| You are | You need | Call |
|---|---|---|
| **Gacha (4)** | give a pulled card to the user | `POST /internal/collections/:userId/cards` (internal) |
| **Gacha / Marketplace** | read any user's cards | `GET /internal/collections/:userId` (internal) |
| **Frontend** | my cards, delivery orders | `/collections/me*`, `/fulfillments/orders*` (user JWT) |
| **Admin UI** | move an order to the next status | `PATCH /admin/fulfillments/orders/:id/status` (admin JWT) |

Gacha after a successful draw (stock already committed in card-catalog-service):

```
POST /internal/collections/{userId}/cards
X-Internal-Key: <INTERNAL_API_KEY>
X-Request-Id: <forward the original one>          (optional)

{ "pullId": "<uuid of this pull>", "cardId": "sv3pt5-199", "quantity": 1 }
```

- `pullId` is the idempotency key: on a network error **retry with the same `pullId`**. A replay answers 200 with
  `created: false` and adds nothing.
- With the catalog enabled (`CATALOG_SERVICE_URL`), name / rarity / image come from `GET /cards/:id` of
  card-catalog-service and anything Gacha sends for them is ignored. With it disabled, `cardName`, `cardRarity`
  and `cardImageUrl` are required.
- `userId` must be a UUID (the `sub` of the user-service JWT).

| Result | Meaning |
|---|---|
| `201 { pullId, created: true, card }` | added |
| `200 { pullId, created: false, card }` | this `pullId` was already applied |
| `400 VALIDATION_ERROR` | bad body, or card details missing while the catalog is disabled |
| `401 UNAUTHORIZED` | missing / wrong `X-Internal-Key` |
| `409 PULL_ID_CONFLICT` | same `pullId` for a different user or card |
| `422 CARD_NOT_FOUND` · `503 CATALOG_SERVICE_UNAVAILABLE` | catalog enabled only |

## 2. Authentication

| Level | How | Routes |
|---|---|---|
| Public | none | `/health*` |
| User | `Authorization: Bearer <JWT from user-service>` | `/collections/me*`, `/fulfillments/orders*` |
| Internal | `X-Internal-Key: <INTERNAL_API_KEY>` (shared secret between services; never expose to browsers) | `/internal/*` |
| Admin | `Authorization: Bearer <JWT>`; the token `sub` must be in `ADMIN_USER_IDS` | `/admin/*` |

JWT: HS256, same `JWT_SECRET` + `JWT_ISSUER` as user-service, `sub` required.

## 3. Conventions

- Errors: `{ "error": { "code": "...", "message": "...", "details": ... } }` (`details` optional).
- Rarity tiers: `common`, `rare`, `epic`, `legendary` (the catalog's).
- Card ids match `^[A-Za-z0-9._-]{1,40}$` (the catalog's); user, order, address and pull ids are UUIDs.
- Lists: query `page` (default 1) and `limit` (default 20, max 100) → `{ data, page, limit, total, totalPages }`.
- Money is whole baht. Request bodies are limited to 10 KB.
- Rate limit: 300 requests/min per IP on all routes except `/health*` → 429 `TOO_MANY_REQUESTS`.
- `X-Request-Id`: sent back on every response and forwarded to every service this one calls.

### Error codes

| HTTP | code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | bad input; `details` = `[{path, message}]` |
| 400 | `INVALID_JSON` | malformed JSON body |
| 401 | `UNAUTHORIZED` · `INVALID_TOKEN` · `TOKEN_EXPIRED` | missing / invalid credentials |
| 402 | `INSUFFICIENT_BALANCE` | wallet could not pay the shipping fee |
| 403 | `FORBIDDEN` | valid JWT but not an admin |
| 404 | `NOT_FOUND` · `ORDER_NOT_FOUND` | |
| 409 | `INSUFFICIENT_QUANTITY` | `details` = `[{cardId, requested, available}]` |
| 409 | `INVALID_STATUS_TRANSITION` | status change not allowed |
| 409 | `PULL_ID_CONFLICT` | `pullId` reused for another user or card |
| 413 | `PAYLOAD_TOO_LARGE` | body over 10 KB |
| 422 | `ADDRESS_NOT_FOUND` · `CARD_NOT_FOUND` | unknown address in user-service / card in the catalog |
| 429 | `TOO_MANY_REQUESTS` | rate limit |
| 503 | `USER_SERVICE_UNAVAILABLE` · `CATALOG_SERVICE_UNAVAILABLE` · `WALLET_SERVICE_UNAVAILABLE` | the other service is down or timed out |

## 4. Collection

### `GET /collections/me` · `GET /internal/collections/:userId`
Query: `rarity`, `page`, `limit`. Sorted by `cardId`.

```json
{
  "data": [
    {
      "cardId": "sv3pt5-199",
      "cardName": "Charizard ex",
      "cardRarity": "legendary",
      "cardImageUrl": "https://images.pokemontcg.io/sv3pt5/199.png",
      "quantity": 2,
      "redeemedQuantity": 1,
      "availableQuantity": 1,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-05T10:00:00.000Z"
    }
  ],
  "page": 1, "limit": 20, "total": 1, "totalPages": 1
}
```

### `GET /collections/me/:cardId`
One card object as above; 404 `NOT_FOUND` if the user does not own it.

## 5. Delivery orders

### `POST /fulfillments/orders`
```json
{ "items": [{ "cardId": "sv3pt5-199", "quantity": 1 }], "addressId": "<uuid from user-service>" }
```
or `"shippingAddress": { "recipientName", "phone", "line1", "line2?", "subdistrict?", "district", "province", "postalCode" }`
instead of `addressId` (exactly one). `cardId`s must be unique within `items`.

→ `201` order:
```json
{
  "id": "…uuid…", "userId": "…", "status": "PENDING",
  "items": [{ "cardId": "sv3pt5-199", "cardName": "Charizard ex", "quantity": 1 }],
  "addressId": "…", "shippingAddress": { "recipientName": "…", "…": "…" },
  "shippingFee": 50, "trackingNumber": null,
  "paymentStatus": "NOT_REQUIRED", "paymentRef": null,
  "statusHistory": [{ "status": "PENDING", "at": "…" }],
  "createdAt": "…", "updatedAt": "…"
}
```
`paymentStatus`: `NOT_REQUIRED` (free shipping or wallet disabled) · `PAID` · `REFUNDED`.

### `GET /fulfillments/orders` · `GET /fulfillments/orders/:id` · `POST /fulfillments/orders/:id/cancel`
List (query `status`, `page`, `limit`, newest first), one order, cancel (only while `PENDING`; returns the cards and
refunds a paid fee). Another user's order answers 404 `ORDER_NOT_FOUND`.

### `PATCH /admin/fulfillments/orders/:id/status`
Body `{ "status": "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED", "trackingNumber"?: "TH123" }` → updated order.

```
PENDING ─► PROCESSING ─► SHIPPED ─► DELIVERED
   │            │
   └──────┬─────┘
          ▼
      CANCELLED   (user: only from PENDING · admin: from PENDING or PROCESSING)
```
`SHIPPED` needs `trackingNumber` (400 otherwise). Any other move → 409 `INVALID_STATUS_TRANSITION`.

## 6. What this service calls

| Service | Request | Expected |
|---|---|---|
| user-service | `GET /users/me/addresses/:id` with the user's `Authorization` | `200 { address }` · `404` → 422 `ADDRESS_NOT_FOUND` |
| card-catalog-service | `GET /cards/:id` | `200 { id, name, rarity, imageSmall, … }` · `404` → 422 `CARD_NOT_FOUND` |
| wallet-service | `POST /internal/wallets/:userId/charge` `{ amount, reason, idempotencyKey: orderId }` + `X-Internal-Key` | `200/201 { transactionId }` · `402` |
| wallet-service | `POST /internal/wallets/:userId/refund` `{ amount, idempotencyKey: "refund-<orderId>" }` + `X-Internal-Key` | `200/201 { transactionId }` |

Timeout 3 s each; 5xx / timeout / unreachable → 503 `<SERVICE>_UNAVAILABLE`. The wallet paths are a proposal for the
wallet owner to confirm.
