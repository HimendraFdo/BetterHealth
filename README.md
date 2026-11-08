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

Requires Node.js 24 or newer.

```bash
npm install        # install dependencies for every workspace
npm run dev        # start the backend with auto-reload on http://127.0.0.1:3000
npm test           # run tests
npm run typecheck  # type-check without emitting files
npm run build      # compile TypeScript to backend/dist
```

Copy `backend/.env.example` to `backend/.env` to override settings such as `PORT`.

### Connecting your Google account

1. In the Google Cloud console, create a Web application OAuth client with the redirect URI `http://127.0.0.1:3000/auth/google/callback`, add the `googlehealth.activity_and_fitness.readonly` scope, and add yourself as a test user.
2. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` in `backend/.env`.
3. Run `npm run dev` and open http://127.0.0.1:3000/auth/google.
4. Fetch steps from http://127.0.0.1:3000/api/steps?start=2026-11-01&end=2026-11-07 (inclusive dates, at most 90 days; defaults to the last 7 days).

Tokens are saved to `backend/.data/google-tokens.json` (gitignored) until Phase 2 moves them into PostgreSQL. While the OAuth app is in Testing status, Google expires the refresh token after 7 days, so you'll need to reconnect weekly.

## Roadmap

- [x] Phase 0: Foundations (repo, tooling, hello-world backend)
- [x] Phase 1: Google OAuth + fetch steps
- [ ] Phase 2: PostgreSQL + scheduled sync
- [ ] Phase 3: Dashboard (steps and calories charts)
- [ ] Phase 4: Deploy to VPS with Docker, Caddy, and CI/CD
- [ ] Phase 5: Customize and migrate to the NUC
