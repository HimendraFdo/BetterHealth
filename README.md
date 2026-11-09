# BetterHealth

A personal health dashboard built on the Google Health API. It pulls my Fitbit data (starting with steps and calories burned), stores it in my own database, and shows it the way I want.

## Architecture

```
Browser ──> Frontend (React) ──> Backend API (Fastify) ──> Google Health API
                                      │
                                      ├──> PostgreSQL (synced health data + tokens)
                                      └──> Scheduler (periodic sync)
```

## Stack

| Layer | Tech |
|---|---|
| Language | TypeScript |
| Frontend | React + Vite |
| Backend | Node.js + Fastify |
| Database | PostgreSQL |
| Packaging | Docker Compose |
| Reverse proxy | Caddy (automatic HTTPS) |
| CI/CD | GitHub Actions |
| Hosting | Linux VPS, later a self-hosted NUC |

## Project layout

```
backend/    API server: OAuth, Google Health API calls, sync jobs
frontend/   React dashboard
```

## Running locally

Requires Node.js 24 or newer and Docker Desktop.

1. Copy `.env.example` to `.env` (read by Docker Compose) and set a `POSTGRES_PASSWORD`.
2. Copy `backend/.env.example` to `backend/.env` and put the same password in `DATABASE_URL`.

```bash
docker compose up -d  # start PostgreSQL in the background (data persists in a volume)
npm install        # install dependencies for every workspace
npm run migrate    # create or update the database tables
npm run dev        # start the backend (:3000) and the dashboard (http://127.0.0.1:5173) together
npm test           # run tests
npm run typecheck  # type-check without emitting files
npm run build      # compile backend/dist and bundle frontend/dist
```

### Connecting your Google account

1. In the Google Cloud console, create a Web application OAuth client with the redirect URI `http://127.0.0.1:3000/auth/google/callback`, add the `googlehealth.activity_and_fitness.readonly` scope, and add yourself as a test user.
2. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` in `backend/.env`.
3. Set `APP_URL=http://127.0.0.1:5173` in `backend/.env` so Google sends you back to the dashboard afterwards.
4. Run `npm run dev`, open http://127.0.0.1:5173 and click **Connect Google**. Connecting starts a sync straight away.

Tokens are stored in PostgreSQL. While the OAuth app is in Testing status, Google expires the refresh token after 7 days, so you'll need to reconnect weekly.

### Syncing and reading data

The server syncs steps and calories from Google into PostgreSQL when it starts and then every `SYNC_INTERVAL_MINUTES` (default 60). The first sync downloads `SYNC_BACKFILL_DAYS` of history (default 365); after that, each sync fetches the days since the last one plus the 3 days before it, because today keeps changing until midnight and watches upload late.

| Endpoint | What it does |
|---|---|
| `GET /api/steps?start=2026-11-01&end=2026-11-07` | Daily step totals from the database (inclusive dates, up to 366 days; defaults to the last 7 days) |
| `GET /api/calories?start=...&end=...` | Daily calories burned (kcal), same parameters |
| `POST /api/sync` | Sync from Google now and report what was fetched |
| `GET /api/status` | Whether Google is connected, how far each metric is synced, and whether the last sync failed (e.g. expired sign-in) |

The dashboard (`frontend/`, React + Vite) proxies `/api` and `/auth` to the backend in development, so the browser only talks to one origin.

A day with `"value": null` means Google had no data for it; a missing day means it hasn't been synced or Google has no record of it.

## Roadmap

- [x] Phase 0: Foundations (repo, tooling, hello-world backend)
- [x] Phase 1: Google OAuth + fetch steps
- [x] Phase 2: PostgreSQL + scheduled sync
- [ ] Phase 3: Dashboard (steps and calories charts)
- [ ] Phase 4: Deploy to VPS with Docker, Caddy, and CI/CD
- [ ] Phase 5: Customize and migrate to the NUC
