# Collection & Fulfillment Service (Service 5)

Keeps every user's digital card collection and handles requests to ship real cards.
Default port: **3005**. Built with **NestJS 11 + TypeScript**, following the same conventions as
[card-catalog-service](../card-catalog-service). **Full API contract for the team: [API.md](API.md)**
(machine-readable: [docs/openapi.yaml](docs/openapi.yaml), checked by the contract test).

## Run locally

```bash
cp .env.example .env     # then set JWT_SECRET (same as user-service) and INTERNAL_API_KEY (openssl rand -hex 32)
npm install
npm run dev
```

To create orders with `addressId`, user-service must be running on `USER_SERVICE_URL` (default `http://localhost:3001`).
To use admin endpoints, put your user id (the JWT `sub`) in `ADMIN_USER_IDS`.

## Run with Docker

```bash
cp .env.example .env
docker compose up --build                # this service only
cd .. && docker compose up --build       # user-service + card-catalog-service + this service (repo root)
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Nest watch mode |
| `npm run build` / `npm start` | compile to `dist/` / run compiled build |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm test` | all tests |
| `npm run test:unit` · `npm run test:integration` | one group |
| `npm run test:coverage` | tests with coverage (CI fails below 80%) |

## Mock data

`data/mock-data.json` holds `collections`, `pulls` (applied Gacha pulls) and `orders`. The seed gives cards from the
catalog's mock data to the two mock users of user-service (password `password123`):

| User | id | Cards |
|---|---|---|
| somchai@example.com | `a1b2c3d4-0001-4000-8000-000000000001` | Charizard ex ×2, Arcanine ×5, Beedrill, Alakazam |
| somying@example.com | `a1b2c3d4-0002-4000-8000-000000000002` | Leafeon V, Bulbasaur ×3 |

Changes are written back to the file (`PERSIST_DATA`, off in tests). Writes run one at a time inside a transaction that
rolls back on error, and the file is replaced atomically.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/collections/me` | user JWT | my cards; query `rarity`, `page`, `limit` → `{data, page, limit, total, totalPages}` |
| GET | `/collections/me/:cardId` | user JWT | one of my cards |
| POST | `/internal/collections/:userId/cards` | `X-Internal-Key` | (Gacha) add a pulled card, idempotent by `pullId` |
| GET | `/internal/collections/:userId` | `X-Internal-Key` | any user's collection |
| POST | `/fulfillments/orders` | user JWT | ask to ship cards (all-or-nothing) |
| GET | `/fulfillments/orders` | user JWT | my orders, newest first; query `status`, `page`, `limit` |
| GET | `/fulfillments/orders/:id` | user JWT | one order (someone else's answers 404) |
| POST | `/fulfillments/orders/:id/cancel` | user JWT | cancel while `PENDING` |
| PATCH | `/admin/fulfillments/orders/:id/status` | admin JWT | move an order through the state machine |
| GET | `/health` · `/health/ready` | public | liveness / readiness |

Each card shows `quantity`, `redeemedQuantity` (held by orders that are not cancelled) and
`availableQuantity = quantity - redeemedQuantity`.

### Order rules

- **All or nothing**: every line is checked first; if any card is short the request fails with 409
  `INSUFFICIENT_QUANTITY` (`details` = `[{cardId, requested, available}]`) and nothing is held.
- **Address**: `addressId` (read from user-service with the caller's token) or an inline `shippingAddress`, exactly one.
  The address is copied into the order, so later edits in user-service do not change it.
- **Shipping**: 50 baht, free from 5 cards, at most 50 cards per order (`SHIPPING_FLAT_FEE`,
  `FREE_SHIPPING_MIN_CARDS`, `MAX_CARDS_PER_ORDER`).
- **Status**: `PENDING → PROCESSING → SHIPPED → DELIVERED`; `PENDING → CANCELLED` (user or admin);
  `PROCESSING → CANCELLED` (admin only). `SHIPPED` needs a `trackingNumber`. Cancelling returns the cards.
- **Wallet** (`WALLET_ENABLED=true`): the fee is charged with `idempotencyKey = orderId`; if the charge fails (402 / 503)
  the cards are released and the order is dropped. Cancelling a paid order refunds it first (`refund-<orderId>`).

## Authentication

| Level | How | Used for |
|---|---|---|
| Public | none | `/health*` |
| User | `Authorization: Bearer <JWT from user-service>` | `/collections/me*`, `/fulfillments/*` |
| Internal | header `X-Internal-Key: <INTERNAL_API_KEY>` | `/internal/*` (Gacha, other services) |
| Admin | user JWT whose `sub` is in `ADMIN_USER_IDS` | `/admin/*` |

JWT rules (same as user-service and card-catalog-service): HS256 only, same `JWT_SECRET` and `JWT_ISSUER`, `sub`
required. Errors: 401 `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`; 403 `FORBIDDEN` (valid token, not an admin).
The JWT and the internal key are not interchangeable.

## Other services

| Service | Call | When it is off |
|---|---|---|
| user-service | `GET /users/me/addresses/:id` with the user's Bearer | `addressId` orders fail with 503 `USER_SERVICE_UNAVAILABLE` |
| card-catalog-service | `GET /cards/:id` → `name`, `rarity`, `imageSmall` | `CATALOG_SERVICE_URL` empty: card details sent by Gacha are used |
| wallet-service | `POST /internal/wallets/:userId/charge` · `/refund` with `X-Internal-Key` | `WALLET_ENABLED=false`: `paymentStatus = NOT_REQUIRED` |

Every outgoing call has a timeout (3 s) and forwards `X-Request-Id`; a 5xx, timeout or connection error becomes
503 `<SERVICE>_UNAVAILABLE`.

## Configuration

See [.env.example](.env.example). Required: `JWT_SECRET`, `INTERNAL_API_KEY` (both >= 32 characters in production;
the service refuses to start otherwise).

## Security notes

- `X-Internal-Key` is compared in constant time (SHA-256 + `timingSafeEqual`) and never logged.
- All routes except `/health*` are rate limited per IP (`RATE_LIMIT_PER_MINUTE`, default 300). Set `TRUST_PROXY` behind a gateway.
- All input is validated with zod (strict bodies, id pattern, UUIDs, enum rarity); bodies are limited to 10 KB.
- Another user's order answers 404, the same as a missing one.
- helmet headers, no `x-powered-by`, 500s never leak internals.
- The container runs as the non-root `node` user; `.env` is excluded from the image and from git.

## CI/CD

`.github/workflows/collection-service-ci.yml` (repo root) runs lint, typecheck, build and tests with coverage on every
pull request, then builds the Docker image and pushes it to GHCR on `main`.
`.github/workflows/collection-service-release.yml` publishes a versioned image and GitHub Release for tags
`collection-service-vX.Y.Z`. Test plan: [docs/TEST_SPEC.md](docs/TEST_SPEC.md).
