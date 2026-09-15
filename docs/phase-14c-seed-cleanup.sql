-- Phase 14c round 3 — Fix B1: one-time production seed cleanup (HUMAN-EXECUTED).
--
-- What / why: the shared database contains 21 `db:seed` development fixture
-- slots (fixed IDs 22222222-…-000000000001..021, placeholder payouts
-- `NQ00 SEEDPAYOUT…`, providers `NQ00 SEEDFIXTURE…`) that were inserted before
-- the seed script's production guard was enforced. Their payouts fail Nimiq
-- address canonicalization, so ANY claim on them dies at payment-intent with
-- 500 INTERNAL_ERROR — real users cannot pay for them, ever. The round-2
-- diagnosis proved this live. This script removes the fixtures and any
-- children (claims on them — including claims by real wallets, which could
-- never complete — plus intents/reports/audits tied to seed rows).
--
-- HOW TO RUN: paste this whole file into the Supabase SQL editor and run it
-- manually. It opens a transaction and STOPS before COMMIT: review the
-- post-deletion verification output (all zeros expected), then run the final
-- COMMIT yourself. To abort instead, run ROLLBACK.
--
-- DO NOT re-run `db:seed` against this database afterwards: the seed script
-- refuses NODE_ENV=production, and this cleanup is the one-time corrective
-- action for rows introduced before that guard was enforced.

BEGIN;

-- ── Step 0. Fence check: every row our patterns match must be a fixture ──
-- Expect: 5 users, 21 slots, all wallets matching NQ00%SEED%, zero otherwise.
SELECT 'users_matching_seed_pattern' AS check_name, count(*) AS n
  FROM users WHERE wallet_address LIKE 'NQ00%SEED%';
SELECT 'users_matching_id_prefix' AS check_name, count(*) AS n
  FROM users WHERE id::text LIKE '11111111-%';
SELECT 'nonseed_wallets_with_seed_ids' AS check_name, count(*) AS n
  FROM users WHERE id::text LIKE '11111111-%' AND wallet_address NOT LIKE 'NQ00%SEED%';
-- ^^^ Must be 0. If not 0, STOP (ROLLBACK) — the fixture contract drifted.
SELECT 'slots_matching_id_prefix' AS check_name, count(*) AS n
  FROM slots WHERE id::text LIKE '22222222-%';
SELECT 'slots_with_seed_payouts' AS check_name, count(*) AS n
  FROM slots WHERE payout_wallet LIKE 'NQ00%SEED%';
SELECT 'nonseed_payouts_with_seed_ids' AS check_name, count(*) AS n
  FROM slots WHERE id::text LIKE '22222222-%' AND payout_wallet NOT LIKE 'NQ00%SEED%';
-- ^^^ Must be 0. If not 0, STOP (ROLLBACK).

-- ── Step 1. BEFORE counts (record these; post-counts must read zero) ──
SELECT 'before: seed users' AS c, count(*) AS n
  FROM users WHERE id::text LIKE '11111111-%';
SELECT 'before: seed slots' AS c, count(*) AS n
  FROM slots WHERE id::text LIKE '22222222-%';
SELECT 'before: claims on seed slots' AS c, count(*) AS n
  FROM claims WHERE slot_id IN (SELECT id FROM slots WHERE id::text LIKE '22222222-%');
SELECT 'before: intents on seed-slot claims' AS c, count(*) AS n
  FROM payment_intents WHERE claim_id IN (
    SELECT id FROM claims WHERE slot_id IN (SELECT id FROM slots WHERE id::text LIKE '22222222-%'));
SELECT 'before: reports on seed slots' AS c, count(*) AS n
  FROM reports WHERE slot_id IN (SELECT id FROM slots WHERE id::text LIKE '22222222-%');
SELECT 'before: audits by seed users' AS c, count(*) AS n
  FROM audit_events WHERE actor_user_id IN (SELECT id FROM users WHERE id::text LIKE '11111111-%');

-- ── Step 2. DELETEs, FK-safe order (children first) ──
DELETE FROM payment_intents WHERE claim_id IN (
  SELECT id FROM claims WHERE slot_id IN (SELECT id FROM slots WHERE id::text LIKE '22222222-%'));
DELETE FROM claims WHERE slot_id IN (SELECT id FROM slots WHERE id::text LIKE '22222222-%');
DELETE FROM reports WHERE slot_id IN (SELECT id FROM slots WHERE id::text LIKE '22222222-%');
DELETE FROM audit_events WHERE actor_user_id IN (SELECT id FROM users WHERE id::text LIKE '11111111-%');
DELETE FROM slots WHERE id::text LIKE '22222222-%';
DELETE FROM provider_profiles WHERE user_id IN (SELECT id FROM users WHERE id::text LIKE '11111111-%');
DELETE FROM users WHERE id::text LIKE '11111111-%';

-- ── Step 3. AFTER counts (all must read zero) ──
SELECT 'after: seed users' AS c, count(*) AS n
  FROM users WHERE id::text LIKE '11111111-%' OR wallet_address LIKE 'NQ00%SEED%';
SELECT 'after: seed slots' AS c, count(*) AS n
  FROM slots WHERE id::text LIKE '22222222-%' OR payout_wallet LIKE 'NQ00%SEED%';
SELECT 'after: claims on seed slots' AS c, count(*) AS n
  FROM claims WHERE slot_id IN (SELECT id FROM slots WHERE id::text LIKE '22222222-%');
SELECT 'after: intents on seed-slot claims' AS c, count(*) AS n
  FROM payment_intents WHERE claim_id IN (
    SELECT id FROM claims WHERE slot_id IN (SELECT id FROM slots WHERE id::text LIKE '22222222-%'));

-- ── Step 4. Human decision point ──
-- Review the Step-3 output above. If every count is zero, finalize with:
-- COMMIT;
-- Otherwise run ROLLBACK; and report the nonzero counts.
-- COMMIT;
