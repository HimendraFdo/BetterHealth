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

## Roadmap

- [ ] Phase 0: Foundations (repo, tooling, hello-world backend)
- [ ] Phase 1: Google OAuth + fetch steps
- [ ] Phase 2: PostgreSQL + scheduled sync
- [ ] Phase 3: Dashboard (steps and calories charts)
- [ ] Phase 4: Deploy to VPS with Docker, Caddy, and CI/CD
- [ ] Phase 5: Customize and migrate to the NUC
