# Contracts: Collection & Fulfillment Service

สิ่งที่ service นี้**ให้**และ**ต้องการ**จาก service อื่น ส่งไฟล์นี้ให้เพื่อนในทีมยืนยัน
spec เต็มของทุก endpoint: [`openapi.yaml`](openapi.yaml) (เปิดใน https://editor.swagger.io ได้ หรือใช้ mock ด้วย Prism)
ข้อตกลงกลางของทุก service: [`SERVICE_CONVENTIONS.md`](../../SERVICE_CONVENTIONS.md)

## สิ่งที่ Collection ให้ service อื่น

### Gacha → เพิ่มการ์ดหลังสุ่ม
```
POST http://collection-service:3005/internal/collections/{userId}/cards
X-Service-Key: <SERVICE_API_KEY>
X-Request-Id: <ส่งต่อจาก request ต้นทาง>   (ไม่บังคับ)

{ "pullId": "<uuid ของการสุ่มครั้งนั้น>", "cardId": "CARD-001",
  "cardName": "Flame Dragon", "cardRarity": "ULTRA_RARE",
  "cardImageUrl": "https://...", "quantity": 1 }
```
| ผล | ความหมาย |
|---|---|
| `201 { pullId, created: true, card }` | เพิ่มแล้ว |
| `200 { pullId, created: false, card }` | `pullId` นี้เคยส่งแล้ว ไม่เพิ่มซ้ำ (Gacha retry ได้ปลอดภัย) |
| `400 VALIDATION_ERROR` | body ผิด หรือขาด `cardName`/`cardRarity`/`cardImageUrl` ตอนปิด Catalog |
| `401` | ไม่มี/ผิด `X-Service-Key` |
| `409 PULL_ID_CONFLICT` | `pullId` เดิมแต่คนละ user หรือคนละการ์ด |
| `422 CARD_NOT_FOUND` · `503 CATALOG_SERVICE_UNAVAILABLE` | เฉพาะตอนเปิด Catalog |

- ถ้าเปิด Catalog แล้ว (`CATALOG_SERVICE_URL`) ส่งแค่ `pullId` + `cardId` (+ `quantity`) ก็พอ ข้อมูลการ์ดจะมาจาก Catalog และ**ไม่สนใจ**ค่าที่ Gacha ส่งมา
- `userId` ต้องเป็น UUID (`sub` ใน JWT ของ user-service)

### Gacha / Marketplace → ดูคอลเลกชันของผู้ใช้ใดก็ได้
```
GET /internal/collections/{userId}?limit=20&offset=0&rarity=RARE
X-Service-Key: <SERVICE_API_KEY>
→ 200 { data: [Card], total, limit, offset }
```

### Frontend
endpoint ฝั่งผู้ใช้ทั้งหมด (`/collections/me*`, `/fulfillments/orders*`) ใช้ `Authorization: Bearer <JWT จาก user-service>` ดูรายละเอียดใน [`openapi.yaml`](openapi.yaml) หรือ [README](../README.md#api)

## สิ่งที่ Collection ต้องการจาก service อื่น

| Service | ต้องการ | ถ้ายังไม่มี / ปิดอยู่ |
|---|---|---|
| User | `GET /users/me/addresses/:id` ส่งต่อ Bearer ของผู้ใช้ → `200 { address }` / `404` (มีแล้ว ✓) | — |
| Catalog | `GET /cards/:cardId` → `200 { cardId, name, rarity, imageUrl }` (หรือห่อใน `{ card }`) / `404` | ใช้ข้อมูลการ์ดจาก Gacha (ต้องครบทุกฟิลด์) |
| Wallet | `POST /internal/wallets/:userId/charge` body `{ amount, reason, idempotencyKey: orderId }` → `200/201 { transactionId }` · ยอดไม่พอ → `402` | `paymentStatus = NOT_REQUIRED` |
| Wallet | `POST /internal/wallets/:userId/refund` body `{ amount, idempotencyKey: "refund-" + orderId }` → `200/201 { transactionId }` | — |

ทุกการเรียกออกไปส่ง `X-Request-Id` และมี timeout 3 วินาที · Wallet ส่ง `X-Service-Key` ด้วย
ปลายทางตอบ 5xx / timeout / ต่อไม่ติด → service นี้ตอบ `503 <SERVICE>_UNAVAILABLE`

### Flow สร้าง order เมื่อเปิด Wallet
1. ดึงที่อยู่จาก user-service (ถ้าส่ง `addressId`)
2. ตรวจและจองการ์ดทุกใบใน transaction เดียว (ใบไหนไม่พอ → 409 ไม่จองเลย)
3. ถ้า `shippingFee > 0` เรียก Wallet charge (`idempotencyKey = orderId`)
4. สำเร็จ → `paymentStatus = PAID` · ยอดเงินไม่พอ (402) หรือ Wallet ล่ม (503) → คืนการ์ดที่จองไว้ ลบ order แล้วตอบ error นั้น
- cancel order ที่ `PAID` → เรียก refund ก่อน สำเร็จแล้วค่อยเปลี่ยนเป็น `CANCELLED` + `REFUNDED` (refund ไม่สำเร็จ → 503 order ไม่เปลี่ยน ลองใหม่ได้)

## ต้องให้เพื่อนในทีมยืนยัน
- [ ] Gacha: เรียก internal endpoint พร้อม `pullId` และ `X-Service-Key` ได้
- [ ] Catalog: path และรูปแบบ `GET /cards/:cardId`, รูปแบบ `cardId`, ชื่อ rarity
- [ ] Wallet: path charge/refund, ใช้ `idempotencyKey`, error 402
- [ ] ทุกคน: port, error format, health endpoints, `X-Request-Id`
- [ ] ถามอาจารย์: repo เดียวแยกโฟลเดอร์นับเป็น "แยก project" หรือไม่
