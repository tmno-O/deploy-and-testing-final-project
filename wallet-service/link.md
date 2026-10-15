# link.md — การเชื่อม Wallet & Payment Service กับ service อื่น

ไฟล์นี้บอกว่า wallet-service เชื่อมกับอะไรแล้ว และ **อะไรที่ยังทำไม่ได้ พร้อมเหตุผล**

หลักที่ใช้ในโค้ด
- ทุก URL / secret ของ service อื่นมาจาก env เท่านั้น ไม่มีค่า hardcode ในโค้ด
- ราคาแพ็กไม่ถูกเก็บหรือเดาใน wallet และ caller ส่งราคามาไม่ได้ (ถูก reject) — ดึงจาก card-catalog-service ทุกครั้ง
- ส่วนที่ต่อยังไม่ได้ **ไม่ถูกปลอมผล** (ไม่มี stub / ค่าสมมติใน production code) แต่ตอบ error ตรง ๆ หรือไม่มีฟีเจอร์นั้น

## สรุปสถานะ

| # | การเชื่อม | สถานะ |
|---|---|---|
| 1 | user-service → ตรวจ JWT ผู้ใช้ | ✅ เชื่อมแล้ว |
| 2 | card-catalog-service → ราคาแพ็ก | ✅ เชื่อมแล้ว (ทดสอบกับ catalog ตัวจริง) |
| 3 | collection-service → ค่าจัดส่ง (charge / refund) | ⚠️ ฝั่ง wallet พร้อมและทดสอบกับ client ตัวจริงแล้ว แต่ยังไม่ได้เปิดใช้ + มีข้อจำกัดฝั่ง collection |
| 4 | gacha-service → ซื้อแพ็ก | ❌ ทำไม่ได้ (ยังไม่มี service) |
| 5 | user-service → ตรวจว่า userId มีจริง | ❌ ทำไม่ได้ (user-service ไม่มี endpoint) |
| 6 | API Gateway / Frontend | ❌ ทำไม่ได้ (ยังไม่มีใน repo) |
| 7 | Payment gateway จริง (เติมเงินจริง) | ❌ ทำไม่ได้ (ต้องมีบัญชีและ key ภายนอก) |

---

## ส่วนที่เชื่อมแล้ว

| เชื่อมกับ | ทำอะไร | ตัวแปร env | ค่าเริ่มต้น | โค้ด |
|---|---|---|---|---|
| user-service | ตรวจ `Authorization: Bearer` (HS256, `iss`, `sub` = userId) — ตรวจด้วย secret ร่วมกัน **ไม่มีการเรียกข้ามเครือข่าย** | `JWT_SECRET`, `JWT_ISSUER` | ต้องตั้ง / `user-service` | `src/auth/jwt-auth.guard.ts` |
| card-catalog-service | `GET /packs/:id` เอา `priceCredits` ไปหักเครดิต (timeout, ส่งต่อ `X-Request-Id`) | `CATALOG_SERVICE_URL`, `CATALOG_SERVICE_TIMEOUT_MS` | `http://localhost:3003`, 3000 (ตั้งเป็นค่าว่าง = ปิด) | `src/clients/catalog.client.ts` |
| ทุก service ที่เรียก wallet | `X-Internal-Key` เทียบแบบ constant-time | `INTERNAL_API_KEY` | ต้องตั้ง (ค่าเดียวกันทุก service) | `src/auth/internal-key.guard.ts` |

พฤติกรรมเมื่อ catalog มีปัญหา: ล่ม / timeout / ตอบผิดรูปแบบ / ไม่ได้ตั้ง URL → `503 CATALOG_SERVICE_UNAVAILABLE` และ **ไม่หักเครดิต**; pack ไม่มีหรือปิดขาย → `422 PACK_NOT_FOUND`
การซื้อซ้ำด้วย key เดิมไม่ต้องเรียก catalog อีก จึงยังใช้ได้ตอน catalog ล่ม

ที่ทดสอบจริงแล้ว (รัน card-catalog-service และ collection-service จาก `main` ของ repo คู่กับ wallet-service):
- ซื้อ `premium` → ถูกหัก 300 ตรงกับราคาใน catalog จริง, ซื้อซ้ำด้วย key เดิมได้ `200 Idempotent-Replayed` ไม่หักซ้ำ, pack ที่ไม่มี → `PACK_NOT_FOUND`
- `WalletClient` ตัวจริงของ collection-service: ยอดไม่พอ → order ถูกปฏิเสธด้วย `INSUFFICIENT_BALANCE`, ยอดพอ → หักค่าส่ง 50 (`paymentStatus: PAID`), ยกเลิก order → คืน 50 (`REFUNDED`)

---

## ส่วนที่ยังทำไม่ได้ และเหตุผล

### 3. collection-service → wallet (ค่าจัดส่ง) — ต่อได้แต่ยังไม่เปิด และมีข้อจำกัด

**ทำไมยังไม่เปิด:** collection-service ปิดการเรียก wallet เป็นค่าเริ่มต้น (`WALLET_ENABLED=false`) เพื่อให้รันเดี่ยวได้ และ wallet-service ใน root `docker-compose.yml` ยังอยู่ใน `--profile full` ผมไม่เปลี่ยนค่าเริ่มต้นของ service ของคนอื่น

**วิธีเปิด:** ใน `.env` ที่ root ตั้ง `WALLET_ENABLED=true` และ `WALLET_SERVICE_URL=http://wallet-service:3002` แล้วรัน `docker compose --profile full up --build`

**ข้อจำกัดที่ต้องแก้ฝั่ง collection (ผมไม่ได้แก้โค้ดของ service นั้น):**
- collection-service เก็บ transaction id ของการหักเงินไว้ใน `paymentRef` ของ order (`fulfillment.service.ts`) แต่ตอน refund **ไม่ได้ส่งกลับมาเป็น `transactionId`** → refund ของ collection จึงเป็น "เติมเครดิตทั่วไป" ที่ wallet ตรวจไม่ได้ว่าไม่เกินยอดที่เคยหัก ป้องกันได้เพียง idempotency key + `X-Internal-Key` เท่านั้น แก้ได้ฝั่ง collection โดยส่ง `transactionId: order.paymentRef` ใน body ของ refund — wallet รองรับอยู่แล้ว (`REFUND_EXCEEDS_CHARGE`)
- path `/internal/wallets/:userId/charge|refund` ใน collection ถูกเขียนว่าเป็น "proposal ให้เจ้าของ wallet ยืนยัน" — wallet ใช้ตรงตามนั้นแล้ว ขอให้เจ้าของ collection รับทราบ

### 4. gacha-service → wallet (ซื้อแพ็ก) — ทำไม่ได้

**เหตุผล:** ยังไม่มี gacha-service ใน repo (ไม่มีโฟลเดอร์ ไม่มี branch บน remote; ใน `docker-compose.yml` มีแค่ block placeholder ใน `profile full` ที่ระบุว่า "ยังไม่เสร็จ") จึงไม่มีผู้เรียก และ contract ฝั่ง Gacha ยังไม่มีเจ้าของยืนยัน

**ฝั่ง wallet ทำไว้แล้ว:** `POST /internal/wallets/:userId/purchases` `{ packId, idempotencyKey }` (ราคาจาก catalog) และ `POST /internal/wallets/:userId/refund` พร้อม `transactionId` สำหรับคืนเงินเมื่อสุ่มไม่สำเร็จ รายละเอียดใน `API.md` หัวข้อ 1

**ต้องทำเมื่อ Gacha พร้อม:**
- ตั้ง URL ของ wallet ผ่าน env ฝั่ง Gacha (ห้าม hardcode) และส่ง `idempotencyKey` เป็น `pullId` ตาม `SERVICE_CONVENTIONS.md`
- ยืนยัน path / ชื่อ field กับเจ้าของ Gacha
- **ความเสี่ยงที่ต้องออกแบบฝั่ง Gacha:** flow สุ่มการ์ดคร่อม 3 service (จองสต็อก → หักเครดิต → commit) ไม่ใช่ transaction เดียว ถ้า Gacha ล่มหลังหักเครดิตแต่ก่อนให้การ์ด wallet ไม่รู้เรื่องนี้ Gacha ต้องเก็บสถานะของแต่ละ pull แล้ว retry ด้วย key เดิม (ปลอดภัย) หรือเรียก refund wallet ไม่มีกลไกกระทบยอดอัตโนมัติข้าม service

### 5. user-service → ตรวจว่า userId มีจริง — ทำไม่ได้

**เหตุผล:** user-service ไม่มี endpoint ภายในให้ถามจาก service อื่น (มีเพียง `/users/me*` ที่ต้องใช้ JWT ของผู้ใช้คนนั้นเอง) ผมจึงไม่เดา endpoint และไม่ hardcode

**ผลที่ตามมา:**
- route ฝั่งผู้ใช้เชื่อ JWT (ลายเซ็นถูก = ผู้ใช้ถูกออก token โดย user-service)
- route `/internal/wallets/:userId/*` รับ `userId` อะไรก็ได้จาก service ที่ถือ `INTERNAL_API_KEY` — `charge` / `purchases` ของ user ที่ไม่มีจริงจะ 402 (ยอด 0) แต่ `refund` แบบไม่มี `transactionId` จะสร้าง wallet ให้ userId นั้นได้
- บัญชีที่ถูกลบจะยังมี wallet ค้าง (user-service ยังไม่มี flow ลบผู้ใช้)

**ต้องมี:** user-service เพิ่ม `GET /internal/users/:id` (ใช้ `X-Internal-Key`) แล้วเพิ่ม client + `USER_SERVICE_URL` ใน wallet

### 6. API Gateway / Frontend — ทำไม่ได้

**เหตุผล:** ใน repo ยังไม่มี gateway และ frontend (`demo/index.html` เป็นหน้าทดลองสำหรับ dev ที่เรียกแค่ user-service, card-catalog-service และ collection-service ไม่เรียก wallet) จึงยังไม่มี prefix / route ที่ตกลงกัน wallet ให้ path ตรง ๆ (`/wallets/...`) และตั้ง CORS ได้ด้วย `CORS_ORIGIN`

**ต้องทำตอนทำ gateway:**
- route `/wallets/*` → `wallet-service:3002`
- **ห้ามเปิด `/internal/*` และ `/admin/*` สู่ภายนอก** (`/internal/*` ใช้ secret ร่วมกัน)
- ตั้ง `TRUST_PROXY=1` เพื่อให้ rate limit ใช้ IP จริง
- ยังไม่มีหน้า UI เติมเครดิต / ดูประวัติ

### 7. Payment gateway จริง — ทำไม่ได้

**เหตุผล:** ต้องมีบัญชีกับผู้ให้บริการ (Omise, Stripe ฯลฯ), API key, URL สำหรับ webhook ที่เข้าถึงได้จากภายนอก และผ่านการตรวจสอบของผู้ให้บริการ ซึ่งโครงการยังไม่มี (proposal ข้อ 9 ระบุไว้) และ flow จริงมีสถานะ "รอชำระ → webhook ยืนยัน" ซึ่งยังไม่ได้ออกแบบ

**ตอนนี้:** `PAYMENT_PROVIDER=mock` เท่านั้น — ค่าอื่นทำให้ service **ไม่ยอมสตาร์ท** (ไม่ถอยกลับไปใช้ mock เงียบ ๆ) และเมื่อเป็น mock จะมี warning ใน log
**⚠️ mock = เติมเครดิตฟรีได้ไม่จำกัดจำนวนครั้ง** (จำกัดเพียงต่อครั้งตาม `TOPUP_MAX_AMOUNT` และเพดานยอดรวม `MAX_BALANCE`) ห้ามเปิดให้คนนอกใช้

**เมื่อพร้อม:** เขียน class ที่ implement `PaymentProvider` (`src/payments/payment-provider.ts`) แล้วเพิ่มชื่อใน `SUPPORTED_PAYMENT_PROVIDERS` (`src/config/app-config.ts`) — endpoint ของผู้ใช้ไม่ต้องเปลี่ยน แต่ต้องเพิ่มสถานะ pending + webhook เอง

---

## สมมติฐานที่ต้องให้ทีมยืนยัน

- **1 เครดิต = 1 บาท:** `priceCredits` ของ catalog และค่าจัดส่งของ collection (บาท) ถูกหักจากยอดเดียวกันแบบ 1:1
- **port `3002` และชื่อ `wallet-service`:** ใน `SERVICE_CONVENTIONS.md` ยังเป็น "ค่าเสนอ"
- **รูปแบบ path / body ฝั่ง internal** ใน `API.md` ตามข้อ 3 และ 4

## ไฟล์ส่วนกลางที่ผมแก้

- `docker-compose.yml` (root): block `wallet-service` เพิ่ม `build`, env, volume `wallet-data` — ยังอยู่ใน `--profile full` ตามเดิม
- `.github/workflows/wallet-service-ci.yml`: **ยังไม่อยู่ที่นั่น** — เครื่องมือที่ผมใช้เขียนไฟล์ใน `.github/` ไม่ได้ (protected) จึงวางไว้ที่ `wallet-service/ci/wallet-service-ci.yml` (ตามแบบของ service อื่น) ต้องย้ายเอง:
  `git mv wallet-service/ci/wallet-service-ci.yml .github/workflows/wallet-service-ci.yml` (หรือ `mv` ถ้ายังไม่ได้ `git add`) แล้วลบโฟลเดอร์ `wallet-service/ci/` — GitHub จะไม่รัน workflow ที่อยู่ในโฟลเดอร์ย่อย
