# Service Conventions (ข้อตกลงกลางของทุก service)

ข้อเสนอให้ทั้งทีม Online Trading Card Gacha Platform ใช้ร่วมกัน เพื่อให้แต่ละ service เชื่อมกันได้โดยไม่ต้องแก้โค้ดตอนรวมระบบ
ค่าที่ยังเป็น "ค่าเสนอ" ให้เจ้าของ service ยืนยันหรือแก้ในไฟล์นี้
ข้อตกลงด้าน auth, error, id, rarity และ pagination ยึดตาม `card-catalog-service` ที่เสร็จแล้ว

| เรื่อง | ข้อตกลง |
|---|---|
| Port / hostname ใน compose | `user-service:3001`, `wallet-service:3002`, `card-catalog-service:3003`, `gacha-service:3004`, `collection-service:3005` (wallet/gacha เป็นค่าเสนอ) |
| Auth ผู้ใช้ | JWT จาก user-service, HS256, `iss=user-service`, userId อยู่ใน `sub` · ใช้ [`user-service/docs/jwt-verify-middleware.js`](user-service/docs/jwt-verify-middleware.js) |
| Auth ระหว่าง service | header `X-Internal-Key: <INTERNAL_API_KEY>` (ทุก service ใช้ค่าเดียวกัน เทียบแบบ constant-time) · Bearer ของผู้ใช้ใช้แทนไม่ได้ |
| Auth admin | JWT ของผู้ใช้ที่ `sub` อยู่ใน `ADMIN_USER_IDS` (ไม่อยู่ → 403 `FORBIDDEN`), path ขึ้นต้นด้วย `/admin/` |
| Error format | `{ "error": { "code": "UPPER_SNAKE", "message": "...", "details": ... } }` · validation: `details = [{ path, message }]` |
| Health | `GET /health` (liveness) และ `GET /health/ready` (readiness) ทุก service ใช้ใน compose `healthcheck` |
| Tracing | รับ header `X-Request-Id` (ไม่มีให้สร้าง UUID), ส่งต่อทุกครั้งที่เรียก service อื่น, ใส่ใน response และพิมพ์ใน log |
| Idempotency | การเรียกที่สร้างข้อมูลข้าม service ต้องมี key ไม่ซ้ำ (`pullId`, `idempotencyKey`) ส่งซ้ำได้ผลเดิม |
| ID | UUID v4 สำหรับ user / order / pull · card id ตาม Catalog (`^[A-Za-z0-9._-]{1,40}$` เช่น `sv3pt5-199`) |
| Rarity | `common` · `rare` · `epic` · `legendary` |
| เงิน | หน่วยบาท เก็บเป็นจำนวนเต็ม (ไม่ใช้ทศนิยม) |
| Timeout | เรียก service อื่นต้องมี timeout (default 3s) และตอบ `503 <SERVICE>_UNAVAILABLE` ถ้าปลายทางล่ม |
| Pagination | `?page=&limit=` (default 1 / 20, max 100) ตอบ `{ "data": [...], "page", "limit", "total", "totalPages" }` |
| Rate limit | ต่อ IP ตาม `RATE_LIMIT_PER_MINUTE` (default 300) ยกเว้น `/health*` → 429 `TOO_MANY_REQUESTS` · หลัง gateway ตั้ง `TRUST_PROXY` |
| Secret | ทุก secret อยู่ใน env (`.env` ที่ root สำหรับ compose) ห้าม commit · production ต้องยาว ≥ 32 ตัวอักษร |

## Repo และ CI/CD
- 1 โฟลเดอร์ต่อ 1 service ที่ root ของ repo · stack: NestJS 11 + TypeScript (ตาม card-catalog-service) (`user-service/`, `collection-service/`, ...)
- workflow อยู่ที่ `.github/workflows/<service>-ci.yml` (GitHub ไม่รัน workflow ที่อยู่ในโฟลเดอร์ย่อย) และกรองด้วย `paths: ['<service>/**']`
- image: `ghcr.io/<owner>/<repo>/<service>` tag `sha-xxxx` + `latest` เมื่อ push เข้า `main`
- release: tag `<service>-vX.Y.Z` → image `:X.Y.Z`, `:X.Y`, `:latest` + GitHub Release (ดูตัวอย่างที่ `collection-service-release.yml`)

## รันทั้งระบบ
```bash
cp .env.example .env            # แก้ secret ทุกค่า (openssl rand -hex 32)
docker compose up --build       # user-service + card-catalog-service + collection-service
docker compose --profile full up  # รวม service ที่เหลือเมื่อมี image บน GHCR แล้ว
```
