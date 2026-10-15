# Wallet & Payment Service

Service ที่ 2 ของโปรเจกต์ Online Trading Card Gacha Platform ดูแลกระเป๋าเงินเครดิต การเติมเครดิต การซื้อแพ็กการ์ดด้วยเครดิต และประวัติธุรกรรม

**Stack:** NestJS 11 + TypeScript (ตาม `SERVICE_CONVENTIONS.md`) · ข้อมูลเก็บในไฟล์ JSON (ยังไม่มี database) · JWT (HS256) · zod · Jest + Supertest · Docker · GitHub Actions

| ความสามารถ | endpoint |
|---|---|
| แสดงยอดเครดิตคงเหลือ | `GET /wallets/me` |
| เติมเครดิต (ตอนนี้เป็นเครดิตจำลอง) | `GET /wallets/topup-methods` · `POST /wallets/me/topups` |
| ซื้อแพ็กการ์ดด้วยเครดิต (Gacha เรียก) | `POST /internal/wallets/:userId/purchases` |
| หัก / คืนเครดิต เช่น ค่าจัดส่ง (Collection เรียก) | `POST /internal/wallets/:userId/charge` · `/refund` |
| ตรวจสอบและบันทึกประวัติธุรกรรม | `GET /wallets/me/transactions` · `GET /admin/wallets/:userId` (ตรวจยอดกับ ledger) |
| ป้องกันการหักซ้ำจากคำขอเดียวกัน | `Idempotency-Key` ทุกคำขอที่เคลื่อนเงิน |

รายละเอียด request / response / error code ทั้งหมดอยู่ที่ [`API.md`](API.md) · สถานะการเชื่อมกับ service อื่นและสิ่งที่ยังทำไม่ได้อยู่ที่ [`link.md`](link.md)

## เริ่มใช้งาน

### แบบ Docker
```bash
cp .env.example .env        # แก้ JWT_SECRET และ INTERNAL_API_KEY (openssl rand -hex 32)
docker compose up --build   # http://localhost:3002
```
ซื้อแพ็กต้องมี card-catalog-service ด้วย — ใช้ `docker-compose.yml` ที่ root ของ repo: `docker compose --profile full up --build`
ข้อมูลอยู่ใน volume `wallet-data` รีเซ็ตด้วย `docker compose down -v`

### แบบรันในเครื่อง
```bash
npm install
cp .env.example .env
npm run dev
```

## ตัวอย่าง
```bash
# เติมเครดิต 300 (token จาก user-service)
curl -X POST localhost:3002/wallets/me/topups \
  -H "Authorization: Bearer $TOKEN" -H 'Idempotency-Key: topup-0001-abcd' -H 'Content-Type: application/json' \
  -d '{"amount":300}'
# ยิงซ้ำด้วย key เดิม -> 200 + Idempotent-Replayed: true และยอดไม่เพิ่ม

curl localhost:3002/wallets/me -H "Authorization: Bearer $TOKEN"

# Gacha ซื้อแพ็ก (ราคามาจาก card-catalog-service เสมอ)
curl -X POST localhost:3002/internal/wallets/$USER_ID/purchases \
  -H "X-Internal-Key: $INTERNAL_API_KEY" -H 'Content-Type: application/json' \
  -d '{"packId":"starter","idempotencyKey":"pull-0001-abcd"}'
```

## หลักการออกแบบ

- **ledger แบบ append-only:** ทุกการเปลี่ยนยอดคือ 1 แถวใน `transactions` (ไม่แก้ ไม่ลบ) เก็บ `balanceBefore` / `balanceAfter` ยอดใน wallet ต้องเท่ากับผลรวมของ ledger — `GET /admin/wallets/:userId` ตรวจให้ (`audit.consistent`)
- **เงินเป็นจำนวนเต็ม:** หน่วยเครดิต (1 เครดิต = 1 บาท) ไม่มีทศนิยม
- **ไม่หักซ้ำ:** key ซ้ำ + คำขอเดิม → ได้ผลเดิมกลับไป, key ซ้ำ + คำขอต่าง → `422 IDEMPOTENCY_KEY_REUSED`, คำขอที่ล้มเหลว (ยอดไม่พอ ฯลฯ) ไม่ใช้ key ทิ้ง
- **ไม่หักเกินยอด:** "เช็คยอด → บันทึก → ตัดยอด" ทำในขั้นเดียวภายใต้ mutex (`StoreService.transaction`) และ rollback ถ้าผิดพลาด คำขอที่มาพร้อมกันจึงใช้เครดิตเดียวกันสองรอบไม่ได้ (มี test)
- **ราคาแพ็กไม่เก็บใน wallet:** ดึงจาก card-catalog-service ทุกครั้ง
- **เครดิตจำลอง:** `PAYMENT_PROVIDER=mock` เติมฟรี ใช้เฉพาะช่วงพัฒนา; ผู้ให้บริการจริงทำผ่าน interface `PaymentProvider`

## ข้อจำกัดที่ควรรู้

- ข้อมูลอยู่ในไฟล์ JSON และ mutex อยู่ใน memory → **รันได้ instance เดียว** ถ้าย้ายไป MySQL / PostgreSQL ให้แทน `StoreService.transaction` ด้วย DB transaction และสร้าง unique index บน `(user_id, idempotency_key)`
- ledger โตขึ้นเรื่อย ๆ และถูกเขียนทั้งไฟล์ทุกครั้ง เหมาะกับขนาดโปรเจกต์เรียนเท่านั้น

## ทดสอบ
ไม่ต้องใช้ database — test ใช้ข้อมูลใน memory และไม่เขียนทับไฟล์ข้อมูล
```bash
npm test               # ทั้งหมด (144 tests)
npm run test:unit
npm run test:integration
npm run test:coverage  # ต้อง >= 80% (ตอนนี้ ~97%)
npm run lint && npm run typecheck && npm run build
```

## โครงสร้าง
```
src/
  wallet/      controllers (user / internal / admin), WalletService (ledger + idempotency), schemas, views
  payments/    PaymentProvider interface + mock provider
  clients/     catalog.client.ts (เรียก card-catalog-service), http-client.ts (timeout + X-Request-Id)
  auth/        JWT guard, internal key guard, admin guard
  store/       JSON store + mutex + rollback
  config/      อ่านและตรวจ env (fail fast)
tests/         unit/ และ integration/ (รวม contract ที่ collection-service ใช้)
```
