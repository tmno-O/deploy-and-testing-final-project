# Laptop Server Setup: instructions for Claude (run on the laptop that will host the system)

> **Hand this whole file to Claude Code running ON THE LAPTOP SERVER.** Work through the phases in order, run the
> verification step of each phase, and stop to ask the human whenever a step says **ASK**.
> Work in English. Report progress briefly. Final summary to the human in Thai.

## 0. Context

- Project: Online Trading Card Gacha Platform (microservices), GitHub repo `tmno-O/deploy-and-testing-final-project`.
- Services and ports: user-service 3001, wallet-service 3002, card-catalog-service 3003, gacha-service 3004,
  collection-service 3005, web (nginx, serves `demo/` and reverse-proxies `/api/<service>/`) on `WEB_PORT`.
- Images are published to GHCR by GitHub Actions: `ghcr.io/tmno-o/deploy-and-testing-final-project/<service>:<version>`
  (`latest`, `1.0.0`, `1.0`). They are **public** and built for **linux/amd64 only**.
- Database: one shared Supabase PostgreSQL (`DATABASE_URL`). Today only card-catalog-service uses it; user, wallet,
  collection and gacha still keep JSON files in Docker volumes (so volumes must persist across redeploys).
- Goal: this laptop runs the whole system with Docker Compose, restarts by itself, is reachable from the internet through
  a tunnel (no router changes), and redeploys automatically when GitHub publishes a new image.

## 1. Rules for Claude (safety)

1. **Never print, log, commit or paste secrets** (`JWT_SECRET`, `INTERNAL_API_KEY`, `DATABASE_URL`, tokens, passwords).
   Refer to them by name only. Never put them in a git-tracked file.
2. Do not use `sudo`, change firewall/network/power settings, install system services, or open router ports without
   telling the human what and why first (**ASK**).
3. Do not delete Docker volumes (`down -v`, `volume rm`, `system prune --volumes`) without **ASK**: they hold user data.
4. Do not push to `main`, merge PRs, or create git tags. Everything that changes the repo goes through a branch + PR the
   human merges.
5. Prefer reversible steps. After each phase run its verification and report PASS/FAIL.

## 2. Phase A: inspect the laptop

```bash
uname -a
# macOS:
sw_vers && sysctl -n machdep.cpu.brand_string
# Linux:
cat /etc/os-release && lscpu | head -20
# Windows (PowerShell): systeminfo | findstr /B /C:"OS Name" /C:"System Type"
docker --version; docker compose version
git --version; node --version 2>/dev/null
df -h . | tail -1            # need >= 10 GB free
```

Decide the CPU architecture:
- **x86_64 / amd64** → images run natively.
- **arm64 (Apple Silicon / ARM)** → images run through emulation: add `platform: linux/amd64` to every service in the
  compose file (already included below) and warn the human it is slower. **ASK** whether to switch the release workflow to
  multi-arch (`linux/amd64,linux/arm64`) instead.

## 3. Phase B: install Docker (skip what already works)

- macOS: install Docker Desktop, open it once, and enable **Settings > General > Start Docker Desktop when you sign in**.
- Ubuntu/Debian: follow https://docs.docker.com/engine/install/ubuntu/ then
  `sudo systemctl enable --now docker` and add the user to the `docker` group (**ASK** before sudo).
- Windows: Docker Desktop with the WSL2 backend; enable start on login.

Verify:
```bash
docker run --rm hello-world
docker compose version
```

## 4. Phase C: keep the laptop awake and always on (**ASK** before changing power settings)

It must not sleep when idle or when the lid is closed, and must be on mains power.
- macOS: `sudo pmset -a sleep 0 disablesleep 1` (or keep-awake tool); lid closed needs power + external display or
  `caffeinate`-style tool. Disable "Put hard disks to sleep".
- Ubuntu: `sudo systemctl mask sleep.target suspend.target hibernate.target` and set
  `HandleLidSwitch=ignore` in `/etc/systemd/logind.conf`.
- Windows: Power options → Sleep: Never; "When I close the lid": Do nothing.

## 5. Phase D: get the project files

The nginx config and the web page come from the repo, so clone it (use the HTTPS URL; ASK the human to authenticate if the repo is private):

```bash
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/tmno-O/deploy-and-testing-final-project.git
cd deploy-and-testing-final-project/repo 2>/dev/null || cd deploy-and-testing-final-project
pwd && ls    # expect: docker-compose.yml, demo/, web/, card-catalog-service/, ...
```
(The directory that contains `docker-compose.yml` and `web/nginx.conf` is called `$REPO` below.)

## 6. Phase E: production compose file

Create `$REPO/docker-compose.prod.yml` (new file; it pulls published images instead of building). Do not edit the existing `docker-compose.yml`.

```yaml
# Production stack for the laptop server: pulls published images from GHCR.
#   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
x-shared-auth: &shared-auth
  JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env.prod}
  JWT_ISSUER: ${JWT_ISSUER:-user-service}
  CORS_ORIGIN: ${CORS_ORIGIN:-*}
  TRUST_PROXY: ${TRUST_PROXY:-1}

x-internal-auth: &internal-auth
  INTERNAL_API_KEY: ${INTERNAL_API_KEY:?set INTERNAL_API_KEY in .env.prod}
  ADMIN_USER_IDS: ${ADMIN_USER_IDS:-}

x-defaults: &defaults
  restart: unless-stopped
  platform: linux/amd64        # images are amd64-only; required on arm64 hosts (runs under emulation)
  logging:
    driver: json-file
    options: { max-size: "10m", max-file: "3" }

services:
  user-service:
    <<: *defaults
    image: ${REGISTRY_PREFIX:-ghcr.io/tmno-o/deploy-and-testing-final-project}/user-service:${USER_VERSION:-latest}
    environment:
      <<: *shared-auth
      NODE_ENV: production
      PORT: 3001
      JWT_EXPIRES_IN: ${JWT_EXPIRES_IN:-1h}
      PERSIST_DATA: "true"
    volumes: [ "user-data:/app/data" ]

  card-catalog-service:
    <<: *defaults
    image: ${REGISTRY_PREFIX:-ghcr.io/tmno-o/deploy-and-testing-final-project}/card-catalog-service:${CATALOG_VERSION:-latest}
    environment:
      <<: [*shared-auth, *internal-auth]
      NODE_ENV: production
      PORT: 3003
      PERSIST_DATA: "true"
      DATABASE_URL: ${DATABASE_URL:-}
      DATABASE_SSL: ${DATABASE_SSL:-}
    volumes: [ "catalog-data:/app/data" ]

  wallet-service:
    <<: *defaults
    image: ${REGISTRY_PREFIX:-ghcr.io/tmno-o/deploy-and-testing-final-project}/wallet-service:${WALLET_VERSION:-latest}
    environment:
      <<: [*shared-auth, *internal-auth]
      NODE_ENV: production
      PORT: 3002
      CATALOG_SERVICE_URL: http://card-catalog-service:3003
      PAYMENT_PROVIDER: ${PAYMENT_PROVIDER:-mock}
      PERSIST_DATA: "true"
    volumes: [ "wallet-data:/app/data" ]
    depends_on: { card-catalog-service: { condition: service_healthy } }

  collection-service:
    <<: *defaults
    image: ${REGISTRY_PREFIX:-ghcr.io/tmno-o/deploy-and-testing-final-project}/collection-service:${COLLECTION_VERSION:-latest}
    environment:
      <<: [*shared-auth, *internal-auth]
      NODE_ENV: production
      PORT: 3005
      USER_SERVICE_URL: http://user-service:3001
      CATALOG_SERVICE_URL: http://card-catalog-service:3003
      WALLET_ENABLED: ${WALLET_ENABLED:-true}
      WALLET_SERVICE_URL: http://wallet-service:3002
      PERSIST_DATA: "true"
    volumes: [ "collection-data:/app/data" ]
    depends_on:
      user-service: { condition: service_healthy }
      card-catalog-service: { condition: service_healthy }
      wallet-service: { condition: service_healthy }

  gacha-service:
    <<: *defaults
    image: ${REGISTRY_PREFIX:-ghcr.io/tmno-o/deploy-and-testing-final-project}/gacha-service:${GACHA_VERSION:-latest}
    environment:
      <<: [*shared-auth, *internal-auth]
      NODE_ENV: production
      PORT: 3004
      CATALOG_SERVICE_URL: http://card-catalog-service:3003
      WALLET_SERVICE_URL: http://wallet-service:3002
      COLLECTION_SERVICE_URL: http://collection-service:3005
      PERSIST_DATA: "true"
    volumes: [ "gacha-data:/app/data" ]
    depends_on:
      card-catalog-service: { condition: service_healthy }
      collection-service: { condition: service_healthy }

  web:
    image: nginx:1.27-alpine
    restart: unless-stopped
    volumes:
      - ./demo:/usr/share/nginx/html:ro
      - ./web/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    ports:
      - "${WEB_PORT:-8080}:80"
    depends_on: [ user-service, card-catalog-service, wallet-service, collection-service, gacha-service ]

volumes:
  user-data:
  catalog-data:
  wallet-data:
  collection-data:
  gacha-data:
```

Note: the service containers publish **no host ports**; only `web` does. All API traffic goes through nginx
(`/api/<service>/`).

## 7. Phase F: secrets file `.env.prod` (never committed)

Create `$REPO/.env.prod`, generate fresh secrets on this laptop, and **ASK the human for `DATABASE_URL`** (Supabase
*Transaction pooler* string, port 6543, or session pooler 5432). Do not echo it back.

```bash
cd "$REPO"
J=$(openssl rand -hex 32); K=$(openssl rand -hex 32)
umask 077
cat > .env.prod <<EOF
JWT_SECRET=$J
INTERNAL_API_KEY=$K
JWT_ISSUER=user-service
JWT_EXPIRES_IN=1h
ADMIN_USER_IDS=a1b2c3d4-0002-4000-8000-000000000002,a1b2c3d4-0004-4000-8000-000000000004
CORS_ORIGIN=*
TRUST_PROXY=1
PAYMENT_PROVIDER=mock
WALLET_ENABLED=true
WEB_PORT=8080
DATABASE_URL=
DATABASE_SSL=
EOF
unset J K
grep -q '^\.env' .gitignore && echo ".env.* is git-ignored: OK"   # must print OK, otherwise STOP and tell the human
git status --short | grep -i env && echo "SECRET FILE TRACKED: STOP" || echo "no env file tracked: OK"
```
Then ask the human to paste `DATABASE_URL` into `.env.prod` **themselves** (or let them type it into the file); leave empty to run
card-catalog on its JSON file instead.

Apply the database schema once (only if `DATABASE_URL` is set and the Supabase tables do not exist yet; skip if the human already ran it):
```bash
# needs Node 20+ and the project deps; ASK before installing Node
cd "$REPO/card-catalog-service" && npm ci && npm run db:migrate && npm run db:seed
```
(`db:seed` refuses to overwrite existing data.)

## 8. Phase G: first start

```bash
cd "$REPO"
docker compose -f docker-compose.prod.yml --env-file .env.prod config -q && echo "compose file valid"
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
sleep 20
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```
If port 8080 is busy: `lsof -nP -iTCP:8080 -sTCP:LISTEN`, **do not kill** the owner (**ASK**); set `WEB_PORT=8081` in `.env.prod`.

Verification (all must pass; use the `WEB_PORT` value):
```bash
curl -s -o /dev/null -w "web %{http_code}\n" localhost:8080/
curl -s localhost:8080/api/catalog/health/ready          # {"status":"ready"}
curl -s "localhost:8080/api/catalog/cards?limit=1" | head -c 200
curl -s -X POST localhost:8080/api/user/auth/login -H 'content-type: application/json' \
  -d '{"email":"demo@example.com","password":"password123"}' | head -c 120     # contains "accessToken"
curl -s -o /dev/null -w "internal blocked: %{http_code}\n" localhost:8080/api/catalog/internal/x   # 404
```
Sample accounts (seed data, password `password123`): `demo@example.com` (user), `admin@example.com` (admin), `somchai@example.com` (user), `somying@example.com` (admin).

## 9. Phase H: start on boot

- Containers already have `restart: unless-stopped`. Docker itself must start at login/boot (Phase B).
- Reboot test (**ASK** first): reboot, wait 2 minutes, re-run the Phase G verification.

## 10. Phase I: public URL without touching the router (Cloudflare Tunnel)

**ASK** the human: do they want a public URL, and do they have a Cloudflare account (free)? If they have no domain, use a
quick tunnel for demos:

```bash
# macOS: brew install cloudflared      Ubuntu: see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:8080
```
It prints a temporary `https://<random>.trycloudflare.com` URL (changes every start; fine for a demo). For a stable URL the
human creates a named tunnel in the Cloudflare dashboard (Zero Trust > Networks > Tunnels) and gives Claude the
**tunnel token** to run (never print or save it in the repo):
```bash
docker run -d --name cloudflared --restart unless-stopped --network host cloudflare/cloudflared:latest tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN"
```
Alternative for private/team access only: Tailscale (`tailscale up`, optionally `tailscale funnel 8080`).
Public exposure means anyone can use the demo accounts: remind the human to change sample passwords or use the tunnel only during the demo.

## 11. Phase J: automatic deploy from GitHub (self-hosted runner)

The laptop is behind NAT, so GitHub cannot SSH in. Instead the laptop **pulls** work using a GitHub self-hosted runner.

1. **ASK** the human to open GitHub: repo > Settings > Actions > Runners > **New self-hosted runner**, choose the OS/arch,
   and send the commands shown (they contain a short-lived registration token: never store it).
2. Run the commands on the laptop as a **normal user** (not root) inside `~/apps/actions-runner`, use label `laptop`:
   `./config.sh --url https://github.com/tmno-O/deploy-and-testing-final-project --token <TOKEN> --labels laptop --unattended`
   then install as a service: `./svc.sh install && ./svc.sh start` (macOS/Linux; **ASK** before sudo).
3. Security: the runner executes workflow code on this laptop. Only run it for pushes to `main`/tags, never for fork PRs:
   keep Settings > Actions > General > *Fork pull request workflows* on "Require approval for all outside collaborators".
4. Create branch `ci/deploy-laptop` and add `.github/workflows/deploy-laptop.yml`, then open a PR (do not merge it):

```yaml
name: Deploy to laptop server

on:
  workflow_run:
    workflows: ["Release service"]
    types: [completed]
  workflow_dispatch:

concurrency: { group: deploy-laptop, cancel-in-progress: false }

jobs:
  deploy:
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
    runs-on: [self-hosted, laptop]
    steps:
      - name: Pull newest images and restart
        working-directory: ${{ vars.LAPTOP_REPO_DIR }}      # e.g. /Users/<name>/apps/deploy-and-testing-final-project
        run: |
          git fetch origin main && git checkout main && git pull --ff-only origin main
          docker compose -f docker-compose.prod.yml --env-file .env.prod pull
          docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --remove-orphans
          sleep 20
          curl -fsS http://localhost:${WEB_PORT:-8080}/api/catalog/health/ready
          docker image prune -f
```
Set repo variable `LAPTOP_REPO_DIR` (Settings > Secrets and variables > Actions > Variables). The human merges the PR; then a
release tag (`<service>-vX.Y.Z`, pushed one or two at a time) publishes the image and this workflow redeploys.

Also add `docker-compose.prod.yml` to the repo in the same PR **only if it contains no secrets** (it does not: secrets come from `.env.prod`).

## 11.1 คำอธิบายภาษาไทย: ระบบ Auto Re-deploy ทำงานอย่างไร (สำหรับคน ไม่ใช่สำหรับ Claude)

**คำถาม:** ถ้ามี Release ใหม่จาก GitHub ระบบบนแล็ปท็อปจะ re-deploy เองไหม?
**คำตอบ:** ใช่ ถ้าตั้งระบบครบตามเอกสารนี้แล้ว โดยไม่ต้องมีคนสั่งหรือเปิด Claude

Claude ทำหน้าที่ **ตั้งระบบครั้งเดียว** (ขั้น A ถึง J) ไม่ได้เป็นคน deploy ทุกครั้ง หลังตั้งเสร็จ GitHub Actions กับ runner บนแล็ปท็อปจะทำงานต่อเอง

**ลำดับเหตุการณ์ทุกครั้งที่ออกเวอร์ชันใหม่**
1. คนในทีม push tag ชื่อ `<service>-vX.Y.Z` เช่น `card-catalog-service-v1.1.0`
2. workflow `Release service` ทดสอบ, build image และส่งขึ้น GHCR เป็น `:1.1.0` กับ `:latest` พร้อมสร้าง GitHub Release
3. เมื่อ Release สำเร็จ workflow `Deploy to laptop server` ทำงานต่อบน runner ของแล็ปท็อป: ดึง image ใหม่ (`docker compose pull`), รีสตาร์ตเฉพาะ container ที่เปลี่ยน (`up -d`) และเช็กสุขภาพ
4. ระบบบนแล็ปท็อปเป็นเวอร์ชันใหม่ ข้อมูลใน Docker volume ไม่หาย

compose บนแล็ปท็อปใช้ tag `latest` เป็นค่าเริ่มต้น จึงได้ image ที่ release เพิ่งส่งขึ้นทันที ถ้าต้องการล็อกเวอร์ชัน ให้ตั้งตัวแปร เช่น `USER_VERSION=1.0.0` ใน `.env.prod`

**เงื่อนไขที่ต้องครบก่อนจะอัตโนมัติจริง**
- ไฟล์ `deploy-laptop.yml` ถูก merge เข้า `main` แล้ว (workflow แบบนี้ต้องอยู่บน branch หลักถึงจะทำงาน และ Claude ถูกห้าม merge เอง คนต้อง merge)
- self-hosted runner บนแล็ปท็อปออนไลน์ (เปิดเครื่อง ต่ออินเทอร์เน็ต ไม่หลับ)
- ตั้งตัวแปร `LAPTOP_REPO_DIR` ใน GitHub แล้ว (Settings, Secrets and variables, Actions, Variables)
- ถ้าแล็ปท็อปปิดอยู่ตอน release งาน deploy จะรอจนเครื่องกลับมาออนไลน์ แล้วจึงทำงาน

**ข้อควรระวัง**
- ให้สร้าง Release โดย **push tag เท่านั้น** ห้ามกดปุ่ม "Create a new release" บนหน้าเว็บ GitHub เพราะจะสร้างหน้า Release ก่อน แล้วขั้นสุดท้ายของ workflow ที่พยายามสร้างซ้ำจะ error ทำให้ deploy ไม่เกิด
- ห้าม push tag เกิน 3 ตัวพร้อมกัน เพราะ GitHub จะไม่ทริกเกอร์ workflow เลย ให้ push ทีละตัวหรือสองตัว
- การ push เข้า `main` ธรรมดาจะ build image `latest` แต่ **ไม่ทำให้แล็ปท็อปอัปเดต** ต้องผ่านการ release (tag) เท่านั้น ถ้าต้องการให้ทุก push เข้า `main` deploy ด้วย ต้องแก้ trigger ของ workflow
- runner รันโค้ดของ workflow บนแล็ปท็อปจริง จึงต้องตั้งไม่ให้ PR จากคนนอกรันบนเครื่องนี้ (ดูขั้น J ข้อ 3)
- ส่วนอื่นของไฟล์นี้เขียนเป็นภาษาอังกฤษเพราะเป็นคำสั่งให้ Claude อ่าน

## 12. Operations cheat sheet

```bash
cd "$REPO"; C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C ps                       # status
$C logs -f --tail 100 card-catalog-service
$C restart user-service
$C pull && $C up -d         # manual update
$C down                     # stop everything (keeps data volumes)
docker volume ls            # NEVER remove these without asking: they hold users/wallets/orders
```
Troubleshooting order: `ps` (healthy?) → `logs <service>` → `curl localhost:<WEB_PORT>/api/<service>/health` →
check `.env.prod` values exist (names only) → Supabase reachable (`DATABASE_URL`, pooler port, SSL).
Common errors: `no matching manifest for linux/arm64` → missing `platform: linux/amd64`; `port is already allocated` → change `WEB_PORT`;
catalog `unavailable` → wrong `DATABASE_URL` or tables not created (`npm run db:migrate`).

## 13. Final report to the human (Thai)

Summarise in Thai: what is installed, URL to open (local and public), accounts to log in with, what was left for the
human (secrets, GitHub runner token, Cloudflare), anything that failed, and the exact commands to stop/start/update.
