<div align="center">

<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#453727"/>
  <g>
    <rect x="10" y="24" width="12" height="32" rx="6" fill="#FAF6EC"/>
    <rect x="42" y="24" width="12" height="32" rx="6" fill="#FAF6EC"/>
    <rect x="10" y="44" width="44" height="12" rx="6" fill="#FAF6EC"/>
    <rect x="26" y="8" width="12" height="28" rx="6" fill="#9D5A30"/>
  </g>
</svg>

# TAKEOVER

**The last-minute marketplace for released capacity.**

Something valuable just became available. Claim it before it's gone.

[![license: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![react: 18](https://img.shields.io/badge/react-18-blue)](apps/web/package.json)
[![typescript: 5.6](https://img.shields.io/badge/typescript-5.6-blue)](package.json)
[![fastify: 5](https://img.shields.io/badge/fastify-5-black)](apps/api/package.json)
[![postgresql](https://img.shields.io/badge/postgresql-blue)](db/schema)
[![polygon](https://img.shields.io/badge/polygon-8247E5)](contracts/src/TakeoverEscrow.sol)

</div>

## Live demo

The app is live at **https://takeover-web-gamma.vercel.app** — open it inside
[Nimiq Pay](https://www.nimiq.com/developers/) or any modern mobile browser.

## What it does

Restaurants, studios, and venues sit on capacity that goes unsold every day:
a table held too long, a class with three spots left, a court hour nobody
booked. TAKEOVER lets providers publish those openings in seconds, and lets
nearby buyers claim them before they expire. Buyers fund a non-custodial
USDT escrow on Polygon, so providers only get paid on confirmed delivery and
buyers are refunded when delivery never happens. Publishing a slot costs a
400 NIM listing fee paid through Nimiq Pay, which keeps the board free of
spam.

## How it works

1. Provider publishes a slot (pays the NIM listing fee).
2. Buyer discovers it and claims it (short hold).
3. Buyer funds the escrow with USDT on Polygon.
4. Provider marks delivered.
5. Buyer confirms — escrow releases.
6. If the provider never delivers, the buyer is refunded.

## Architecture

```text
Nimiq Pay Mini App (React)
   ↓ auth + NIM listing fee
Fastify backend (TypeScript + Zod)
   ↓ Drizzle ORM
PostgreSQL (Supabase)
   ↓ events + server-signed calls
Polygon — TakeoverEscrow (USDT, non-custodial)
```

The server is authoritative for identity, ownership, inventory, and payment
state; the database transaction (row lock + unique constraints) is what makes
the final unit of a slot unclaimable twice. The full rules live in
`ARCHITECTURE.md`; the product contract in `PROJECT_SPEC.md`.

## Tech stack

- Frontend: React 18 + Vite + Tailwind, Nimiq Mini App SDK, system font, light + dark mode
- Backend: Fastify 5 + Zod, TypeScript throughout
- Data: PostgreSQL (Supabase) + Drizzle ORM, migrations in `db/migrations/`
- Chain: Solidity escrow (`contracts/`, Foundry tests), Nimiq JSON-RPC verification
- Quality: Vitest suites (unit + live-DB integration), axe-core a11y per route

## Running locally

Prerequisites: Node 20+ (see `.nvmrc`), Foundry (contracts only), a
Supabase project (`DATABASE_URL`), a Nimiq Pay test wallet.

```powershell
git clone https://github.com/onyebuchidaniel60/TAKEOVER.git
cd TAKEOVER
npm.cmd install
copy .env.example .env    # fill in DATABASE_URL + the vars you need
npm.cmd run db:migrate
npm.cmd run dev:api       # backend on :3001
npm.cmd run dev:web       # frontend on :5173 (proxies /api to :3001)
```

Details (environments, deploy targets, the manual device walkthrough) live in
`docs/deployment/`.

## Testing

`npm test` runs the full suite: api + web + shared, including live-DB
integration (those suites skip cleanly without `DATABASE_URL`).

## Project structure

```text
apps/api/       — Fastify backend
apps/web/       — React frontend
contracts/      — TakeoverEscrow Solidity + Foundry tests
db/             — Drizzle schema + migrations
packages/       — shared types
docs/           — deployment and reference docs
```

## License

MIT — see [LICENSE](LICENSE).
