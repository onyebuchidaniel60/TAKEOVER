// Phase 5n-C audit: NIM listing-fee confirmation auto-retry (D24).
//
// D24 replaced the old normal-path affordances — a "Retry publish" button
// and a "Payment failed. Please try again." line — with a background poll
// that re-publishes the SAME fee hash until it confirms. The audit proves
// that in the real app, not just in unit tests:
//
//   1. Route gates (contrast / overflow / touch) on the sell draft, the
//      sell list, a claim detail (copy change), and the feed.
//   2. A walkthrough that seeds a fee hash into sessionStorage and loads
//      /sell/<draft>. It asserts, with NO user interaction at all:
//        - the old "Retry publish" button is gone,
//        - the old "Please try again." line is gone,
//        - a progress surface is announced with role="status",
//        - the browser issued repeated POSTs to the publish endpoint on
//          its own, proving the loop re-posts without a click.
//
// Usage:
//   DATABASE_URL=... node scripts/audit/phase5nC.mjs
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const OUT = resolve('docs/redesign/audits/phase-5n-C');
const API = 'http://localhost:3001';
const WEB = 'http://localhost:5173';
const STUB_PORT = '8546';
const VIEWPORTS = '320,375,768,1280';
const CHAIN_ENV = {
  POLYGON_RPC_URL: `http://127.0.0.1:${STUB_PORT}`,
  USDT_ESCROW_CONTRACT_ADDRESS: '0x000000000000000000000000000000000000dead',
  USDT_TOKEN_ADDRESS: '0x000000000000000000000000000000000000beef',
};

// The seeded draft owned by the audit buyer: /sell/:id + the publish flow.
const DRAFT_SLOT = '44444444-4444-4422-8422-000000000009';
// A funded claim, to capture the "Still confirming" handover copy.
const CLAIM_SLOT = '44444444-4444-4422-8422-000000000002';
// A hash the server will reject as an unverifiable fee payment: the loop
// keeps re-posting it, which is exactly the D24 behaviour under audit.
/* global window */
const FEE_HASH =
  'ac2f80450d454af19efec4e5d405d964d0d0690fded17e588f033d74998317d0';

function urlOk(url) {
  return fetch(url, { method: 'GET' }).then((r) => r.ok).catch(() => false);
}

// The poll runs on a 5s cadence, so any assertion about "it kept going" has
// to wait for the cadence rather than sleep a guessed interval. Fixed sleeps
// made this audit flaky: sometimes the 2nd attempt had landed, sometimes not.
async function waitUntil(predicate, label, budgetMs = 25_000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(500);
  }
  console.log(`phase5nC: timed out waiting for ${label}`);
  return false;
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) {
      console.log(`phase5nC: ${label} up`);
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

// A viewport only counts as measured when audit.mjs actually produced the
// three measurements. A timed-out navigation yields a result object with
// none of them, and treating that as a pass would be a false green.
function measured(r) {
  return (
    r &&
    typeof r.viewport === 'string' &&
    r.overflow &&
    typeof r.overflow.overflow === 'boolean' &&
    Array.isArray(r.contrastFailures) &&
    Array.isArray(r.touchFailures)
  );
}

const spawned = [];
const merged = [];
const checks = {};
let exitCode = 0;
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

  console.log('phase5nC: seeding fixtures...');
  const seedOut = await run(NPX, ['tsx', 'scripts/audit/seed-phase5.ts', '--mint-session'], true);
  const buyer = JSON.parse(seedOut.slice(seedOut.indexOf('{')));
  const BUYER_COOKIE = `${buyer.cookie.name}=${buyer.cookie.value}`;
  console.log(`phase5nC: draft owner session ready for slot ${DRAFT_SLOT}`);

  // The seeded buyer is not onboarded, and the app bounces non-onboarded
  // sessions to /welcome — which would silently audit the wrong page.
  const onboarded = await fetch(`${API}/api/v1/me/onboarded`, {
    method: 'POST',
    headers: {
      cookie: BUYER_COOKIE,
      origin: WEB,
      'X-Takeover-Client': 'web',
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!onboarded.ok) throw new Error(`could not onboard the audit buyer: ${onboarded.status}`);

  // The seeded draft is created with onConflictDoNothing, so once an audit
  // run publishes it the fixture is spent. Create a fresh draft per run
  // through the real API instead, which also keeps the audit repeatable.
  const startsAt = new Date(Date.now() + 3 * 86400000);
  const endsAt = new Date(Date.now() + 3 * 86400000 + 7200000);
  const created = await fetch(`${API}/api/v1/slots`, {
    method: 'POST',
    headers: {
      cookie: BUYER_COOKIE,
      origin: WEB,
      'X-Takeover-Client': 'web',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Audit fee draft',
      description: 'Phase 5n-C fee auto-retry fixture.',
      category: 'Event',
      location_label: 'Mitte',
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      price_usdt: '1000000',
      total_quantity: 2,
    }),
  });
  const createdBody = await created.json().catch(() => null);
  const draftId = createdBody?.data?.slot?.id;
  if (!draftId) throw new Error(`could not create an audit draft: ${created.status} ${JSON.stringify(createdBody)}`);
  console.log(`phase5nC: fresh audit draft ${draftId}`);

  if (!(await urlOk(`${WEB}/`))) {
    spawned.push(launch('web', NPM, ['run', 'dev', '--workspace', 'takeover-web']));
    if (!(await waitFor(`${WEB}/`, 'web'))) throw new Error('web never healthy');
  }

  const TARGETS = [
    // The sell draft is where the fee banner lives: progress, handover, and
    // the hard-failure "Pay again" surface all render here.
    ['sell-draft', `/sell/${draftId}?desktop=1`, 'default', 'text:Title', BUYER_COOKIE],
    ['sell-list', '/sell?desktop=1', 'default', 'a[href^="/sell/"]', BUYER_COOKIE],
    // Copy change: "Still confirming" handover on the claim detail.
    ['claim-handover', `/slot/${CLAIM_SLOT}?desktop=1`, 'default', 'text:Opening', BUYER_COOKIE],
    ['home', '/?desktop=1', 'default', 'a[href^="/slot/"]', null],
  ];

  for (const [key, route, states, ready, cookie] of TARGETS) {
    const sub = join(OUT, key);
    console.log(`phase5nC: auditing ${key} (${route})...`);
    const args = ['scripts/audit/audit.mjs', '--route', route, '--viewports', VIEWPORTS, '--states', states, '--out', sub];
    if (ready) args.push('--ready', ready);
    if (cookie) args.push('--cookie', cookie);

    // A dev-server cold start can time out one viewport, and audit.mjs
    // records that as a result with no measurements. Such a result must
    // never be read as "passed" — retry the target once, then let the
    // strict gate below decide.
    let results = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await run(process.execPath, args);
      } catch (err) {
        console.log(`phase5nC: ${key} run ${attempt} threw: ${err.message}`);
      }
      if (!existsSync(join(sub, 'report.json'))) {
        if (attempt < 2) await sleep(3000);
        continue;
      }
      results = JSON.parse(readFileSync(join(sub, 'report.json'), 'utf8')).results;
      if (results.length && results.every(measured)) break;
      console.log(`phase5nC: ${key} run ${attempt} left viewports unmeasured; retrying once.`);
      if (attempt < 2) await sleep(3000);
    }
    merged.push(...results);
    for (const f of readdirSync(sub)) {
      if (f.endsWith('.png')) renameSync(join(sub, f), join(OUT, `${key}-${f}`));
    }
    rmSync(sub, { recursive: true, force: true });
  }

  // D24 walkthrough at 375px: with a fee hash already in sessionStorage the
  // poll loop must re-arm on load and re-publish the SAME hash on its own.
  console.log('phase5nC: D24 auto-retry walkthrough at 375px...');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await ctx.addInitScript(() => { window.nimiq = {}; });
    await ctx.addCookies([{
      name: buyer.cookie.name,
      value: buyer.cookie.value,
      domain: 'localhost',
      path: '/',
    }]);
    const page = await ctx.newPage();

    // Count publish POSTs the app makes on its own.
    const publishCalls = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/api\/v1\/slots\/[^/]+\/publish/.test(req.url())) {
        publishCalls.push(req.postData());
      }
    });

    // Hold the fee in "not yet confirmed" for the whole walkthrough. The
    // pending state is otherwise decided by chain state and env, which would
    // make this audit non-deterministic; stubbing it puts the CLIENT loop
    // itself under test, which is what D24 actually changed.
    await page.route(/\/api\/v1\/slots\/[^/]+\/publish/, async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'PAYMENT_NOT_CONFIRMED',
            message: 'Fee payment needs 2 confirmations (0 so far).',
            meta: { confirmations: 0, required: 2 },
          },
        }),
      });
    });

    // Seed the hash BEFORE app code runs, so the page loads already armed.
    await ctx.addInitScript(([key, hash]) => {
      try { window.sessionStorage.setItem(key, hash); } catch { /* private mode */ }
    }, [`takeover.feeHash.${draftId}`, FEE_HASH]);

    await page.goto(`${WEB}/sell/${draftId}?desktop=1`, { waitUntil: 'networkidle' });
    // The loop's first attempt is immediate; the second rides the 5s
    // cadence. Wait for the retry rather than guessing how long that is.
    await waitUntil(() => publishCalls.length >= 2, 'a second automatic publish');
    await page.screenshot({ path: join(OUT, 'walk-375-01-fee-progress.png') });

    const body = (await page.textContent('body')) ?? '';
    // The affordances D24 removed must be absent.
    checks.retryPublishButtonGone = await page.getByRole('button', { name: 'Retry publish' }).count();
    checks.newPaymentHatchGone = await page.getByRole('button', { name: 'Use a new payment instead' }).count();
    checks.tryAgainCopyGone = /Please try again/i.test(body) || /Retry with the same transaction/i.test(body);
    // A progress surface is announced politely, not as an error.
    checks.statusRegion = await page.getByRole('status').count();
    // And the loop really re-posts, repeatedly, with no click.
    checks.publishCalls = publishCalls.length;
    checks.sameHashEveryTime = publishCalls.every((b) => (b ?? '').includes(FEE_HASH));

    // Confirm the cadence keeps it going rather than stopping after one retry.
    const before = publishCalls.length;
    checks.polledAgainAfterPause = await waitUntil(
      () => publishCalls.length > before,
      'a third automatic publish',
    );
    await page.screenshot({ path: join(OUT, 'walk-375-02-fee-progress-later.png') });
    checks.publishCallsAfterPause = publishCalls.length;

    console.log('phase5nC: walkthrough checks:', JSON.stringify(checks, null, 1));
    if (checks.retryPublishButtonGone || checks.newPaymentHatchGone || checks.tryAgainCopyGone) {
      throw new Error(`D24 regression: a retired affordance is still on screen: ${JSON.stringify(checks)}`);
    }
    if (checks.statusRegion < 1) throw new Error('D24 regression: no polite progress surface while the fee confirms');
    if (checks.publishCalls < 2) throw new Error(`D24 regression: only ${checks.publishCalls} publish call(s); the loop did not auto-retry`);
    if (!checks.sameHashEveryTime) throw new Error('D24 regression: the loop re-published a different hash');
    if (!checks.polledAgainAfterPause) throw new Error('D24 regression: the loop stalled instead of continuing on cadence');
  } finally {
    await browser.close();
  }
} catch (err) {
  console.error('phase5nC: FAILED', err);
  exitCode = 1;
} finally {
  await Promise.all(spawned.map(killTree));
}

if (exitCode === 0) {
  const failed = merged.filter((r) => r.failed || !measured(r));
  writeFileSync(join(OUT, 'walkthrough.json'), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  console.log('phase5nC: walkthrough checks:', JSON.stringify(checks, null, 1));
  console.log(`phase5nC: gates ${merged.length - failed.length}/${merged.length} pass.`);
  for (const f of failed) {
    if (!measured(f)) {
      console.log(`  FAIL ${f?.viewport ?? 'unknown'}: viewport was never measured (navigation failed) — not a pass.`);
      continue;
    }
    console.log(`  FAIL ${f.viewport}: contrast=${f.contrastFailures.length} touch=${f.touchFailures.length} overflow=${f.overflow.overflow}`);
    for (const c of f.contrastFailures) console.log(`    contrast ${c.ratio} ${c.fg} on ${c.bg} (${c.fontSize}) "${c.text}"`);
    for (const t of f.touchFailures) console.log(`    touch ${t.tag} ${t.w}x${t.h} "${t.label}"`);
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results: merged }, null, 2));
  if (failed.length) exitCode = 1;
}
process.exit(exitCode);
