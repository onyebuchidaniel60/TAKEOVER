# TAKEOVER

last-minute marketplace for released capacity

TAKEOVER is a Nimiq Pay Mini App: providers publish released/scarce capacity,
buyers claim it and pay in NIM through Nimiq Pay, and the backend verifies the
real transaction before marking a claim paid. Product and architecture are
specified in `PROJECT_SPEC.md` and `ARCHITECTURE.md`; work proceeds one phase
at a time per `IMPLEMENTATION_PLAN.md` (current state: `AI_HANDOFF.md`).

## Prerequisites

- Node.js `>= 20` (see `.nvmrc`; on Windows use `npm.cmd` for all npm commands)
- No live database required for Phase 1.

## Setup

```powershell
copy .env.example .env    # Windows
# cp .env.example .env    # macOS / Linux
npm.cmd install
```

`.env` is gitignored — only `.env.example` (placeholders, no secrets) is committed.
All server secrets stay server-side and are never exposed to the browser bundle.

## Verification (Phase 1)

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

Run the API and check health (no DB required):

```powershell
npm.cmd run dev:api
# GET http://localhost:3001/health -> { "status": "ok" }
```

Run the web app:

```powershell
npm.cmd run dev:web
# http://localhost:5173
```

The web dev server proxies `/api` to `http://localhost:3001`, so wallet-auth API
calls stay same-origin (cookies) during development. Wallet login itself requires
running inside Nimiq Pay with the Mini App SDK provider.

## Layout

```text
apps/web          # React + Vite + Tailwind frontend (placeholder page in Phase 1)
apps/api          # Fastify backend (GET /health in Phase 1)
packages/shared   # shared types/contracts placeholder (no business logic yet)
db/               # Drizzle config + empty schema placeholder (no tables yet)
tests/            # root-level test staging (per-phase suites land here later)
docs/checkpoints/ # phase checkpoint notes
```
