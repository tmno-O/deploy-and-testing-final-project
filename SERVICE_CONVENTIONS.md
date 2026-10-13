# Service Conventions (ข้อตกลงกลางของทุก service)

ข้อเสนอให้ทั้งทีม Online Trading Card Gacha Platform ใช้ร่วมกัน เพื่อให้แต่ละ service เชื่อมกันได้โดยไม่ต้องแก้โค้ดตอนรวมระบบ
ค่าที่ยังเป็น "ค่าเสนอ" ให้เจ้าของ service ยืนยันหรือแก้ในไฟล์นี้

| เรื่อง | ข้อตกลง |
|---|---|
| Port / hostname ใน compose | `user-service:3001`, `wallet-service:3002`, `catalog-service:3003`, `gacha-service:3004`, `collection-service:3005` (wallet/catalog/gacha เป็นค่าเสนอ) |
| Auth ผู้ใช้ | JWT จาก user-service, HS256, `iss=user-service`, userId อยู่ใน `sub` · ใช้ [`user-service/docs/jwt-verify-middleware.js`](user-service/docs/jwt-verify-middleware.js) |
| Auth ระหว่าง service | header `X-Service-Key: <SERVICE_API_KEY>`, path ขึ้นต้นด้วย `/internal/` เสมอ, Bearer ของผู้ใช้เข้า `/internal` ไม่ได้ |
| Auth admin | header `X-Admin-Key: <ADMIN_API_KEY>`, path ขึ้นต้นด้วย `/admin/` (user-service ยังไม่มี role) |
| Error format | `{ "error": { "code": "UPPER_SNAKE", "message": "...", "details": ... } }` |
| Health | `GET /health` (liveness) และ `GET /health/ready` (readiness) ทุก service ใช้ใน compose `healthcheck` |
| Tracing | รับ header `X-Request-Id` (ไม่มีให้สร้าง UUID), ส่งต่อทุกครั้งที่เรียก service อื่น, ใส่ใน response และพิมพ์ใน log |
| Idempotency | การเรียกที่สร้างข้อมูลข้าม service ต้องมี key ไม่ซ้ำ (`pullId`, `idempotencyKey`) ส่งซ้ำได้ผลเดิม |
| ID | UUID v4 สำหรับ user / order / pull · card ใช้ `CARD-###` (Catalog เป็นเจ้าของ) |
| Rarity | `COMMON` · `RARE` · `SUPER_RARE` · `ULTRA_RARE` · `SECRET_RARE` |
| เงิน | หน่วยบาท เก็บเป็นจำนวนเต็ม (ไม่ใช้ทศนิยม) |
| Timeout | เรียก service อื่นต้องมี timeout (default 3s) และตอบ `503 <SERVICE>_UNAVAILABLE` ถ้าปลายทางล่ม |
| Pagination | `?limit=&offset=` ตอบ `{ "data": [...], "total", "limit", "offset" }` |
| Secret | ทุก secret อยู่ใน env (`.env` ที่ root สำหรับ compose) ห้าม commit · production ต้องยาว ≥ 32 ตัวอักษร |

## Repo และ CI/CD
- 1 โฟลเดอร์ต่อ 1 service ที่ root ของ repo (`user-service/`, `collection-service/`, ...)
- workflow อยู่ที่ `.github/workflows/<service>-ci.yml` (GitHub ไม่รัน workflow ที่อยู่ในโฟลเดอร์ย่อย) และกรองด้วย `paths: ['<service>/**']`
- image: `ghcr.io/<owner>/<repo>/<service>` tag `sha-xxxx` + `latest` เมื่อ push เข้า `main`
- release: tag `<service>-vX.Y.Z` → image `:X.Y.Z`, `:X.Y`, `:latest` + GitHub Release (ดูตัวอย่างที่ `collection-service-release.yml`)

## รันทั้งระบบ
```bash
cp .env.example .env            # แก้ secret ทุกค่า (openssl rand -hex 32)
docker compose up --build       # user-service + collection-service
docker compose --profile full up  # รวม service ที่เหลือเมื่อมี image บน GHCR แล้ว
```
