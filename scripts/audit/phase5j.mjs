// Phase 5j browser audit: onboarding flow (welcome → account → profile
// setup → interests → first action) + login.
//
// Boots API + web (reusing already-running servers), registers a FRESH
// email user via the live API (onboarded_at NULL — exercises the real
// funnel), and captures:
//
//   /welcome?desktop=1              default state (guest)
//   /onboarding/account?desktop=1   default state (guest)
//   /onboarding/profile?desktop=1   default state (fresh-user cookie)
//   /onboarding/interests?desktop=1 default state (fresh-user cookie)
//   /login?desktop=1                default state (guest)
//   /sell/new?desktop=1             default state (fresh-user cookie;
//                                   the welcome banner is sessionStorage-
//                                   armed, which audit.mjs cannot set —
//                                   the banner is covered by jsdom tests)
//
// Interaction states (email tab open, validation error, filled profile,
// selected interests, the product tour, login error) cannot be scripted by
// audit.mjs, so a small Playwright walkthrough captures them as screenshots
// at 375px: welcome → account (email tab) → account (validation error) →
// profile (filled) → interests (selected) → tour (stop 1, last stop,
// finished) → login (error). Gate measurements (contrast/touch/overflow)
// run on the default states; the walkthrough is visual evidence of the flow.
//
// Reports merge into docs/redesign/audits/phase-5j/report.json;
// screenshots are prefixed per target (<target>-<w>x<h>-<state>.png).
// The audit session is logged out afterwards; spawned servers are torn
// down. The audit user (test_5jXXXXX@test.local) matches the cleanup
// signature and is removed by the phase-end cleanup step.
//
// Usage:
//   DATABASE_URL=... node scripts/audit/phase5j.mjs   (DATABASE_URL is only
//   needed if the API dev server must be spawned; a running server is reused)
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

// Browser-context globals used inside addInitScript callbacks — those
// run in Chromium, not Node.
/* global window */

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const OUT = resolve('docs/redesign/audits/phase-5j');
const API = 'http://localhost:3001';
const WEB = 'http://localhost:5173';

function urlOk(url) {
  return fetch(url, { method: 'GET' })
    .then((r) => r.ok)
    .catch(() => false);
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) {
      console.log(`phase5j: ${label} up (${url})`);
      return true;
    }
    await sleep(2000);
  }
  return false;
}

function launch(label, cmd, args, useShell) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell ?? process.platform === 'win32',
    env: { ...process.env },
  });
  child.stdout.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
  return child;
}

function killTree(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/F', '/T', '/PID', String(child.pid)], () => resolve());
    } else {
      child.kill('SIGKILL');
      resolve();
    }
  });
}

// Phase 5p: tolerateNonZero lets an audit run report a FAILED gate without
// throwing into this wrapper's FATAL branch — the per-viewport breakdown below
// is the whole point of the wrapper. Seeding calls keep the default.
function run(cmd, args, shell = false, tolerateNonZero = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => process.stderr.write(`[seed] ${d}`));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 || tolerateNonZero
        ? resolve(out)
        : reject(new Error(`${cmd} exited ${code}: ${out}`)));
  });
}

const VIEWPORTS = '320,375,768,1280';

const spawned = [];
let exitCode = 0;
try {
  if (!(await urlOk(`${API}/health`))) {
    console.log('phase5j: starting API dev server…');
    spawned.push(launch('api', NPM, ['run', 'dev', '--workspace', 'takeover-api']));
    if (!(await waitFor(`${API}/health`, 'api'))) {
      throw new Error('API dev server never became healthy');
    }
  } else {
    console.log('phase5j: reusing already-running API (will not kill it)');
  }

  // Fresh email account straight through the live register endpoint
  // (exercises the real funnel; the user is NOT onboarded).
  console.log('phase5j: registering fresh audit user…');
  // Run-unique audit identities (a past aborted pass may have left its user
  // onboarded, which would trip the guard on profile/interests captures).
  // Every run's users match the cleanup signature (@test.local/test_).
  // Two users: FRESH (profile/interests captures + walkthrough) and
  // ONBOARDED (first-action capture — the guard bounces fresh accounts
  // on /sell/new to /welcome by design).
  async function registerAuditUser(suffix) {
    const tag = `test_5j${suffix}${String(Date.now() % 100000).padStart(5, '0')}`;
    const res = await fetch(`${API}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
      body: JSON.stringify({ email: `${tag}@test.local`, password: 'audit-password-long', username: tag }),
    });
    if (!res.ok) {
      throw new Error(`session mint failed: ${res.status}`);
    }
    const setCookie = res.headers.get('set-cookie') ?? '';
    const match = /takeover_session=([^;]+)/.exec(setCookie);
    if (!match) {
      throw new Error('register did not set a session cookie');
    }
    return `takeover_session=${match[1]}`;
  }
  const freshCookie = await registerAuditUser('f');
  console.log('phase5j: fresh audit user registered (not onboarded)');
  const onboardedCookie = await registerAuditUser('o');
  await fetch(`${API}/api/v1/me/onboarded`, {
    method: 'POST',
    headers: {
      cookie: onboardedCookie,
      origin: 'http://localhost:5173',
      'X-Takeover-Client': 'web',
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  console.log('phase5j: onboarded audit user ready');
  const auditCookie = freshCookie;

  if (!(await urlOk(`${WEB}/`))) {
    console.log('phase5j: starting web dev server…');
    spawned.push(launch('web', NPM, ['run', 'dev', '--workspace', 'takeover-web']));
    if (!(await waitFor(`${WEB}/`, 'web'))) {
      throw new Error('web dev server never became healthy');
    }
  } else {
    console.log('phase5j: reusing already-running web server (will not kill it)');
  }

  const TARGETS = [
    // [key, route, states, ready, cookie ('fresh', 'onboarded', or null)]
    ['welcome', '/welcome?desktop=1', 'default', 'text:Get started', null],
    ['account', '/onboarding/account?desktop=1', 'default', 'text:Continue with wallet', null],
    ['profile', '/onboarding/profile?desktop=1', 'default', 'text:Full name', 'fresh'],
    ['interests', '/onboarding/interests?desktop=1', 'default', 'text:What are you looking for?', 'fresh'],
    ['login', '/login?desktop=1', 'default', 'text:Sign in', null],
    ['first-action', '/sell/new?desktop=1', 'default', 'text:New opening', 'onboarded'],
  ];

  const merged = [];
  for (const [key, route, states, ready, which] of TARGETS) {
    const sub = join(OUT, key);
    console.log(`phase5j: auditing ${key} (${route})…`);
    const args = [
      'scripts/audit/audit.mjs',
      '--route', route,
      '--viewports', VIEWPORTS,
      '--states', states,
      '--out', sub,
    ];
    if (ready) args.push('--ready', ready);
    if (which === 'fresh') args.push('--cookie', freshCookie);
    if (which === 'onboarded') args.push('--cookie', onboardedCookie);
    await run(process.execPath, args, false, true);
    const report = JSON.parse(readFileSync(join(sub, 'report.json'), 'utf8'));
    merged.push(...report.results);
    for (const f of readdirSync(sub)) {
      if (f.endsWith('.png')) renameSync(join(sub, f), join(OUT, `${key}-${f}`));
    }
    rmSync(sub, { recursive: true, force: true });
  }

  // Interaction walkthrough at 375px (screenshots only — gates measured
  // above on default states). The ?desktop=1 bypass does not survive SPA
  // link navigation, so the walkthrough stubs window.nimiq instead: the
  // gate sees a provider and stays out of the way while every link click
  // exercises the real flow. (Wallet buttons are never clicked — the stub
  // is presence-only, not a signing provider.)
  console.log('phase5j: interaction walkthrough at 375px…');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await ctx.addInitScript(() => {
      window.nimiq = {};
    });
    const page = await ctx.newPage();
    const shot = (name) => page.screenshot({ path: join(OUT, `walk-${name}.png`) });
    await page.goto(`${WEB}/welcome`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Good openings go fast.' }).waitFor();
    await shot('375-01-welcome');
    await page.getByRole('link', { name: 'Get started' }).click();
    await page.getByRole('button', { name: 'Continue with wallet' }).waitFor();
    await page.getByRole('tab', { name: 'Email' }).click();
    await page.locator('#account-email').waitFor();
    await shot('375-02-account-email-open');
    await page.locator('#account-email').fill('not-an-email');
    await page.locator('#account-password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByText('Enter a valid email address.').waitFor();
    await shot('375-03-account-validation-error');
    // Fresh-user profile (seed the session cookie first).
    await ctx.addCookies([
      { name: 'takeover_session', value: auditCookie.split('=')[1], domain: 'localhost', path: '/' },
    ]);
    await page.goto(`${WEB}/onboarding/profile`, { waitUntil: 'networkidle' });
    await page.locator('#profile-name').fill('Audit Walker');
    await page.locator('#profile-bio').fill('Walking through the new flow.');
    await shot('375-04-profile-filled');
    await page.goto(`${WEB}/onboarding/interests`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Event' }).click();
    await page.getByRole('button', { name: 'Salon / service' }).click();
    await shot('375-05-interests-selected');
    // Product tour (5j-2): only an onboarded user with tourCompletedAt NULL
    // sees it, so swap in the onboarded session. 600ms trigger delay + feed
    // load → wait for the dialog instead of a fixed sleep.
    await ctx.addCookies([
      { name: 'takeover_session', value: onboardedCookie.split('=')[1], domain: 'localhost', path: '/' },
    ]);
    await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
    await page.getByTestId('product-tour').waitFor({ timeout: 10_000 });
    await shot('375-06-tour-stop-1');
    // Stop count varies: resolveTourStops skips targets absent at mount
    // (e.g. no cards in an empty feed), so advance until Finish shows.
    for (let i = 0; i < 6; i++) {
      try {
        await page.getByRole('button', { name: 'Finish' }).waitFor({ timeout: 1000 });
        break;
      } catch {
        await page.getByRole('button', { name: 'Next' }).click({ timeout: 5000 });
      }
    }
    await shot('375-07-tour-last-stop');
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByTestId('product-tour').waitFor({ state: 'detached', timeout: 10_000 });
    await shot('375-08-tour-finished');
    await ctx.close();
    // Login error as a guest (real 401 from the live API): a separate
    // cookieless context, since the audit session would redirect /login
    // into onboarding.
    const guestCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await guestCtx.addInitScript(() => {
      window.nimiq = {};
    });
    const guest = await guestCtx.newPage();
    await guest.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await guest.locator('#login-email').fill('nobody@test.local');
    await guest.locator('#login-password').fill('wrong-password-long');
    await guest.getByRole('button', { name: 'Sign in', exact: true }).click();
    await guest.getByText('Invalid email or password.').waitFor();
    await guest.screenshot({ path: join(OUT, 'walk-375-09-login-error.png') });
    await guestCtx.close();
  } finally {
    await browser.close();
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'report.json'),
    JSON.stringify({ at: new Date().toISOString(), results: merged }, null, 2),
  );
  const failed = merged.filter((r) => !r.pass).length;
  console.log(`phase5j: done. ${merged.length - failed}/${merged.length} pass. Report: ${join(OUT, 'report.json')}`);

  console.log('phase5j: logging out audit sessions…');
  // Cookie-bearing server-side POSTs must pass the CSRF guard: send the
  // allowlisted dev Origin plus the client header (browser-driven steps
  // carry these automatically).
  for (const cookie of [freshCookie, onboardedCookie]) {
    const csrfHeaders = {
      cookie,
      origin: 'http://localhost:5173',
      'X-Takeover-Client': 'web',
      'content-type': 'application/json',
    };
    await fetch(`${API}/api/v1/auth/logout`, {
      method: 'POST',
      headers: csrfHeaders,
      body: JSON.stringify({}),
    });
  }
} catch (err) {
  console.error(`phase5j: FATAL: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  for (const child of spawned.reverse()) {
    await killTree(child);
  }
  console.log('phase5j: teardown complete (audit user retained for the phase-end cleanup)');
}
process.exit(exitCode);
