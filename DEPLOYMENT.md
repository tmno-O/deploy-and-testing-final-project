# Deployment (CI/CD → Container Registry)

ทุก service (user, wallet, card-catalog, gacha, collection) มี pipeline อัตโนมัติผ่าน GitHub Actions ไป **GitHub Container Registry (GHCR)**

## 1) CI/CD ต่อ service — `.github/workflows/<service>-ci.yml`
| เหตุการณ์ | สิ่งที่ทำ |
|---|---|
| Pull Request ที่แตะ `<service>/**` | lint → (typecheck) → build → test + coverage → **build image เพื่อเช็ค Dockerfile** (ไม่ push) |
| Push เข้า `main` | ขั้นตอนเดียวกัน แล้ว **push image** `ghcr.io/<owner>/<repo>/<service>` tag `sha-xxxxxxx` และ `latest` |

card-catalog-service รัน Postgres จริงใน CI เพื่อทดสอบ `tests/integration/postgres.test.ts` (การล็อกแถวสต็อก)

## 2) Release version — `.github/workflows/release.yml`
สร้าง tag ชื่อ `<service>-vX.Y.Z` แล้ว push:

```bash
git tag card-catalog-service-v1.0.0
git push origin card-catalog-service-v1.0.0
```

workflow จะรัน lint/test ของ service นั้น → build image → push `:1.0.0`, `:1.0`, `:latest` ขึ้น GHCR → สร้าง GitHub Release
(tag ที่ชื่อไม่ตรงรูปแบบจะถูกปฏิเสธ) ตัวอย่าง tag: `user-service-v1.0.0`, `wallet-service-v1.0.0`, `gacha-service-v1.0.0`, `collection-service-v1.0.0`

## 3) Docker Hub (ไม่บังคับ)
ถ้าตั้ง GitHub Secrets `DOCKERHUB_USERNAME` และ `DOCKERHUB_TOKEN` (Settings → Secrets and variables → Actions) release จะ push ขึ้น
Docker Hub (`<username>/<service>`) ควบคู่กับ GHCR; ถ้าไม่ตั้ง จะ push แค่ GHCR

## 4) ตั้งค่าครั้งเดียวบน GitHub
1. Settings → Actions → General → Workflow permissions เลือก **Read and write permissions** (ให้ push image และสร้าง Release ได้)
2. หลัง push image ครั้งแรก ไปที่ Packages ของ repo → เลือก package → Package settings → เปลี่ยน Visibility เป็น Public ถ้าต้องการให้ดึง image ได้โดยไม่ login
3. Secrets ของแอป (JWT_SECRET, INTERNAL_API_KEY, DATABASE_URL) **ไม่อยู่ใน image / repo** ใส่ที่ `.env` หรือ environment ของที่รัน

## 5) รันจาก image ที่ publish แล้ว
```bash
docker pull ghcr.io/<owner>/<repo>/card-catalog-service:latest
```
หรือใช้ `docker compose up --build` ที่ root (build จากซอร์สในเครื่อง)

## 6) ผู้รับผิดชอบ (ข้อ 4 ของเงื่อนไข)
| Service | ไฟล์ CI | ผู้รับผิดชอบ |
|---|---|---|
| user-service | `user-service-ci.yml` | คนที่ 1 |
| wallet-service | `wallet-service-ci.yml` | คนที่ 2 |
| card-catalog-service | `card-catalog-service-ci.yml` | คนที่ 3 |
| gacha-service | `gacha-service-ci.yml` | คนที่ 4 |
| collection-service | `collection-service-ci.yml` | คนที่ 5 |
