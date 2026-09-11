# TAKEOVER — AI Handoff

Status: Pre-implementation
Date: 2026-09-11

## Project

TAKEOVER is a Nimiq Pay Mini App for the last-minute marketplace of released/scarce capacity.

Core loop:

```text
Provider publishes slot
      ↓
Buyer discovers slot
      ↓
Buyer claims/holds slot
      ↓
Buyer pays exact NIM amount via Nimiq Pay
      ↓
Backend verifies transaction on-chain
      ↓
Claim becomes PAID
      ↓
Provider sees paid claim / buyer sees confirmation
```

## Current status

Product design, business logic, architecture, security model, data model, API requirements, UX structure, and phased implementation plan have been completed before implementation.

No application implementation should be assumed complete merely because a starter scaffold exists.

## Important product decisions

- MVP is provider-created capacity, not arbitrary consumer reservation transfer.
- NIM-only payments for MVP.
- Direct provider payout, no escrow.
- Backend is authoritative for payment verification.
- No AI in MVP.
- No calendar integrations.
- No ratings/reputation.
- No fiat payments.
- Published commercial fields are immutable.
- Inventory claims are protected with DB transactions and uniqueness constraints.

## Fixed stack

React + TypeScript + Vite + Tailwind + Nimiq Mini App SDK

Fastify + TypeScript + Zod

PostgreSQL + Drizzle, hosted on Supabase

Vercel frontend, Railway API

## Critical architecture invariants

1. Browser cannot declare a payment successful.
2. Browser cannot choose the payout recipient for an already-issued payment intent.
3. Browser cannot change slot ownership.
4. Browser cannot set admin role.
5. Claiming the same final unit is concurrency-safe.
6. Replaying an auth challenge fails.
7. Replaying a verified transaction against a second claim fails.
8. All protected resources are authorized server-side.
9. Secrets remain server-only.
10. Payment verification is deterministic and independent of LLMs.

## Current phase

**Phase 2 complete — Database schema and migrations done (2026-09-11). Next: Phase 3 — Wallet authentication (NOT started, awaiting explicit instruction).**

## Phase 2 implementation results (2026-09-11)

Implemented the 9-table MVP relational model exactly per the Phase 2 brief, generated
migration `db/migrations/0000_futuristic_the_hunter.sql` (+ journal/snapshot), applied it
to the live Supabase database (was confirmed empty: 0 tables), and confirmed 9 tables
via `information_schema`. No application logic, no seed data, no API route changes
(`/health` untouched and still DB-independent).

- Schema: `db/schema/` — `enums.ts` (6 pgEnums) + one module per table
  (`users`, `auth`, `provider-profiles`, `slots`, `claims`, `payment-intents`,
  `reports`, `audit-events`) + barrel `index.ts`. All brief-required UNIQUEs,
  the 3 slots CHECKs, the partial unique claims index, and the 4 listed indexes
  verified present in the generated SQL before applying.
- Scripts: `db:generate`, `db:migrate` (drizzle-kit with `--config=db/drizzle.config.ts`),
  `db:verify` (`tsx db/verify.ts` — `SELECT 1` + `information_schema` table list).
- Connectivity: `apps/api/test/db-connectivity.test.ts` runs live `SELECT 1` via
  `getDb()` when `DATABASE_URL` is set, else `skipIf` so `npm run test` stays green offline.
- Secret handling: env source is local `.env.txt` (contains only `DATABASE_URL`);
  values were loaded into the shell and NEVER printed — outputs/logs/commits contain
  only key names and boolean presence. `.env.txt` added to `.gitignore` (it was
  previously unignored — secret-leak risk closed). No `.env` file created. Migration
  SQL, journal, and snapshot contain no secrets.
- REPORTED (not decided) — Phase 2 brief vs `ARCHITECTURE.md` s9 naming/content deltas.
  Implemented the brief exactly; `ARCHITECTURE.md` s9 was NOT edited (needs owner call):
  users `role` enum(buyer/provider/admin, dflt buyer) vs TEXT DEFAULT USER + `disabled_at`
  (brief: `status` enum, no `display_name`); sessions `token_hash` vs `session_hash`;
  provider_profiles own-`id` PK + `display_name`/`verified` bool vs `user_id` PK/FK +
  `provider_name`/geo/`verified_at`; slots `starts_at`/`ends_at` (nullable),
  `total_quantity`, `price_nim`, `payout_wallet`, nullable description/category/location
  vs `start_at`/`end_at NOT NULL`, `capacity`, `price_nim_base_units`,
  `payout_wallet_address`, `venue_* NOT NULL`, `cancelled_at`/`expired_at`;
  claims `claimed_at`, NO `quantity` column (multi-unit claims would then always be 1 —
  flag for Phase 6), no `payment_pending_until`/`paid_at`/`cancelled_at`;
  payment_intents `expected_*` naming + single nullable-unique `tx_hash` + `submitted_at`
  vs `submitted/verified_tx_hash` split + `verification_attempts`/`last_verification_error`;
  reports `reason`/`details`/`reviewed_at` vs `category`/`description`/`resolved_by`/`resolved_at`;
  audit_events `metadata` jsonb + `entity_id` TEXT NOT NULL vs `metadata_json` +
  `entity_id` UUID NULL + `request_id`. Note: claims partial index includes `paid` and
  `payment_review` — stricter than ARCH s9 ("one ACTIVE_HOLD or PAYMENT_PENDING per
  buyer+slot"); a buyer with a paid claim cannot hold the same slot again (matters for
  multi-quantity slots in Phase 6). None of the deltas break the AGENTS.md business-rule
  invariants at schema level (replay guards, tx uniqueness, inventory CHECKs present).

IMPLEMENTATION DETAILS — AGENT DECIDED:

- `created_at`/`updated_at`/`claimed_at`/`last_seen_at` (all NOT NULL per brief) get
  `DEFAULT now()`; `updated_at` has no DB trigger — app sets it explicitly (later phases).
- FKs use drizzle defaults (`ON DELETE/UPDATE no action`); no cascades invented.
- Drizzle table/column naming: camelCase JS keys with explicit snake_case DB names.
- `db/migrations/.gitkeep` removed (real migration files now stage the directory).

Verification (actual, via `npm.cmd`; node v24.20.0 / npm 11.19.0):

- `run typecheck` → clean (api+web+shared+db), exit 0 (re-run after prettier fix).
- `run lint` → clean, exit 0 (re-run after prettier fix).
- `run db:verify -- --expect-empty` (pre-migration) → `SELECT 1 ok`, `tables (0): (none)`, exit 0.
- `run db:generate` → 9 tables detected, `0000_futuristic_the_hunter.sql` created, exit 0.
- `run db:migrate` → `migrations applied successfully!`, exit 0.
- `run db:verify` (post-migration) → `SELECT 1 ok`, `tables (9): audit_events,
  auth_challenges, claims, payment_intents, provider_profiles, reports, sessions,
  slots, users`, exit 0.
- `run test` (with live DB env) → 9/9 pass (api 5 env + 2 health + 1 live
  connectivity; shared 1 smoke), exit 0.
- `run build` → clean all 3 workspaces, exit 0. `run format` → clean, exit 0.

## Checkpoint

```text
CURRENT PHASE: Phase 2 complete
COMPLETED: 9-table schema + migration applied to live Supabase (was empty, now 9 tables)
TESTS RUN: typecheck clean; lint clean; tests 9/9 pass (incl. live SELECT 1);
  build clean; format clean; pre/post-migration information_schema verified (0 -> 9)
RESULT: clean database migrates from zero; constraints/indexes/FKs live;
  no domain logic yet; /health still DB-independent
KNOWN ISSUES: none functional. Brief-vs-ARCHITECTURE-s9 deltas reported above —
  ARCHITECTURE.md s9 needs owner reconciliation before/at Phase 3.
SECURITY NOTES: DATABASE_URL never printed (key name + boolean presence only);
  .env.txt gitignored; migration files contain no secrets; no seed data; no API
  routes touch the DB
FILES CHANGED: .gitignore, package.json, db/schema/* (9 new + index.ts),
  db/tsconfig.json, db/verify.ts, db/migrations/0000_*.sql + meta/*,
  apps/api/test/db-connectivity.test.ts, AI_HANDOFF.md (this checkpoint)
GIT COMMIT: chore: phase 2 database schema and migrations
NEXT TASK: Phase 3 — Wallet authentication (do NOT start automatically)
BLOCKED BY: none
```

## Exact next task (Phase 3 — awaiting explicit instruction, DO NOT start)

Phase 3 objective per `IMPLEMENTATION_PLAN.md`: secure wallet-based identity and
sessions (challenge creation, Nimiq signature verification, session creation, logout,
current-user endpoint, auth middleware, disabled-user enforcement). STOP — do not
begin Phase 3 automatically.

## Phase 1 implementation results (2026-09-11)

Created the npm-workspaces monorepo foundation. No product features, no auth,
no slots/claims/payments/admin, no Nimiq SDK wiring (all deferred per phase scope).

New structure:

```text
package.json (workspaces: apps/*, packages/*; engines node>=20; type: module)
.nvmrc (24.20.0) | .gitignore | .env.example | LICENSE (MIT) | README.md
tsconfig.base.json | eslint.config.js (flat) | .prettierrc / .prettierignore
apps/web    # Vite 5 + React 18 + TS + Tailwind v3 placeholder page
apps/api    # Fastify 5 + Zod; GET /health -> { "status": "ok" }; env validation
packages/shared  # placeholder contracts only (version/health/app-info)
db/         # drizzle.config.ts + schema/index.ts (empty) + lazy client.ts
tests/ docs/checkpoints/  # staged with .gitkeep
package-lock.json (committed)
```

- `GET /health` has no DB dependency; API boots with zero env configured.
- Env policy (Phase 1): all vars optional; `loadEnv()` warns and falls back,
  never throws; pure `parseEnv()` throws ZodError for tests/later phases.
- Secrets: only `.env.example` (placeholders) committed; `.env` gitignored;
  no secrets in browser bundle (web has no env wiring at all).
- `/health` returns `{ "status": "ok" }` (plain infra shape). The
  `{data,requestId}` envelope from ARCHITECTURE.md s12 applies to `/api/v1`
  routes starting Phase 3 — no conflict.

IMPLEMENTATION DETAILS — AGENT DECIDED (within fixed architecture):

- Dependency majors: react 18.3.1, vite ^5.4, tailwind ^3.4 (+postcss/autoprefixer),
  fastify ^5.0, zod ^3.23, drizzle-orm ^0.36 / drizzle-kit ^0.28, pg ^8.13,
  vitest ^2.1, eslint ^9.14 + typescript-eslint ^8, prettier ^3.3, tsx ^4, TS ^5.6.
  (Registry resolved eslint 9.39.5 with a "no longer supported" deprecation
  notice — functional; revisit in a later phase if needed.)
- API default port 3001 (web dev keeps Vite default 5173).
- Root `type: module` added solely to silence Node's typeless-package warning
  when ESLint loads the flat config; api/shared stay CommonJS via tsc.
- `db/` is not a workspace (no package.json); runtime DB deps (`drizzle-orm`,
  `pg`) live in `takeover-api`; `db/` has its own tsconfig checked by root `typecheck`.
- Root `dev` starts the API; `dev:web` / `dev:api` documented in README.
- Prettier ignores the authoritative spec markdown docs (never reformat them).
- LICENSE copyright: `onyebuchidaniel60` (repo owner handle).
- No dotenv dependency: devs copy `.env.example` to `.env`; Node `--env-file`
  or shell exports supply values.

Verification (actual, via `npm.cmd`; toolchain node v24.20.0 / npm 11.19.0):

- `npm.cmd install --no-audit --no-fund` → 466 packages, exit 0.
- `npm.cmd run typecheck` → clean (api + web + shared + db), exit 0.
- `npm.cmd run lint` → clean, exit 0.
- `npm.cmd run test` → 8/8 pass (api: 5 env + 2 health; shared: 1 smoke), exit 0.
- `npm.cmd run build` → api (tsc) + web (vite: 31 modules, dist ok) + shared (tsc), exit 0.
- `npm.cmd run format` → clean after scoping spec docs out, exit 0.
- Live: built `apps/api/dist/server.js` on PORT=3101 → `GET /health` = 200
  `{"status":"ok"}` (verified via Invoke-RestMethod; Fastify log confirms).
  No DB configured; port free and no node residue afterwards.
- Note: PowerShell 5.1 `$?` after `npm.cmd ... 2>&1` can report False despite
  exit 0 (stderr-merge artifact); use `$LASTEXITCODE` as authoritative.

## Checkpoint

```text
CURRENT PHASE: Phase 1 complete
COMPLETED: monorepo foundation + env (no product features)
TESTS RUN: typecheck clean; lint clean; tests 8/8 pass; build clean (all 3
  workspaces); format clean; live /health 200 {"status":"ok"} without DB
RESULT: frontend builds, backend starts, health returns 200, no DB required
KNOWN ISSUES: eslint 9.39.5 deprecation notice (functional); $PROFILE-scope
  note: use npm.cmd + $LASTEXITCODE on this Windows env
SECURITY NOTES: no secrets committed (.env.example placeholders only);
  no auth/payment surface exists yet; .env gitignored
FILES CHANGED: package.json, package-lock.json, .nvmrc, .gitignore,
  .env.example, LICENSE, README.md, tsconfig.base.json, eslint.config.js,
  .prettierrc, .prettierignore, apps/web/**, apps/api/**,
  packages/shared/**, db/**, tests/.gitkeep, docs/checkpoints/.gitkeep,
  AI_HANDOFF.md (this checkpoint)
GIT COMMIT: chore: phase 1 foundation and environment
NEXT TASK: Phase 2 — Database schema and migrations (do NOT start automatically)
BLOCKED BY: none (Phase 2 will need Supabase DATABASE_URL for migration smoke test)
```

## Exact next task (Phase 2 — awaiting explicit instruction, DO NOT start)

Phase 2 objective per `IMPLEMENTATION_PLAN.md`: create the complete MVP
relational model (users, sessions, auth_challenges, provider_profiles, slots,
claims, payment_intents, reports, audit_events) with constraints/indexes and
migration scripts. STOP — do not begin Phase 2 automatically.

## Phase 0 reconnaissance results (2026-09-11)

Baseline: the repository contains NO application code. Tracked in git: only
`README.md` (2 lines). Present in working tree but untracked before this
checkpoint: `AGENTS.md`, `AI_HANDOFF.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `PROJECT_SPEC.md`, `TAKEOVER_COMPLETE_BLUEPRINT.md`.

- Architecture (actual): none implemented. No frontend, backend, database,
  auth, payment, tests, lint/build scripts, env config, or deployment config.
- Stack (actual): no `package.json`, no lockfile, no dependencies at all —
  specified stack (React+Vite+Tailwind+SDK / Fastify+Zod / Postgres+Drizzle)
  is 0% implemented. Greenfield.
- Entry points: none. No `src/`, `apps/`, `index.html`, server entry.
- Reusable components: none exist.
- Nimiq integration: none. No `@nimiq/mini-app-sdk`, no wallet/auth/payment code.
- Backend/database: none. No Fastify app, no Drizzle schema, no migrations.
- Auth/payment: none. No sessions, challenges, claims, intents, verification.
- Spec comparison: every MUST HAVE in `PROJECT_SPEC.md` (FR-01–FR-11) and every
  system in `ARCHITECTURE.md` is unimplemented. No conflicts with the spec —
  there is no code to conflict. Spec docs are mutually consistent.
- Security risks in existing code: none (no code). Process risks noted:
  spec docs were untracked in git; no `LICENSE` (competition requires MIT —
  Phase 15 item); no secrets present (good); remote is public GitHub
  `onyebuchidaniel60/TAKEOVER`.
- Verification run: `npm run build` / `lint` / `test` all fail with ENOENT
  (no `package.json`) — N/A by design at baseline. Typecheck N/A (no
  `tsconfig`). Toolchain: node `v24.20.0`, npm `11.19.0` (via `npm.cmd`;
  `npm.ps1` blocked by ExecutionPolicy). `git log`: single commit `82764dc`
  "Initial commit" (README only).
- Phase 1 will CREATE (no existing files to modify): `package.json` +
  lockfile, `apps/web` (React+Vite+TS+Tailwind+SDK scaffold), `apps/api`
  (Fastify+TS+Zod), env validation module, DB client/config, `GET /health`,
  dev scripts, `.gitignore`, `tsconfig` base.
- Blockers: none hard. Phase 1 needs: package-manager choice, monorepo layout
  confirmation (`apps/web`, `apps/api` per plan), Supabase project/connection
  string for DB smoke test, Node version pin.

## Checkpoint

```text
CURRENT PHASE: Phase 0 complete
COMPLETED: repository audit
TESTS RUN: npm run build / lint / test — all N/A (ENOENT, no package.json);
  typecheck N/A (no tsconfig); git/file-system inspection done
RESULT: baseline confirmed — greenfield repo, spec docs consistent, no code
KNOWN ISSUES: spec docs were untracked; no LICENSE yet (Phase 15);
  npm.ps1 blocked by Windows ExecutionPolicy (use npm.cmd)
SECURITY NOTES: no application code, no secrets, nothing to exploit;
  no auth/payment surface exists yet
FILES CHANGED: AI_HANDOFF.md (this checkpoint); newly tracked baseline docs:
  AGENTS.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, PROJECT_SPEC.md,
  TAKEOVER_COMPLETE_BLUEPRINT.md
GIT COMMIT: chore: baseline repository audit
NEXT TASK: Phase 1 — Foundation and environment (do NOT start automatically)
BLOCKED BY: none (needs: package-manager + layout confirmation, Supabase DB URL)
```

## Exact next task (Phase 1 — awaiting explicit instruction, DO NOT start)

Phase 1 objective per `IMPLEMENTATION_PLAN.md`: make the fixed
frontend/backend/database architecture boot cleanly (workspaces, env
validation, Zod, Drizzle connection, `GET /health`, dev scripts, preserve Nimiq
SDK integration). STOP — do not begin Phase 1 automatically.

## Known deliberate limitations

The MVP has no escrow or automated refunds. This is a conscious scope/security decision, not an unfinished feature.

The MVP does not automatically prove that an external business booking exists. The marketplace assumes the publisher is authorized to provide the listed capacity and provides reporting/moderation controls for abuse.

## Implementation detail allowance

The agent may choose low-level implementation details only when they do not change externally visible product behavior or architecture. Such decisions must be documented when material.
