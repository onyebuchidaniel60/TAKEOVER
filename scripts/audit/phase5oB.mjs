// Phase 5n-D audit: multi-quantity claims.
//
// A dedicated script rather than a with-backend.mjs invocation, because the
// states this phase has to prove are DATA states (available = 1 vs available =
// 5, quantity 1 vs quantity 3 selected, a claim holding 3 slots) and the
// shared seed fixture can only ever produce one of them. A harness that
// cannot render the state under test cannot audit it — which is the same trap
// as the Phase 5n-B false green, in a different costume.
//
// What it proves, per the brief:
//   * available = 1  -> NO selector, CTA unchanged ("Claim this slot")
//   * available = 5  -> selector visible, default 1
//   * quantity 3 chosen -> live total = price x 3, CTA reads "Claim 3 slots"
//   * the stepper buttons are >= 44px at EVERY viewport (touch gate)
//   * a claim holding 3 slots states the count on its detail page
//   * a buyer's claims list shows the count, and shows nothing at 1 unit
//   * contrast / overflow gates at 320, 375, 768, 1280
//
// Everything it creates is deleted in `finally` — the lesson from the 5o-A
// audit, which leaked a published slot on the shared DB.
//
// Usage:
//   DATABASE_URL=... node scripts/audit/phase5oB.mjs
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import pg from 'pg';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const OUT = resolve('docs/redesign/audits/phase-5n-D');
const API = 'http://localhost:3001';
const WEB = 'http://localhost:5173';
const STUB_PORT = '8548';
const VIEWPORTS = '320,375,768,1280';
const CHAIN_ENV = {
  POLYGON_RPC_URL: `http://127.0.0.1:${STUB_PORT}`,
  USDT_ESCROW_CONTRACT_ADDRESS: '0x000000000000000000000000000000000000dead',
  USDT_TOKEN_ADDRESS: '0x000000000000000000000000000000000000beef',
};
/** 1.5 USDT in base units — so price x 3 is a visibly different figure. */
const UNIT_PRICE = '1500000';

/* global window, document */

function urlOk(url) {
  return fetch(url, { method: 'GET' }).then((r) => r.ok).catch(() => false);
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) {
      console.log(`phase5nD: ${label} up`);
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

// Phase 5p: tolerateNonZero lets an audit run report a FAILED gate without
// throwing into this wrapper's FATAL branch — the per-viewport breakdown below
// is the whole point of the wrapper. Seeding calls keep the default.
function run(cmd, args, shell = false, tolerateNonZero = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => process.stderr.write(`[seed] ${d}`));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 || tolerateNonZero
        ? resolveRun(out)
        : reject(new Error(`${cmd} exited ${code}: ${out}`)));
  });
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

async function registerThroughSignup(tag) {
  const name = `test_5od${tag}${String(Date.now() % 10000).padStart(4, '0')}`;
  const res = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
    body: JSON.stringify({ email: `${name}@test.local`, password: 'audit-password-long', username: name }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const m = /takeover_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  if (!m) throw new Error('register did not set a session cookie');
  const cookie = `takeover_session=${m[1]}`;
  // Mark onboarding COMPLETE before any browsing. A freshly registered user
  // has onboardedAt = null, and the app's onboarding gate correctly bounces
  // them to /welcome — which is exactly what happened on the first two runs of
  // this script: /me answered 200 (the session was fine) and the page still
  // ended up on /welcome. Same call phase5nB makes for its audit user.
  const onboarded = await fetch(`${API}/api/v1/me/onboarded`, {
    method: 'POST',
    headers: { cookie, origin: WEB, 'X-Takeover-Client': 'web', 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!onboarded.ok) throw new Error(`/me/onboarded failed: ${onboarded.status}`);
  const me = await (await fetch(`${API}/api/v1/me`, { headers: { cookie } })).json();
  return { cookie, handle: me.data.user.username, userId: me.data.user.id };
}

/** A published slot with an exact available count. `onSlot` tracks it immediately. */
async function publishSlot(account, { title, total, priceUsdt, onSlot }) {
  await api(account.cookie, 'PATCH', '/api/v1/me/provider-profile', { display_name: 'Audit Provider' });
  const created = await api(account.cookie, 'POST', '/api/v1/slots', {
    title,
    description: 'Audit fixture for the 5n-D quantity selector.',
    starts_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    price_usdt: priceUsdt ?? UNIT_PRICE,
    total_quantity: total,
  });
  if (created.status !== 201) throw new Error(`slot create failed: ${created.status} ${await created.text()}`);
  const slotId = (await created.json()).data.slot.id;
  // Track BEFORE publishing: if publish throws, teardown must still know about
  // this row, or the users FK blocks the whole cleanup (exactly what the first
  // run of this script hit).
  onSlot?.(slotId);
  const published = await api(account.cookie, 'POST', `/api/v1/slots/${slotId}/publish`, {});
  if (!published.ok) throw new Error(`publish failed: ${published.status} ${await published.text()}`);
  return slotId;
}

/**
 * Phase 5g D5 gates claiming behind a wallet, and the only in-product way to
 * attach one is POST /me/link-wallet — which needs a real Nimiq signature the
 * audit has no way to produce. So the fixture sets the address directly.
 *
 * Deliberate and narrow: this is the AUTH fixture, not the product path. The
 * gate itself is covered by link-wallet.test.ts and by the WALLET_REQUIRED
 * branch this same script hits if the address is absent (it did, on the first
 * run — which is why the comment is here rather than a silent fix).
 */
async function attachWalletDirectly(userId) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Fixed, valid-checksum Nimiq address (NQ + 60 base32 chars).
    const wallet = 'NQ90000000000000000000000000000000000000000000000000AB';
    await client.query(
      'UPDATE users SET wallet_address = $2, updated_at = now() WHERE id = $1',
      [userId, wallet],
    );
    return wallet;
  } finally {
    await client.end();
  }
}

/**
 * Full cleanup of every row this script created, in FK order. Reported, not
 * assumed — the 5o-A audit leaked a slot by only logging out.
 */
async function cleanupAll({ provider, buyer, slotIds, claimIds }) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const removed = { escrows: 0, claims: 0, slots: 0, users: 0 };
  try {
    if (claimIds.length > 0) {
      const esc = await client
        .query('DELETE FROM escrows WHERE claim_id = ANY($1::uuid[]) RETURNING id', [claimIds]);
      removed.escrows = esc.rowCount ?? 0;
      await client.query(
        'DELETE FROM payment_intents WHERE claim_id = ANY($1::uuid[])',
        [claimIds],
      );
      await client.query('DELETE FROM notifications WHERE entity_id = ANY($1::text[])', [claimIds]);
      const cl = await client
        .query('DELETE FROM claims WHERE id = ANY($1::uuid[]) RETURNING id', [claimIds]);
      removed.claims = cl.rowCount ?? 0;
    }
    if (slotIds.length > 0) {
      await client.query('DELETE FROM reports WHERE slot_id = ANY($1::uuid[])', [slotIds]);
      await client.query('DELETE FROM notifications WHERE entity_id = ANY($1::text[])', [slotIds]);
      await client.query('DELETE FROM audit_events WHERE entity_id = ANY($1::text[])', [slotIds]);
      const sl = await client
        .query('DELETE FROM slots WHERE id = ANY($1::uuid[]) RETURNING id', [slotIds]);
      removed.slots = sl.rowCount ?? 0;
    }
    const userIds = [provider, buyer].filter(Boolean);
    if (userIds.length > 0) {
      await client.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
      await client.query('DELETE FROM audit_events WHERE actor_user_id = ANY($1::uuid[])', [userIds]);
      await client.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
      await client.query('DELETE FROM provider_profiles WHERE user_id = ANY($1::uuid[])', [userIds]);
      const us = await client
        .query('DELETE FROM users WHERE id = ANY($1::uuid[]) RETURNING id', [userIds]);
      removed.users = us.rowCount ?? 0;
    }
  } finally {
    await client.end();
  }
  return removed;
}

const spawned = [];
let exitCode = 0;
let context = { provider: null, buyer: null, slotIds: [], claimIds: [] };

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

  console.log('phase5nD: creating a provider and a buyer through the real signup endpoint…');
  const provider = await registerThroughSignup('p');
  const buyer = await registerThroughSignup('b');
  context = { provider: provider.userId, buyer: buyer.userId, slotIds: [], claimIds: [] };
  await attachWalletDirectly(buyer.userId);

  // available = 5 -> selector. available = 1 -> no selector.
  const track = (id) => context.slotIds.push(id);
  // Total 8, not 5: the walkthrough claims 3 of them for the claim-detail
// capture, and the SAME slot must still offer room to step up to 3 in the
// selector. With total 5 the claim would leave available = 2, the plus button
// would correctly disable at 2, and the "select 3" capture would be
// impossible — the fixture fighting its own assertion.
const multiSlot = await publishSlot(provider, { title: `Quantity audit ${provider.handle}`, total: 8, onSlot: track });
  const singleSlot = await publishSlot(provider, { title: `Single vacancy audit ${provider.handle}`, total: 1, onSlot: track });
  console.log(`phase5nD: slots ${multiSlot} (available 5) and ${singleSlot} (available 1)`);

  // A claim holding THREE slots, for the claim-detail + claims-list captures.
  const claimRes = await api(buyer.cookie, 'POST', `/api/v1/slots/${multiSlot}/claims`, { quantity: 3 });
  if (claimRes.status !== 200) throw new Error(`claim failed: ${claimRes.status} ${await claimRes.text()}`);
  const claim = (await claimRes.json()).data.claim;
  context.claimIds = [claim.id];
  const availableAfter = (await (await fetch(`${API}/api/v1/slots/${multiSlot}`)).json()).data.slot;
  console.log(`phase5nD: claim ${claim.id} holds ${claim.quantity} slots; available now ${availableAfter.available_quantity}`);

  const TARGETS = [
    // The selector IS expected here.
    ['slot-available5', `/slot/${multiSlot}?desktop=1`, 'default', 'text:How many?', buyer.cookie],
    // NO selector here BY DESIGN — so its ready selector must be something that
    // actually exists. It previously waited on "text:How many?" too, which can
    // never match: the harness swallowed that timeout and reported 12/12 until
    // Phase 5p made an unmeasured gate a failure. The absence of the selector
    // is asserted in the walkthrough below, not by waiting for it here.
    ['slot-available1', `/slot/${singleSlot}?desktop=1`, 'default', 'text:Claim this slot', buyer.cookie],
    ['claim-detail', `/claim/${claim.id}?desktop=1`, 'default', 'text:Claimed', buyer.cookie],
  ];

  const merged = [];
  for (const [key, route, states, ready, cookie] of TARGETS) {
    const sub = join(OUT, key);
    console.log(`phase5nD: auditing ${key} (${route})…`);
    const args = ['scripts/audit/audit.mjs', '--route', route, '--viewports', VIEWPORTS, '--states', states, '--out', sub];
    if (ready) args.push('--ready', ready);
    if (cookie) args.push('--cookie', cookie);
    await run(process.execPath, args, false, true);
    const report = JSON.parse(readFileSync(join(sub, 'report.json'), 'utf8'));
    merged.push(...report.results);
    for (const f of readdirSync(sub)) {
      if (f.endsWith('.png')) renameSync(join(sub, f), join(OUT, `${key}-${f}`));
    }
    rmSync(sub, { recursive: true, force: true });
  }

  console.log('phase5nD: behavioural walkthrough…');
  const browser = await chromium.launch();
  const checks = {};
  try {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await ctx.addInitScript(() => { window.nimiq = {}; });
    // The selector is buyer-only by design (a guest is told to connect a
    // wallet, a provider sees "this is your opening"), so the walkthrough
    // MUST run signed in as the buyer or it proves nothing. First run of this
    // script timed out here for exactly that reason.
    // Set exactly the way scripts/audit/audit.mjs does (explicit domain +
    // path). The `url:` form silently failed to attach — the page redirected
    // to /welcome and the selector never rendered, which cost two runs to
    // diagnose. Same cookie shape as the harness that provably works.
    await ctx.addCookies([
      {
        name: 'takeover_session',
        value: buyer.cookie.replace(/^takeover_session=/, ''),
        domain: new URL(WEB).hostname,
        path: '/',
      },
    ]);
    const page = await ctx.newPage();

    // available = 5: selector present, default 1, CTA unchanged at one unit.
    await page.goto(`${WEB}/slot/${multiSlot}?desktop=1`, { waitUntil: 'networkidle' });
    try {
      await page.waitForSelector('text=How many?', { timeout: 15_000 });
    } catch {
      // Diagnostics beat a bare timeout: a failed audit that does not say what
      // the page actually rendered cannot be acted on.
      console.log('phase5nD: DIAGNOSTIC body text:', (await page.textContent('body'))?.slice(0, 600));
      console.log('phase5nD: DIAGNOSTIC url:', page.url());
      await page.screenshot({ path: join(OUT, 'diagnostic-no-selector.png'), fullPage: true });
      throw new Error('quantity selector never appeared on the multi-vacancy slot detail');
    }
    checks.selectorOnMulti = true;
    checks.stepperOnMulti = await page.locator('button[aria-label="One more slot"]').count();
    checks.ctaAtOne = (await page.locator('button', { hasText: 'Claim this slot' }).count()) > 0;

    // Touch gate at EVERY viewport: a stepper is a tap target, so 44px is not
    // optional here the way it is for a decorative control.
    const touchByViewport = {};
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : width === 1280 ? 800 : 900 });
      await sleep(500);
      const boxes = await page.evaluate(() => {
        const els = [...document.querySelectorAll('button[aria-label="One more slot"], button[aria-label="One fewer slot"]')];
        return els.map((el) => {
          const r = el.getBoundingClientRect();
          return { label: el.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height) };
        });
      });
      touchByViewport[width] = boxes;
    }
    checks.stepperTouchByViewport = touchByViewport;
    checks.stepperTouchOk = Object.values(touchByViewport).every(
      (boxes) => boxes.length > 0 && boxes.every((b) => b.w >= 44 && b.h >= 44),
    );

    // quantity 3: live total and the CTA naming the amount.
    await page.setViewportSize({ width: 375, height: 812 });
    await sleep(400);
    for (let i = 0; i < 2; i += 1) {
      const plus = page.locator('button[aria-label="One more slot"]');
      // Assert the control is actually live before tapping it: a disabled
      // button waits 30s for a click that can never land, which reads as a
      // mysterious timeout rather than "the fixture ran out of availability".
      if (await plus.isDisabled()) throw new Error(`stepper plus disabled at step ${i + 1}`);
      await plus.click();
      await sleep(250);
    }
    const stepper = page.locator('section[aria-labelledby="quantity-stepper-label"]');
    checks.totalAtThree = ((await stepper.textContent()) ?? '').includes('4.5');
    checks.ctaAtThree = (await page.locator('button', { hasText: 'Claim 3 slots' }).count()) > 0;
    await page.screenshot({ path: join(OUT, 'walk-375-quantity3.png'), fullPage: true });

    // available = 1: no selector at all, and the CTA is the original copy.
    await page.goto(`${WEB}/slot/${singleSlot}?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(900);
    checks.noSelectorOnSingle = (await page.locator('text=How many?').count()) === 0;
    checks.stepperOnSingle = await page.locator('button[aria-label="One more slot"]').count();
    checks.ctaSingleUnchanged =
      (await page.locator('button', { hasText: 'Claim this slot' }).count()) > 0;
    await page.screenshot({ path: join(OUT, 'walk-375-available1.png'), fullPage: true });

    // Claim detail: states the count; claims list: states it above one unit.
    await page.goto(`${WEB}/claim/${claim.id}?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(900);
    checks.claimDetailStatesCount =
      ((await page.locator('article').textContent()) ?? '').includes('3 slots claimed');
    await page.screenshot({ path: join(OUT, 'walk-375-claim-detail.png'), fullPage: true });

    await page.goto(`${WEB}/claims?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(1200);
    checks.claimsListStatesCount = ((await page.textContent('body')) ?? '').includes('3 slots');
    await page.screenshot({ path: join(OUT, 'walk-375-claims-list.png'), fullPage: true });

    await ctx.close();
  } finally {
    await browser.close();
  }

  writeFileSync(join(OUT, 'walkthrough.json'), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  console.log('phase5nD: walkthrough checks:', JSON.stringify(checks, null, 1));

  const failed = merged.filter((r) => !r.pass);
  console.log(`phase5nD: gates ${merged.length - failed.length}/${merged.length} pass.`);
  for (const f of failed) {
    // Phase 5p: name the READY TIMEOUT as its own cause. Reporting it as
    // "contrast=0 touch=0 overflow=false" is not just incomplete — it points at
    // three gates that passed, on a viewport that was never actually measured,
    // which is how this phase's first run looked green while broken.
    if (f.readyTimedOut) {
      console.log(
        `  FAIL ${f.viewport} [${f.state}]: NOT MEASURED — ready timeout: ` +
          `"${f.readySelector ?? ''}" not found within 30000ms`,
      );
      continue;
    }
    console.log(`  FAIL ${f.viewport}: contrast=${f.contrastFailures.length} touch=${f.touchFailures.length} overflow=${f.overflow.overflow}`);
    for (const c of f.contrastFailures) console.log(`    contrast ${c.ratio} ${c.fg} on ${c.bg} (${c.fontSize}) "${c.text}"`);
    for (const t of f.touchFailures) console.log(`    touch ${t.tag} ${t.w}x${t.h} "${t.label}"`);
  }

  // Behavioural assertions are gates, not console decoration — the lesson of
  // the 5n-B false green.
  const walkFails = [
    ['selectorOnMulti', checks.selectorOnMulti],
    ['stepperOnMulti', checks.stepperOnMulti === 1],
    ['ctaAtOne', checks.ctaAtOne],
    ['stepperTouchOk', checks.stepperTouchOk],
    ['totalAtThree', checks.totalAtThree],
    ['ctaAtThree', checks.ctaAtThree],
    ['noSelectorOnSingle', checks.noSelectorOnSingle],
    ['stepperOnSingle', checks.stepperOnSingle === 0],
    ['ctaSingleUnchanged', checks.ctaSingleUnchanged],
    ['claimDetailStatesCount', checks.claimDetailStatesCount],
    ['claimsListStatesCount', checks.claimsListStatesCount],
  ].filter(([, ok]) => ok !== true);
  for (const [name] of walkFails) console.log(`  FAIL walkthrough: ${name}`);

  writeFileSync(
    join(OUT, 'report.json'),
    JSON.stringify({ at: new Date().toISOString(), results: merged, checks }, null, 2),
  );
  exitCode = failed.length > 0 || walkFails.length > 0 ? 1 : 0;
} catch (err) {
  console.error(`phase5nD: FATAL: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  if (context.provider || context.buyer) {
    try {
      const removed = await cleanupAll(context);
      console.log(`phase5nD: fixtures removed ${JSON.stringify(removed)}`);
    } catch (err) {
      console.error(`phase5nD: WARNING fixtures NOT removed: ${err.message}`);
    }
  }
  for (const child of spawned.reverse()) await killTree(child);
}
process.exit(exitCode);