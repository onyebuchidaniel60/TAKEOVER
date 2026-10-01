// Phase 5o-A audit: the wallet signup username gap, and the provider link.
//
// WHY THIS FILE EXISTS — it replaces a FALSE GREEN.
//
// The Phase 5n-B audit asserted the provider row on slot detail renders a
// link, using the seed fixture's slot. That fixture's provider is hardcoded
// with the handle `seed_provider` (scripts/audit/seed-phase5.ts:75), so the
// assertion could only ever pass — it verified the fixture, not the product.
// In the live database 112 of 115 accounts had NO handle, and every one of
// them rendered the NON-linked fallback. A check that cannot fail is worse
// than no check, because it manufactures confidence.
//
// So this audit builds its evidence the way a real user does:
//
//   1. register through the REAL signup endpoint (POST /auth/register),
//      which collects a handle the way a real account gets one;
//   2. publish a slot owned by that account;
//   3. assert the provider row on that slot's detail page is a link whose
//      href is exactly /u/<that handle> — resolved against the API, not
//      against a fixture constant;
//   4. FALSIFYABILITY: synthesize a LEGACY handle-less provider (the state
//      112 real accounts are in and which the product can no longer create
//      through any API) and assert its detail page renders NO link. A pair
//      of assertions that can disagree is what makes the first one mean
//      something — a single positive check does not.
//
// Step 4 is why this is a new script rather than a tweak to phase5nB.mjs:
// proving a negative needs a negative case, and phase5nB only ever had a
// fixture that made the positive case unavoidable.
//
// Usage:
//   DATABASE_URL=... node scripts/audit/phase5oA.mjs
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import pg from 'pg';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const OUT = resolve('docs/redesign/audits/phase-5o-A');
const API = 'http://localhost:3001';
const WEB = 'http://localhost:5173';
const STUB_PORT = '8547';
const VIEWPORTS = '320,375,768,1280';
const CHAIN_ENV = {
  POLYGON_RPC_URL: `http://127.0.0.1:${STUB_PORT}`,
  USDT_ESCROW_CONTRACT_ADDRESS: '0x000000000000000000000000000000000000dead',
  USDT_TOKEN_ADDRESS: '0x000000000000000000000000000000000000beef',
};

/* global window */

function urlOk(url) {
  return fetch(url, { method: 'GET' }).then((r) => r.ok).catch(() => false);
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) {
      console.log(`phase5oA: ${label} up`);
      return true;
    }
    await sleep(2000);
  }
  return false;
}

function launch(label, cmd, args, extraEnv, shell) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: shell ?? process.platform === 'win32',
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
  return child;
}

function killTree(child) {
  return new Promise((r) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return r();
    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/F', '/T', '/PID', String(child.pid)], () => r());
    } else {
      child.kill('SIGKILL');
      r();
    }
  });
}

function run(cmd, args, shell = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => process.stderr.write(`[seed] ${d}`));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolveRun(out) : reject(new Error(`${cmd} exited ${code}: ${out}`))));
  });
}

/** The REAL signup endpoint — this is how a live account acquires a handle. */
async function registerThroughSignup() {
  const name = `test_5oa${String(Date.now() % 1000000).padStart(6, '0')}`;
  const res = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
    body: JSON.stringify({ email: `${name}@test.local`, password: 'audit-password-long', username: name }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const m = /takeover_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  if (!m) throw new Error('register did not set a session cookie');
  const cookie = `takeover_session=${m[1]}`;
  // Read the handle back from /me rather than trusting what we sent: the
  // point is that the account really carries one.
  const me = await (await fetch(`${API}/api/v1/me`, { headers: { cookie } })).json();
  const handle = me?.data?.user?.username;
  if (handle !== name) throw new Error(`signup handle mismatch: sent ${name}, /me says ${handle}`);
  return { cookie, handle, userId: me.data.user.id, email: `${name}@test.local` };
}

function api(cookie, method, path, payload) {
  return fetch(`${API}${path}`, {
    method,
    headers: {
      cookie,
      origin: WEB,
      'X-Takeover-Client': 'web',
      'content-type': 'application/json',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function publishSlotFor(account) {
  await api(account.cookie, 'PATCH', '/api/v1/me/provider-profile', { display_name: 'Audit Provider' });
  const created = await api(account.cookie, 'POST', '/api/v1/slots', {
    title: `Provider link audit ${account.handle}`,
    description: 'Audit fixture for the 5o-A provider link.',
    starts_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    price_usdt: '1500000',
    total_quantity: 2,
  });
  if (created.status !== 201) throw new Error(`slot create failed: ${created.status} ${await created.text()}`);
  const slotId = (await created.json()).data.slot.id;
  const published = await api(account.cookie, 'POST', `/api/v1/slots/${slotId}/publish`, {});
  if (!published.ok) throw new Error(`publish failed: ${published.status} ${await published.text()}`);
  return slotId;
}

/**
 * Synthesize a LEGACY handle-less provider + published slot directly in the
 * DB. This is the one thing the product can no longer do through any API —
 * which is exactly why it needs a fixture: D27 keeps the non-linked fallback
 * for the 112 accounts already in that state, and no signup path produces one
 * any more, so there is nothing else that can exercise it.
 */
async function seedLegacyHandlelessSlot() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tag = `legacy${Date.now() % 1000000}`;
    const userId = `00000000-0000-5000-8000-${String(Date.now() % 1e12).padStart(12, '0')}`;
    const slotId = `00000000-0000-5000-8001-${String(Date.now() % 1e12).padStart(12, '0')}`;
    await client.query(
      `INSERT INTO users (id, wallet_address, role, status, created_at, updated_at)
       VALUES ($1, $2, 'provider', 'active', now(), now())`,
      [userId, `NQ00 LEGACY${tag}`.slice(0, 64)],
    );
    await client.query(
      `INSERT INTO slots (id, provider_id, title, description, starts_at, ends_at,
                          price_usdt, total_quantity, available_quantity, status,
                          published_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now() + interval '7 days', now() + interval '30 days',
               1500000, 2, 2, 'published', now(), now(), now())`,
      [slotId, userId, `Legacy provider audit ${tag}`, '(audit fixture — legacy handle-less provider)'],
    );
    return { userId, slotId };
  } finally {
    await client.end();
  }
}

async function cleanupLegacy(legacy) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('DELETE FROM slots WHERE id = $1', [legacy.slotId]);
    await client.query('DELETE FROM users WHERE id = $1', [legacy.userId]);
  } finally {
    await client.end();
  }
}

/**
 * Remove EVERY row this audit created for its signup account.
 *
 * Written after a real leak: the first version of this script only logged the
 * session out, which left a PUBLISHED slot behind on the shared DB. That is
 * the exact submission-integrity problem the Phase 5d cleanup rule exists to
 * prevent, and it also broke security.test.ts (a stray "_" in the fixture
 * title matched a LIKE-wildcard search assertion). Deleting only what this
 * script created is the rule; leaving the teardown to a separate run is not.
 */
async function cleanupSignupAccount(account) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const slotIds = await client
      .query('SELECT id FROM slots WHERE provider_id = $1', [account.userId])
      .then((r) => r.rows.map((x) => x.id));
    if (slotIds.length > 0) {
      // Leaf rows first (FK order): claims hang off slots, escrows off claims.
      const claimIds = await client
        .query('SELECT id FROM claims WHERE slot_id = ANY($1::uuid[])', [slotIds])
        .then((r) => r.rows.map((x) => x.id));
      if (claimIds.length > 0) {
        await client.query('DELETE FROM escrow_ledger WHERE escrow_id IN (SELECT id FROM escrows WHERE claim_id = ANY($1::uuid[]))', [claimIds]);
        await client.query('DELETE FROM escrows WHERE claim_id = ANY($1::uuid[])', [claimIds]);
        await client.query('DELETE FROM payment_intents WHERE claim_id = ANY($1::uuid[])', [claimIds]);
        await client.query('DELETE FROM notifications WHERE entity_id = ANY($1::text[])', [claimIds]);
      }
      await client.query('DELETE FROM reports WHERE slot_id = ANY($1::uuid[])', [slotIds]);
      await client.query('DELETE FROM notifications WHERE entity_id = ANY($1::text[])', [slotIds]);
      await client.query('DELETE FROM audit_events WHERE entity_id = ANY($1::text[])', [slotIds]);
      await client.query('DELETE FROM slots WHERE id = ANY($1::uuid[])', [slotIds]);
    }
    await client.query('DELETE FROM notifications WHERE user_id = $1', [account.userId]);
    await client.query('DELETE FROM audit_events WHERE actor_user_id = $1', [account.userId]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [account.userId]);
    await client.query('DELETE FROM provider_profiles WHERE user_id = $1', [account.userId]);
    await client.query('DELETE FROM users WHERE id = $1', [account.userId]);
    return { slots: slotIds.length };
  } finally {
    await client.end();
  }
}

const spawned = [];
let exitCode = 0;
let created = null;
let legacy = null;
try {
  mkdirSync(OUT, { recursive: true });
  spawned.push(launch('stub', process.execPath, ['scripts/audit/polygon-stub.mjs', STUB_PORT], undefined, false));
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${STUB_PORT}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if ((await r.json()).result === '0x89') break;
    } catch { /* retry */ }
    await sleep(1000);
  }

  if (!(await urlOk(`${API}/health`))) {
    spawned.push(launch('api', NPM, ['run', 'dev', '--workspace', 'takeover-api'], CHAIN_ENV));
    if (!(await waitFor(`${API}/health`, 'api'))) throw new Error('API never healthy');
  }
  if (!(await urlOk(`${WEB}/`))) {
    spawned.push(launch('web', NPM, ['run', 'dev', '--workspace', 'takeover-web']));
    if (!(await waitFor(`${WEB}/`, 'web'))) throw new Error('web never healthy');
  }

  console.log('phase5oA: creating a provider through the REAL signup endpoint…');
  created = await registerThroughSignup();
  console.log(`phase5oA: signed up @${created.handle} (handle confirmed via /me)`);
  const SLOT = await publishSlotFor(created);
  console.log(`phase5oA: published slot ${SLOT} owned by @${created.handle}`);

  legacy = await seedLegacyHandlelessSlot();
  console.log(`phase5oA: legacy handle-less provider slot ${legacy.slotId} seeded (negative case)`);

  const TARGETS = [
    ['provider-linked', `/slot/${SLOT}?desktop=1`, 'default', 'section[aria-label="Provider"] a[href^="/u/"]', null],
    ['provider-legacy', `/slot/${legacy.slotId}?desktop=1`, 'default', 'section[aria-label="Provider"]', null],
    ['home', '/?desktop=1', 'default', 'a[href^="/slot/"]', null],
    ['public-profile', `/u/${created.handle}?desktop=1`, 'default', 'text:Openings', null],
  ];

  const merged = [];
  for (const [key, route, states, ready, cookie] of TARGETS) {
    const sub = join(OUT, key);
    console.log(`phase5oA: auditing ${key} (${route})…`);
    const args = ['scripts/audit/audit.mjs', '--route', route, '--viewports', VIEWPORTS, '--states', states, '--out', sub];
    if (ready) args.push('--ready', ready);
    if (cookie) args.push('--cookie', cookie);
    await run(process.execPath, args);
    const report = JSON.parse(readFileSync(join(sub, 'report.json'), 'utf8'));
    merged.push(...report.results);
    for (const f of readdirSync(sub)) {
      if (f.endsWith('.png')) renameSync(join(sub, f), join(OUT, `${key}-${f}`));
    }
    rmSync(sub, { recursive: true, force: true });
  }

  console.log('phase5oA: falsifiability walkthrough…');
  const browser = await chromium.launch();
  const checks = {};
  try {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await ctx.addInitScript(() => { window.nimiq = {}; });
    const page = await ctx.newPage();

    // POSITIVE: the handle came from signup, so this href must match it.
    await page.goto(`${WEB}/slot/${SLOT}?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(900);
    const link = page.locator('section[aria-label="Provider"] a[href^="/u/"]');
    checks.providerLinkCount = await link.count();
    checks.providerLinkHref = (await link.first().getAttribute('href')) ?? null;
    checks.expectedHref = `/u/${created.handle}`;
    // The href is RESOLVED, not compared to a fixture constant: it has to
    // equal the handle this run's signup produced.
    checks.providerLinkMatchesSignupHandle = checks.providerLinkHref === checks.expectedHref;
    // And the link must actually work, not merely exist.
    await link.first().click();
    await sleep(1200);
    checks.providerLinkNavigatesTo = new URL(page.url()).pathname;
    checks.providerLinkResolvesProfile = checks.providerLinkNavigatesTo === checks.expectedHref;
    await page.goto(`${WEB}/slot/${SLOT}?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(700);
    await page.screenshot({ path: join(OUT, 'walk-375-provider-linked.png'), fullPage: true });

    // NEGATIVE: the legacy handle-less provider must render the fallback and
    // NO link. Without this the positive assertion is unfalsifiable — which is
    // exactly the defect being fixed here.
    await page.goto(`${WEB}/slot/${legacy.slotId}?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(900);
    const legacyLink = page.locator('section[aria-label="Provider"] a[href^="/u/"]');
    checks.legacyProviderLinkCount = await legacyLink.count();
    checks.legacyRendersFallback = checks.legacyProviderLinkCount === 0;
    checks.legacyShowsName = (await page.locator('section[aria-label="Provider"]').textContent())?.trim().length > 0;
    await page.screenshot({ path: join(OUT, 'walk-375-provider-legacy.png'), fullPage: true });

    // The two must be able to DISAGREE — that is the property the old
    // fixture-based guard lacked.
    checks.assertionsCanDisagree =
      checks.providerLinkCount > 0 && checks.legacyProviderLinkCount === 0;

    await ctx.close();
  } finally {
    await browser.close();
  }

  writeFileSync(join(OUT, 'walkthrough.json'), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  console.log('phase5oA: walkthrough checks:', JSON.stringify(checks, null, 1));

  const failed = merged.filter((r) => !r.pass);
  console.log(`phase5oA: gates ${merged.length - failed.length}/${merged.length} pass.`);
  for (const f of failed) {
    console.log(`  FAIL ${f.viewport}: contrast=${f.contrastFailures.length} touch=${f.touchFailures.length} overflow=${f.overflow.overflow}`);
    for (const c of f.contrastFailures) console.log(`    contrast ${c.ratio} ${c.fg} on ${c.bg} (${c.fontSize}) "${c.text}"`);
    for (const t of f.touchFailures) console.log(`    touch ${t.tag} ${t.w}x${t.h} "${t.label}"`);
  }

  // The behavioural assertions are gates too — not decoration.
  const walkFails = [
    ['providerLinkMatchesSignupHandle', checks.providerLinkMatchesSignupHandle],
    ['providerLinkResolvesProfile', checks.providerLinkResolvesProfile],
    ['legacyRendersFallback', checks.legacyRendersFallback],
    ['legacyShowsName', checks.legacyShowsName],
    ['assertionsCanDisagree', checks.assertionsCanDisagree],
  ].filter(([, ok]) => ok !== true);
  for (const [name] of walkFails) console.log(`  FAIL walkthrough: ${name}`);

  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results: merged, checks }, null, 2));
  exitCode = failed.length > 0 || walkFails.length > 0 ? 1 : 0;
} catch (err) {
  console.error(`phase5oA: FATAL: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  // Cleanup is best-effort but LOUD: leftover audit rows on the shared DB are
  // the submission-integrity problem the Phase 5d standing rule exists for.
  if (legacy) {
    try {
      await cleanupLegacy(legacy);
      console.log('phase5oA: legacy fixture removed');
    } catch (err) {
      console.error(`phase5oA: WARNING legacy fixture ${legacy.userId} NOT removed: ${err.message}`);
    }
  }
  if (created) {
    await fetch(`${API}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie: created.cookie, origin: WEB, 'X-Takeover-Client': 'web', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});
    try {
      const removed = await cleanupSignupAccount(created);
      console.log(`phase5oA: signup fixture removed (${removed.slots} slot(s), 1 user)`);
    } catch (err) {
      console.error(`phase5oA: WARNING signup fixture ${created.userId} NOT removed: ${err.message}`);
    }
  }
  for (const child of spawned.reverse()) await killTree(child);
}
process.exit(exitCode);