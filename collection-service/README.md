# Collection & Fulfillment Service

Service ที่ 5 ของโปรเจกต์ Online Trading Card Gacha Platform ดูแลคอลเลกชันการ์ดดิจิทัลของผู้ใช้ และการขอจัดส่งการ์ดจริง (Redemption): นับการ์ดซ้ำ จองการ์ด คำนวณค่าส่ง และติดตามสถานะพัสดุ

**Stack:** Node.js 20 · Express 4 · mock data JSON (ไม่มี database) · JWT (HS256, ออกโดย user-service) · zod · Jest + Supertest · Docker · GitHub Actions

เอกสารเพิ่มเติม: [API spec (OpenAPI)](docs/openapi.yaml) · [Contracts กับ service อื่น](docs/CONTRACTS.md) · [Test spec](docs/TEST_SPEC.md) · [ข้อตกลงกลางของทีม](../SERVICE_CONVENTIONS.md)

## เริ่มใช้งาน

### แบบ Docker คู่กับ user-service (แนะนำ)
ใช้ compose ที่ root ของ repo:
```bash
cd ..                       # root ของ repo
cp .env.example .env        # แก้ JWT_SECRET, SERVICE_API_KEY, ADMIN_API_KEY (openssl rand -hex 32)
docker compose up --build   # user-service :3001, collection-service :3005
```

### แบบ Docker เดี่ยว
```bash
cp .env.example .env
docker compose up --build   # http://localhost:3005 (ถ้าจะใช้ addressId ต้องมี user-service ที่ :3001 ของเครื่อง)
```

### แบบรันในเครื่อง
```bash
npm install
cp .env.example .env        # JWT_SECRET ต้องตรงกับ user-service
npm run dev
```

## Mock data
ข้อมูลเก็บใน [`data/mock-data.json`](data/mock-data.json) (`collections`, `pulls`, `orders`) โหลดเข้า memory ตอนเริ่ม และเขียนกลับไฟล์เมื่อ transaction สำเร็จ
(`PERSIST_DATA=false` = ไม่แก้ไฟล์) มีการ์ดตัวอย่างของบัญชีใน mock data ของ user-service:

| ผู้ใช้ | การ์ด |
|---|---|
| `somchai@example.com` | CARD-001 ×3 (ULTRA_RARE), CARD-002 ×5 (COMMON), CARD-003 ×1 (RARE) |
| `somying@example.com` | CARD-004 ×1 (SECRET_RARE) |

login ที่ user-service (รหัสผ่าน `password123`) แล้วใช้ token นั้นเรียก service นี้ได้เลย

## Auth
JWT ของ user-service มีแค่ `sub` + `iss` (ไม่มี role) จึงแยก caller เป็น 3 แบบ:

| Caller | Header | ใช้กับ |
|---|---|---|
| ผู้ใช้ | `Authorization: Bearer <JWT>` (HS256, `iss=user-service`) | `/collections/me*`, `/fulfillments/orders*` |
| Service (Gacha) | `X-Service-Key: <SERVICE_API_KEY>` | `/internal/*` |
| Admin | `X-Admin-Key: <ADMIN_API_KEY>` | `/admin/*` |

- Bearer ของผู้ใช้ใช้กับ `/internal` และ `/admin` ไม่ได้ (401) ผู้ใช้จึงเพิ่มการ์ดให้ตัวเองไม่ได้
- key เทียบด้วย `crypto.timingSafeEqual` · production: key สั้นกว่า 32 ตัวอักษร → ไม่ยอม start

## API
ทุก error มีรูปแบบเดียวกับ user-service: `{ "error": { "code": "...", "message": "...", "details": ... } }` · ทุก response มี `X-Request-Id`

| Method | Path | Auth | คำอธิบาย |
|---|---|---|---|
| GET | `/health` · `/health/ready` | - | liveness / readiness |
| GET | `/collections/me?limit=&offset=&rarity=` | User | การ์ดของฉัน พร้อม `quantity`, `redeemedQuantity`, `availableQuantity` |
| GET | `/collections/me/:cardId` | User | การ์ด 1 ใบ (ไม่มี → 404) |
| POST | `/internal/collections/:userId/cards` | Service | Gacha เพิ่มการ์ด `{ pullId, cardId, cardName?, cardRarity?, cardImageUrl?, quantity? }` · ใหม่ 201 · `pullId` ซ้ำ 200 ไม่เพิ่มซ้ำ |
| GET | `/internal/collections/:userId` | Service | คอลเลกชันของผู้ใช้ใดก็ได้ |
| POST | `/fulfillments/orders` | User | สร้าง order `{ items: [{ cardId, quantity }], addressId }` หรือ `{ items, shippingAddress }` |
| GET | `/fulfillments/orders?limit=&offset=&status=` | User | order ของฉัน (ใหม่สุดก่อน) |
| GET | `/fulfillments/orders/:id` | User | order 1 รายการ (ของคนอื่น → 404) |
| POST | `/fulfillments/orders/:id/cancel` | User | ยกเลิกได้เฉพาะ `PENDING` คืนการ์ด (และคืนค่าส่งถ้าจ่ายแล้ว) |
| PATCH | `/admin/fulfillments/orders/:id/status` | Admin | `{ status, trackingNumber? }` ตาม state machine |

### ตัวอย่าง
```bash
# Gacha เพิ่มการ์ด
curl -X POST localhost:3005/internal/collections/a1b2c3d4-0001-4000-8000-000000000001/cards \
  -H "X-Service-Key: $SERVICE_API_KEY" -H 'Content-Type: application/json' \
  -d '{"pullId":"6f1c2b9e-4b8e-4c55-9d1a-000000000001","cardId":"CARD-005","cardName":"Moon Fox","cardRarity":"RARE","cardImageUrl":"https://example.com/5.png"}'

# ผู้ใช้ขอส่งการ์ดจริง (ที่อยู่จาก user-service)
curl -X POST localhost:3005/fulfillments/orders -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"items":[{"cardId":"CARD-002","quantity":5}],"addressId":"<id ที่อยู่ใน user-service>"}'
```

### Error codes
`VALIDATION_ERROR` 400 · `INVALID_JSON` 400 · `UNAUTHORIZED` / `INVALID_TOKEN` / `TOKEN_EXPIRED` / `INVALID_API_KEY` 401 · `INSUFFICIENT_BALANCE` 402 · `NOT_FOUND` 404 · `INSUFFICIENT_QUANTITY` / `INVALID_STATUS_TRANSITION` / `PULL_ID_CONFLICT` 409 · `ADDRESS_NOT_FOUND` / `CARD_NOT_FOUND` 422 · `USER_SERVICE_UNAVAILABLE` / `CATALOG_SERVICE_UNAVAILABLE` / `WALLET_SERVICE_UNAVAILABLE` 503

## Business rules
- **ค่าส่ง:** รวมจำนวนการ์ดใน order ≥ `FREE_SHIPPING_MIN_CARDS` (5) → ฟรี, ไม่ถึง → `SHIPPING_FLAT_FEE` (50 บาท) · สูงสุด `MAX_CARDS_PER_ORDER` (50) ใบ
- **สร้าง order แบบ all-or-nothing:** ดึงที่อยู่ก่อน (user-service ล่ม → 503 ไม่แตะการ์ด) แล้วตรวจทุกใบใน transaction เดียว ใบไหนไม่พอ → 409 พร้อม `details` และไม่จองใบไหนเลย
- **ที่อยู่** เป็น snapshot ณ ตอนสั่ง ฟิลด์เดียวกับ user-service
- **State machine:** `PENDING → PROCESSING → SHIPPED → DELIVERED` · `PENDING → CANCELLED` (ผู้ใช้หรือ admin) · `PROCESSING → CANCELLED` (admin) · นอกนั้น 409 · `SHIPPED` ต้องมี `trackingNumber` · `CANCELLED` คืน `redeemedQuantity`
- **Idempotency:** Gacha ส่ง `pullId` ซ้ำได้ผลเดิม · Wallet ใช้ `orderId` / `refund-<orderId>` เป็น idempotencyKey

## จุดเชื่อม service อื่น (เปิดด้วย env ไม่ต้องแก้โค้ด)
ทุกการเรียกออกอยู่ใน `src/clients/` ผ่าน `httpClient` (timeout, ส่งต่อ `X-Request-Id`, แปลง 5xx/timeout เป็น 503)

| Client | เปิดเมื่อ | ตอนปิด |
|---|---|---|
| `userClient` | เสมอ (`USER_SERVICE_URL`) | — |
| `catalogClient` | ตั้ง `CATALOG_SERVICE_URL` | ใช้ข้อมูลการ์ดที่ Gacha ส่งมา (ต้องครบ) |
| `walletClient` | `WALLET_ENABLED=true` + `WALLET_SERVICE_URL` | ไม่ตัดค่าส่ง `paymentStatus = NOT_REQUIRED` |

รายละเอียด contract ดู [`docs/CONTRACTS.md`](docs/CONTRACTS.md)

## Environment variables
| ชื่อ | จำเป็น | ค่าเริ่มต้น | หมายเหตุ |
|---|---|---|---|
| `JWT_SECRET` | ใช่ | - | ค่าเดียวกับ user-service · production ≥ 32 ตัวอักษร |
| `JWT_ISSUER` | | `user-service` | |
| `SERVICE_API_KEY` | ใช่ | - | production ≥ 32 ตัวอักษร |
| `ADMIN_API_KEY` | ใช่ | - | production ≥ 32 ตัวอักษร |
| `PORT` | | `3005` | |
| `USER_SERVICE_URL` | | `http://localhost:3001` | |
| `USER_SERVICE_TIMEOUT_MS` | | `3000` | |
| `SHIPPING_FLAT_FEE` | | `50` | บาท |
| `FREE_SHIPPING_MIN_CARDS` | | `5` | |
| `MAX_CARDS_PER_ORDER` | | `50` | |
| `CATALOG_SERVICE_URL` | | ว่าง (ปิด) | |
| `CATALOG_SERVICE_TIMEOUT_MS` | | `3000` | |
| `WALLET_ENABLED` | | `false` | `true` ต้องตั้ง `WALLET_SERVICE_URL` ด้วย |
| `WALLET_SERVICE_URL` | | ว่าง | |
| `WALLET_SERVICE_TIMEOUT_MS` | | `3000` | |
| `DATA_FILE` | | `data/mock-data.json` | |
| `PERSIST_DATA` | | `true` (`false` ตอน test) | |
| `CORS_ORIGIN` | | `*` | คั่นด้วย comma |

## ทดสอบ
```bash
npm test                 # ทั้งหมด (199 tests)
npm run test:unit
npm run test:integration
npm run test:coverage    # ต้อง ≥ 80% ทุกหมวด ไม่งั้นล้ม (ปัจจุบัน ~98%)
npm run lint
```
รายละเอียดเคสทั้งหมดและขั้นตอน E2E: [`docs/TEST_SPEC.md`](docs/TEST_SPEC.md)

## โครงสร้าง
```
src/
  app.js server.js config.js errors.js schemas.js
  middleware/   auth (user / service / admin), requestId, validate, errorHandler, async
  clients/      httpClient, userClient, catalogClient, walletClient
  services/     collectionService, fulfillmentService, shipping, stateMachine
  repositories/ collectionRepo, orderRepo (async ทุก method)
  store/        jsonStore (in-memory + JSON file + mutex transaction)
data/           mock-data.json
docs/           openapi.yaml, CONTRACTS.md, TEST_SPEC.md
tests/          unit/ integration/ helpers/
```

## เปลี่ยนไปใช้ database
service layer เรียกแค่ repository และ `store.transaction()` ถ้าจะใช้ PostgreSQL/Supabase ให้เขียน repository ใหม่ที่มี method เดิม:

- `collectionRepo`: `list(userId, { limit, offset, rarity })` → `{ items, total }` · `find(userId, cardId)` · `findPull(pullId)` · `addFromPull(userId, card, quantity, pullId)` · `adjustRedeemed(userId, items, sign)`
- `orderRepo`: `create(order)` · `findById(id)` · `list(userId, { limit, offset, status })` · `update(id, changes)` · `remove(id)`
- `transaction(fn)` → `BEGIN … COMMIT` (ROLLBACK เมื่อ throw) และใช้ `SELECT … FOR UPDATE` แถว collection ที่จะจอง

## CI/CD (GitHub Actions)
workflow อยู่ที่ root ของ repo ทำงานเมื่อแก้ไฟล์ใน `collection-service/**`
- [`collection-service-ci.yml`](../.github/workflows/collection-service-ci.yml): ทุก push / PR → lint → test + coverage (≥ 80%) → build image (`linux/amd64`) · push เข้า `main` → push ไป `ghcr.io/<owner>/<repo>/collection-service` tag `sha-xxxx` + `latest`
- [`collection-service-release.yml`](../.github/workflows/collection-service-release.yml): push tag `collection-service-vX.Y.Z` → test อีกรอบ → image `:X.Y.Z`, `:X.Y`, `:latest` + GitHub Release พร้อม release notes อัตโนมัติ
  ```bash
  git tag collection-service-v1.0.0 && git push origin collection-service-v1.0.0
  ```

## ข้อจำกัดที่รู้อยู่แล้ว
- ใช้ไฟล์ JSON เป็นที่เก็บข้อมูล: รันได้ instance เดียว (mutex อยู่ใน process)
- การเปลี่ยนสถานะ order ยังไม่แจ้งผู้ใช้ (ไม่มี notification)
- ถ้า process ตายระหว่างรอ Wallet charge การ์ดที่จองไว้จะค้างอยู่ใน order `PENDING` (admin ยกเลิกเพื่อคืนการ์ดได้)
