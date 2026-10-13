# User & Authentication Service

Service ที่ 1 ของโปรเจกต์ Online Trading Card Gacha Platform ดูแลบัญชีผู้ใช้ การยืนยันตัวตน (JWT) โปรไฟล์ และที่อยู่จัดส่ง

**Stack:** Node.js 20 · Express 4 · mock data JSON (ไม่มี database) · Argon2id · JWT (HS256) · zod · Jest + Supertest · Docker · GitHub Actions

## เริ่มใช้งาน

### แบบ Docker (แนะนำ)
```bash
cp .env.example .env        # แล้วแก้ JWT_SECRET (openssl rand -hex 32)
docker compose up --build   # service อยู่ที่ http://localhost:3001
```
ข้อมูลอยู่ใน volume `user-data` (เริ่มจาก mock data ใน image) รีเซ็ตด้วย `docker compose down -v`

### แบบรันในเครื่อง
```bash
npm install
cp .env.example .env
npm run dev
```

## Mock data
ข้อมูลทั้งหมดเก็บในไฟล์ [`data/mock-data.json`](data/mock-data.json) (`users` และ `addresses`) โหลดเข้า memory ตอนเริ่ม server
และเขียนกลับไฟล์ทุกครั้งที่มีการเปลี่ยนแปลง (ตั้ง `PERSIST_DATA=false` ถ้าไม่อยากให้แก้ไฟล์ — รีสตาร์ทแล้วจะกลับเป็นค่าเริ่มต้น)

บัญชีตัวอย่าง (รหัสผ่านทุกบัญชี `password123`):

| email | ชื่อ | นามสกุล |
|---|---|---|
| `somchai@example.com` | Somchai | Jaidee (มี 2 ที่อยู่) |
| `somying@example.com` | Somying | Rakdee (มี 1 ที่อยู่) |

> ถ้าจะเพิ่มผู้ใช้ในไฟล์เอง ต้องใส่ `passwordHash` เป็น Argon2id (สร้างด้วย `node -e "require('./src/services/password').hash('รหัสผ่าน').then(console.log)"`)

## ทดสอบ
ไม่ต้องใช้ database — test ใช้ข้อมูลใน memory (ล้างทุก test) และไม่เขียนทับ `data/mock-data.json`
```bash
npm test                 # ทั้งหมด (55 tests)
npm run test:unit
npm run test:coverage
npm run lint
```

## API Contract

ทุก error มีรูปแบบเดียวกัน: `{ "error": { "code": "...", "message": "...", "details": [...] } }`

| Method | Path | Auth | คำอธิบาย |
|---|---|---|---|
| POST | `/auth/register` | - | สมัครสมาชิก (`email`, `password`, `firstName`, `lastName`, `displayName`) คืน user + token (201) |
| POST | `/auth/login` | - | เข้าสู่ระบบ คืน user + token |
| GET | `/users/me` | Bearer | ดูโปรไฟล์ |
| PATCH | `/users/me` | Bearer | แก้ `firstName`, `lastName`, `displayName` และ/หรือ `email` |
| PUT | `/users/me/password` | Bearer | เปลี่ยนรหัสผ่าน (`currentPassword`, `newPassword`) 204 |
| GET | `/users/me/addresses` | Bearer | รายการที่อยู่ (default อยู่บนสุด) |
| POST | `/users/me/addresses` | Bearer | เพิ่มที่อยู่ (อันแรกเป็น default อัตโนมัติ, สูงสุด 10) |
| GET | `/users/me/addresses/:id` | Bearer | ดูที่อยู่ 1 รายการ |
| PATCH | `/users/me/addresses/:id` | Bearer | แก้ไข / ตั้งเป็น default (`isDefault: true`) |
| DELETE | `/users/me/addresses/:id` | Bearer | ลบ (ถ้าลบ default จะเลื่อนอันที่เก่าสุดขึ้นแทน) 204 |
| GET | `/health` · `/health/ready` | - | liveness / readiness (ตรวจว่าโหลดข้อมูลแล้ว) |

### ตัวอย่าง
```bash
curl -X POST localhost:3001/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"gg@example.com","password":"password123","firstName":"Thanawat","lastName":"Udcha","displayName":"gg"}'
# -> { "user": {...}, "accessToken": "eyJ...", "tokenType": "Bearer", "expiresIn": 3600 }

curl localhost:3001/users/me -H "Authorization: Bearer <accessToken>"
```

### Error codes
`VALIDATION_ERROR` 400 · `INVALID_JSON` 400 · `UNAUTHORIZED` / `INVALID_TOKEN` / `TOKEN_EXPIRED` / `INVALID_CREDENTIALS` 401 · `ADDRESS_NOT_FOUND` / `NOT_FOUND` 404 · `EMAIL_TAKEN` 409 · `ADDRESS_LIMIT_REACHED` 422 · `TOO_MANY_REQUESTS` 429

## JWT Contract (ให้เพื่อนร่วมทีมใช้)
- Algorithm: **HS256**, secret = `JWT_SECRET` (ทุก service ใช้ค่าเดียวกัน เก็บใน env ห้าม commit)
- Claims: `sub` = user id (UUID), `iss` = `user-service`, `iat`, `exp` (default 1 ชั่วโมง) ไม่มีข้อมูลอื่น
- ส่งมาใน header `Authorization: Bearer <token>`
- ตัวอย่าง middleware สำหรับ service อื่น: [`docs/jwt-verify-middleware.js`](docs/jwt-verify-middleware.js)
- Fulfillment Service ดึงที่อยู่จัดส่งโดยส่งต่อ token ของผู้ใช้ไปที่ `GET /users/me/addresses/:id`

## Environment variables
| ชื่อ | จำเป็น | ค่าเริ่มต้น | หมายเหตุ |
|---|---|---|---|
| `JWT_SECRET` | ใช่ | - | production ต้อง ≥ 32 ตัวอักษร |
| `JWT_EXPIRES_IN` | | `1h` | |
| `JWT_ISSUER` | | `user-service` | |
| `PORT` | | `3001` | |
| `DATA_FILE` | | `data/mock-data.json` | ไฟล์ JSON ที่ใช้เป็นข้อมูล |
| `PERSIST_DATA` | | `true` (`false` ตอน test) | เขียนการเปลี่ยนแปลงกลับไฟล์ JSON หรือไม่ |
| `AUTH_RATE_LIMIT_MAX` | | `20` | ครั้ง/15 นาที/IP ที่ `/auth/*` |
| `TRUST_PROXY` | | ไม่ตั้ง | ตั้งเป็น `1` ถ้าอยู่หลัง API Gateway เพื่อให้ rate limit เห็น IP จริง |
| `CORS_ORIGIN` | | `*` | คั่นด้วย comma |

## โครงสร้าง
```
src/
  app.js server.js config.js store.js errors.js schemas.js
  middleware/   auth, validate, rateLimit, errorHandler
  routes/       auth, users, addresses, health
  services/     password (Argon2id), token (JWT)
  repositories/ userRepo, addressRepo (อ่าน/เขียนข้อมูลผ่าน store.js ทั้งหมด)
data/           mock-data.json
tests/          unit/ integration/ helpers/
Dockerfile · docker-compose.yml · .github/workflows/ci.yml
```

## CI/CD (GitHub Actions)
- ทุก push / pull request: `lint` → `test` → เก็บ coverage
- เมื่อ push เข้า `main`: build Docker image แล้ว push ไป `ghcr.io/<repo>/user-service` (tag `latest` และ `sha-xxxx`)
- ถ้าทีมใช้ monorepo: ย้าย `ci.yml` ไปไว้ที่ `.github/workflows/` ของ repo หลัก แล้วเพิ่ม
  `defaults.run.working-directory: user-service`, `context: user-service` และ `paths: ['user-service/**']`

## การตัดสินใจด้านความปลอดภัย
- รหัสผ่านใช้ Argon2id (m=19 MiB, t=2, p=1 ตามคำแนะนำ OWASP) และ login ตอบข้อความเดียวกันทุกกรณีพร้อมคุมเวลาตอบ
- JWT ล็อก algorithm เป็น HS256 และตรวจ `iss` จึงกัน `alg=none` ได้
- Validate ด้วย zod แบบ `strict` (ไม่รับ field แปลกปลอม เช่น `role`), body จำกัด 10 KB, helmet, rate limit
- เช็คเจ้าของที่อยู่ทุกครั้ง (กัน IDOR) และไม่คืน `passwordHash` ออกไปทาง API

## ข้อจำกัดที่รู้อยู่แล้ว (ต่อยอดได้)
- ยังไม่มี refresh token / logout ฝั่ง server (token หมดอายุเอง) และไม่มีการยืนยันอีเมล / reset password
- ยังไม่มี role (เช่น admin) เพราะ proposal ยังไม่ต้องใช้
- ใช้ไฟล์ JSON เป็นที่เก็บข้อมูล: เหมาะกับ demo / dev เท่านั้น (รันได้ instance เดียว ไม่รองรับหลาย replica) ถ้าจะขึ้นระบบจริงให้เปลี่ยน `src/repositories/*` ไปใช้ database
