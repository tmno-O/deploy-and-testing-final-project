# Test Specification: Collection & Fulfillment Service

**เครื่องมือ:** Jest 29 + Supertest · contract test ด้วย `jest-openapi` · coverage ≥ 80% ทุกหมวด (บังคับใน `coverageThreshold` CI แดงถ้าต่ำกว่า)
**ผลล่าสุด:** 17 suites · 199 tests ผ่านทั้งหมด · coverage statements 98.6% · branches 95.7% · functions 99.1% · lines 98.7%

```bash
npm test                  # ทั้งหมด
npm run test:unit         # unit
npm run test:integration  # integration (Supertest ยิง app จริง ไม่เปิด port)
npm run test:coverage     # + รายงาน coverage ใน coverage/
```

## หลักการ
- ไม่มี database: เทสใช้ store ใน memory ล้างทุกเทส (`resetStore`) และ `PERSIST_DATA=false` จึงไม่เขียนทับ `data/mock-data.json`
- service อื่น (user / catalog / wallet) ไม่ต้องรันจริง: unit test ใช้ `jest.spyOn` ที่ client, integration test ของจุดเชื่อม mock `global.fetch` เพื่อทดสอบ `httpClient` จริงทั้งเส้น
- JWT ในเทสออกด้วย secret / issuer เดียวกับ user-service (`tests/helpers/tokens.js`)

## Unit tests (`tests/unit`)
| ไฟล์ | เคส |
|---|---|
| `shipping.test.js` | 1, 4, 5 (boundary), 6, 50 ใบ → 50/50/0/0/0 บาท · 0 และ 51 ใบ → 400 · รวมหลาย item · ใช้ค่าจาก config |
| `stateMachine.test.js` | ทุกคู่ที่อนุญาตผ่าน · ทุกคู่ที่ไม่อนุญาต (ย้อน/ข้าม/จากสถานะจบ) → 409 · `SHIPPED` ไม่มี tracking → 400 · ผู้ใช้ cancel ได้เฉพาะ `PENDING` |
| `schemas.test.js` | phone / postalCode / recipientName ผิด · `items` ว่าง · `cardId` ซ้ำ · quantity 0, -1, 1.5 · มีทั้ง/ไม่มีทั้ง `addressId` และ `shippingAddress` · field แปลกปลอม · `pullId` ไม่ใช่ UUID · pagination |
| `httpClient.test.js` | 200 / 4xx คืนให้ caller · 500, timeout, ECONNREFUSED, JSON เสีย → 503 · ส่งต่อ `X-Request-Id` |
| `clients.test.js` | userClient 200 / 404 → 422 / 401 / 400 / 5xx → 503 · catalogClient เปิด/ปิด, 404 → 422, ข้อมูลผิดรูป → 503 · walletClient ปิดแล้วไม่เรียก HTTP, charge/refund ใช้ idempotencyKey, 402 → `INSUFFICIENT_BALANCE` |
| `collectionService.test.js` | เพิ่มการ์ดใหม่ · `pullId` ซ้ำ (ทั้งเรียงกันและพร้อมกัน) เพิ่มครั้งเดียว · `PULL_ID_CONFLICT` · ขาดข้อมูลการ์ดตอนปิด Catalog · ใช้ข้อมูลจาก Catalog เมื่อเปิด |
| `fulfillmentService.test.js` | จองหลายใบ · ใบหนึ่งไม่พอ → ข้อมูลทั้ง store ไม่เปลี่ยน · snapshot ที่อยู่ · user-service ล่มไม่แตะการ์ด · Wallet PAID / ล้มเหลวคืนการ์ด / ส่งฟรีไม่เรียก · refund ตอน cancel · refund ล้มเหลว order ไม่เปลี่ยน · cancel คืนยอด · race ระหว่างรอ Wallet |
| `jsonStore.test.js` | ไฟล์ไม่มี → ว่าง · ไฟล์เสีย · persist หลัง transaction สำเร็จ · **transaction ล้มเหลว → memory ย้อนกลับและไฟล์ไม่เปลี่ยน** · mutex รันทีละอัน |
| `config.test.js` | ค่า default · env บังคับ · key สั้นกว่า 32 ใน production → ไม่ยอม start · `WALLET_ENABLED=true` ต้องมี URL |

## Integration tests (`tests/integration`)
| ไฟล์ | เคส |
|---|---|
| `health.test.js` | `/health`, `/health/ready` (และ 503 เมื่อ store เสีย) · 404 รูปแบบมาตรฐาน · `X-Request-Id` สร้างใหม่ / echo / แทนที่ค่าที่ไม่ปลอดภัย · JSON เสีย 400, body ใหญ่ 413 |
| `auth.test.js` | ไม่มี token, scheme ผิด, ลายเซ็นผิด, `iss` ผิด, หมดอายุ (`TOKEN_EXPIRED`), `alg: none`, ไม่มี `sub`, HS512 → 401 · ใช้ service/admin key กับ endpoint ผู้ใช้ไม่ได้ · Bearer ผู้ใช้เข้า `/internal`, `/admin` ไม่ได้ · key ผิด/สลับ key → 401 |
| `internal.test.js` | เพิ่มการ์ด 201 · `pullId` ซ้ำ → 200 quantity เพิ่มครั้งเดียว · pull ใหม่การ์ดเดิม → +1 · `PULL_ID_CONFLICT` · ขาด `cardName` → 400 · validate userId/body · ดูคอลเลกชันของ user ใดก็ได้ |
| `collection.test.js` | list + quantity / redeemed / available · pagination · filter rarity · query ผิด 400 · เห็นแค่ของตัวเอง · การ์ดที่ไม่มี 404 · ผู้ใช้เพิ่มการ์ดเองไม่ได้ |
| `fulfillment.test.js` | สร้างสำเร็จ `availableQuantity` ลด · ส่งฟรี 5 ใบ · ขอเกิน → 409 **store ไม่เปลี่ยน** · แลกซ้ำไม่ได้ · เกิน 50 ใบ 400 · `addressId` ผ่าน user-service, 422, 503 การ์ดไม่ลด · list ใหม่สุดก่อน + filter · User B อ่าน/cancel order ของ User A → 404 · cancel `PENDING` คืนยอด · cancel หลัง `PROCESSING` → 409 · cancel ซ้ำ 409 |
| `admin.test.js` | ไม่มี key 401 · flow ครบ `PENDING → PROCESSING → SHIPPED → DELIVERED` พร้อม history · `SHIPPED` ไม่มี tracking 400 · ย้อน/ข้าม/หลัง cancel → 409 · admin cancel ตอน `PROCESSING` คืนยอด · body/id ผิด 400, ไม่มี order 404 |
| `readiness.test.js` | **Catalog เปิด:** ข้อมูลจาก Catalog ไม่ใช่ payload · ไม่มีใน Catalog → 422 · Catalog ล่ม → 503 ไม่มีการ์ดถูกเพิ่ม · **Catalog ปิด:** ขาด `cardName` → 400 ไม่เรียก Catalog · **Wallet เปิด:** `PAID` + idempotencyKey · 402 / ล่ม → ไม่มี order การ์ดคืนครบ · ส่งฟรีไม่เรียก · cancel `PAID` → refund + `REFUNDED` · **Wallet ปิด:** ไม่เรียกเลย `NOT_REQUIRED` · user-service ผ่าน HTTP: ส่งต่อ token + `X-Request-Id` · ล่ม → 503 · `X-Request-Id` ถึง Catalog และ Wallet |
| `contract.test.js` | response ของทุก endpoint (สำเร็จและ error) ตรงกับ `docs/openapi.yaml` |

## End-to-end (manual)
ใช้ `docker-compose.yml` ที่ root ของ repo

1. `cp .env.example .env` แก้ secret ทุกค่า แล้ว `docker compose up --build`
   ```bash
   curl localhost:3001/health          # {"status":"ok"}
   curl localhost:3005/health/ready    # {"status":"ready"}
   ```
2. สมัคร + สร้างที่อยู่ที่ user-service
   ```bash
   TOKEN=$(curl -s -XPOST localhost:3001/auth/register -H 'Content-Type: application/json' \
     -d '{"email":"e2e@example.com","password":"password123","firstName":"E","lastName":"Two","displayName":"e2e"}' | jq -r .accessToken)
   USER_ID=$(curl -s localhost:3001/users/me -H "Authorization: Bearer $TOKEN" | jq -r .user.id)
   ADDR=$(curl -s -XPOST localhost:3001/users/me/addresses -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"recipientName":"E Two","phone":"0812345678","line1":"1 Road","district":"Mueang","province":"Chiang Mai","postalCode":"50000"}' | jq -r .address.id)
   ```
3. ทำตัวเป็น Gacha เพิ่มการ์ด 5 ใบ (ส่งซ้ำด้วย `pullId` เดิม → 200 จำนวนไม่เพิ่ม)
   ```bash
   source .env
   curl -XPOST localhost:3005/internal/collections/$USER_ID/cards -H "X-Service-Key: $SERVICE_API_KEY" -H 'Content-Type: application/json' \
     -d '{"pullId":"6f1c2b9e-4b8e-4c55-9d1a-111111111111","cardId":"CARD-010","cardName":"E2E Card","cardRarity":"RARE","cardImageUrl":"https://example.com/10.png","quantity":5}'
   ```
4. สร้าง order ด้วย `addressId` → `shippingFee: 0` และ `availableQuantity` เหลือ 0
   ```bash
   ORDER=$(curl -s -XPOST localhost:3005/fulfillments/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d "{\"items\":[{\"cardId\":\"CARD-010\",\"quantity\":5}],\"addressId\":\"$ADDR\"}" | jq -r .order.id)
   curl localhost:3005/collections/me/CARD-010 -H "Authorization: Bearer $TOKEN"
   ```
5. `docker compose stop user-service` แล้วสร้าง order อีกครั้ง → `503 USER_SERVICE_UNAVAILABLE` (แล้ว `docker compose start user-service`)
6. admin เปลี่ยนสถานะ
   ```bash
   for body in '{"status":"PROCESSING"}' '{"status":"SHIPPED","trackingNumber":"TH123"}' '{"status":"DELIVERED"}'; do
     curl -XPATCH localhost:3005/admin/fulfillments/orders/$ORDER/status -H "X-Admin-Key: $ADMIN_API_KEY" -H 'Content-Type: application/json' -d "$body"; done
   ```

ขั้น 2–6 ผ่านแล้วเมื่อรันทั้งสอง service ด้วย node (ไม่ผ่าน Docker) ส่วน Docker image build ตรวจโดย CI ทุก pull request
