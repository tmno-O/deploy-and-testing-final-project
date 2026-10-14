# Card Catalog & Inventory Service (Service 3)

Source of truth for cards, packs, rarity, drop rates and physical card stock.
Default port: **3003**. Built with **NestJS 11 + TypeScript**. Status: project skeleton (health check, Docker, CI) and seed data. See the plan in `docs/card-catalog-service-plan.md`.

## Run locally

```bash
cp .env.example .env     # then set JWT_SECRET and INTERNAL_API_KEY (openssl rand -hex 32)
npm install
npm run dev
```

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Nest watch mode |
| `npm run build` / `npm start` | compile to `dist/` / run compiled build |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm run import:cards` | regenerate seed data (see below) |
| `npm test` | all tests |
| `npm run test:coverage` | tests with coverage |

## Seed data

`data/mock-data.json` is generated once from the [Pokémon TCG API](https://pokemontcg.io) and committed; the service only reads that file and never calls the API at runtime.

```bash
npm run import:cards                                   # default sets: sv3pt5, swsh7, base1
npm run import:cards -- --sets sv3pt5,swsh7 --dry-run  # preview without writing
```

- Keeps Pokémon cards that have HP: 160 cards (60 common, 40 rare, 40 epic, 20 legendary), picked deterministically across sets.
- Rarity mapping lives in `src/catalog/rarity.ts`; unknown API rarities become `common` with a warning.
- Stock: common 200, rare 80, epic 25, legendary 5 per card. Packs: `starter`, `premium`, `legendary` (rates sum to 100).
- Only image URLs on `images.pokemontcg.io` are accepted. Optional `POKEMONTCG_API_KEY` env var raises rate limits.
- Re-running overwrites the data file, including reservations. The API is flaky, so the script retries with backoff.

Card names and images are trademarks of Nintendo / Creatures Inc. / GAME FREAK inc. / The Pokémon Company, used here for educational purposes only.

## Endpoints (so far)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/health/ready` | readiness (data store loaded) |

## Security notes

- `JWT_SECRET` and `INTERNAL_API_KEY` are required; in production they must be >= 32 characters.
- The container runs as the non-root `node` user; `.env` is excluded from the image and from git.
- Tests never write to `data/mock-data.json`.
