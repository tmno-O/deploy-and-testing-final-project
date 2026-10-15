# Test Specification: Collection & Fulfillment Service

**Tools:** Jest 29 + ts-jest + Supertest · contract test with `jest-openapi` · coverage >= 80% on every metric
(enforced by `coverageThreshold`, so CI fails below it).

```bash
npm test                  # everything
npm run test:unit
npm run test:integration  # Supertest against the real Nest app, no port opened
npm run test:coverage     # + report in coverage/
```

## Principles
- No database: every test starts from an empty in-memory store (`store.reset()`), and `PERSIST_DATA=false` keeps
  `data/mock-data.json` untouched.
- Other services do not run: integration tests replace `global.fetch`, so the real HTTP client is exercised end to end;
  a few tests spy on a client directly.
- Tokens are signed with the same secret / issuer as user-service (`tests/helpers/auth.ts`).
- The rate limit is raised in `tests/setup-env.ts`; `rate-limit.test.ts` builds its own app with a limit of 3.

## Unit tests (`tests/unit`)
| File | Cases |
|---|---|
| `shipping.test.ts` | 1, 4, 5 (boundary), 2+3, 50 cards → 50/50/0/0/0 baht · 0 and 51 cards → 400 · configured values |
| `state-machine.test.ts` | every status pair against `TRANSITIONS` · user may only cancel `PENDING` · `SHIPPED` without tracking → 400 |
| `http-client.test.ts` | 200 / 4xx returned to the caller · 5xx, timeout, connection error, invalid JSON → 503 · forwards `X-Request-Id` |
| `auth.guards.test.ts` | JWT guard sets the user id · admin needs `ADMIN_USER_IDS` · internal key missing / wrong / prefix / repeated → 401 |
| `store.test.ts` | missing file → empty · bad keys ignored · persist after commit, no temp file left · **failed transaction rolls back memory and file** · one transaction at a time |
| `config.test.ts` | defaults · required secrets · short secrets in production · lists, trust proxy, numbers · invalid numbers · wallet needs a URL |
| `fulfillment.service.test.ts` | cancel returns cards · call context reaches the wallet · status race while waiting for the refund · parallel orders never over-redeem · parallel retries of one pull add once |
| `app-error.test.ts` | error filter shapes for AppError, Nest exceptions and unknown errors (no leak) |

## Integration tests (`tests/integration`)
| File | Cases |
|---|---|
| `health.test.ts` | `/health`, `/health/ready` (503 when the store is broken) · standard 404 · `X-Request-Id` generated / echoed / replaced · invalid JSON 400, large body 413 · helmet headers |
| `auth.test.ts` | no token, wrong scheme, extra parts, bad signature, wrong issuer, expired, `alg: none`, no `sub`, HS512 → 401 · internal key not accepted for users · JWTs not accepted on `/internal` · internal key not accepted on `/admin` |
| `internal.test.ts` | add 201 · same `pullId` → 200, added once · new pull of the same card → +1 · `PULL_ID_CONFLICT` · missing card details → 400 · validation · list any user |
| `collection.test.ts` | quantities · page/limit · rarity filter · bad query 400 · only my cards · 404 / 400 for one card · users cannot add cards |
| `fulfillment.test.ts` | create and hold cards · free from 5 · short → 409 and **store unchanged** · no double redeem · over 50 → 400 · body validation · `addressId` via user-service, 422/503 keep the cards · list newest first + filter · IDOR → 404 · cancel rules |
| `admin.test.ts` | 401 without token, 403 for non-admin · full flow with history · tracking required · invalid moves 409 · admin cancel while `PROCESSING` · 400 / 404 |
| `upstreams.test.ts` | **catalog on:** data from the catalog, 404 → 422, down / bad body → 503 and nothing added · **catalog off:** never called · **wallet on:** `PAID` with `X-Internal-Key` and idempotency key, 402 / down / 500 / bad body → no order and cards back, free shipping not charged, refund on cancel, failed refund keeps the order · **wallet off:** never called · **user-service:** token and `X-Request-Id` forwarded, every error mapping |
| `rate-limit.test.ts` | 429 after the limit, `/health` never limited |
| `contract.test.ts` | responses of every endpoint (success and errors) match `docs/openapi.yaml` |

## End-to-end (manual, repo root)

```bash
cp .env.example .env            # set the secrets; ADMIN_USER_IDS defaults to somying
docker compose up --build       # user-service :3001, card-catalog-service :3003, collection-service :3005
source .env
TOKEN=$(curl -s -XPOST localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"somchai@example.com","password":"password123"}' | jq -r .accessToken)

# act as Gacha: card details come from the catalog
curl -XPOST localhost:3005/internal/collections/a1b2c3d4-0001-4000-8000-000000000001/cards \
  -H "X-Internal-Key: $INTERNAL_API_KEY" -H 'Content-Type: application/json' \
  -d '{"pullId":"6f1c2b9e-4b8e-4c55-9d1a-111111111111","cardId":"swsh7-4","quantity":5}'

ORDER=$(curl -s -XPOST localhost:3005/fulfillments/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"cardId":"swsh7-4","quantity":5}],"addressId":"<an address id of somchai>"}' | jq -r .id)

ADMIN=$(curl -s -XPOST localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"somying@example.com","password":"password123"}' | jq -r .accessToken)
for body in '{"status":"PROCESSING"}' '{"status":"SHIPPED","trackingNumber":"TH123"}' '{"status":"DELIVERED"}'; do
  curl -XPATCH localhost:3005/admin/fulfillments/orders/$ORDER/status -H "Authorization: Bearer $ADMIN" \
    -H 'Content-Type: application/json' -d "$body"; done
```
Then `docker compose stop user-service` and create an order with `addressId` again → 503 `USER_SERVICE_UNAVAILABLE`.
