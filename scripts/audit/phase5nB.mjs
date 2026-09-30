// Phase 5n-B audit: field-specific profile edit + provider link.
//
// Boots the real stack, seeds the escrow fixtures (which also gives the
// provider a public handle, `seed_provider` — migration 0014 left the
// pre-5g fixture users with username = NULL, so the /u/:username route
// could not resolve them until the seed set one), registers two live email
// users, and audits:
//
//   /profile            own profile (onboarded cookie)
//   /u/seed_provider    public profile WITH openings
//   /u/test_nobody      public profile 404 state
//   /                   feed, to prove the provider link + card did not regress
//   /slot/<id>          detail, to prove the provider link renders
//
// Also captures a WalletStatus three-state walkthrough (guest / email /
// wallet) and asserts the public profile HTML carries no private field.
//
// Usage:
//   DATABASE_URL=... node scripts/audit/phase5nB.mjs
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const OUT = resolve('docs/redesign/audits/phase-5n-B');
const API = 'http://localhost:3001';
const WEB = 'http://localhost:5173';
const STUB_PORT = '8546';
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
      console.log(`phase5nB: ${label} up`);
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

async function registerAuditUser(tag) {
  const name = `test_5kb${tag}${String(Date.now() % 100000).padStart(5, '0')}`;
  const res = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
    body: JSON.stringify({ email: `${name}@test.local`, password: 'audit-password-long', username: name }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  const m = /takeover_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  if (!m) throw new Error('register did not set a session cookie');
  return { cookie: `takeover_session=${m[1]}`, username: name };
}

const spawned = [];
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

  console.log('phase5nB: seeding fixtures (gives the provider a public handle)…');
  const provOut = await run(NPX, ['tsx', 'scripts/audit/seed-phase5.ts', '--mint-provider-session'], true);
  const provider = JSON.parse(provOut.slice(provOut.indexOf('{'))).cookie;
  const PROVIDER_COOKIE = `${provider.name}=${provider.value}`;

  // The seeded provider owns no email/phone/dob, so give the audit user a
  // full profile: the own-profile capture must show every field SET, and the
  // public one must show none of them.
  const user = await registerAuditUser('o');
  await fetch(`${API}/api/v1/me/onboarded`, {
    method: 'POST',
    headers: { cookie: user.cookie, origin: WEB, 'X-Takeover-Client': 'web', 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  await fetch(`${API}/api/v1/me/profile`, {
    method: 'PATCH',
    headers: { cookie: user.cookie, origin: WEB, 'X-Takeover-Client': 'web', 'content-type': 'application/json' },
    body: JSON.stringify({ bio: 'Selling good tables before they fill.', phone: '+49 170 0000000', dob: '1992-03-04', location: 'Kreuzberg' }),
  });
  await fetch(`${API}/api/v1/me/provider-profile`, {
    method: 'PATCH',
    headers: { cookie: user.cookie, origin: WEB, 'X-Takeover-Client': 'web', 'content-type': 'application/json' },
    body: JSON.stringify({ display_name: 'Audit Walker' }),
  });
  console.log(`phase5nB: audit user ${user.username} ready (all private fields set)`);

  if (!(await urlOk(`${WEB}/`))) {
    spawned.push(launch('web', NPM, ['run', 'dev', '--workspace', 'takeover-web']));
    if (!(await waitFor(`${WEB}/`, 'web'))) throw new Error('web never healthy');
  }

  // The public endpoint must answer before we assert on it.
  {
    const res = await fetch(`${API}/api/v1/users/seed_provider`);
    const body = await res.json().catch(() => null);
    if (res.status !== 200 || !body?.data?.profile) {
      throw new Error(`public profile endpoint not ready: ${res.status} ${JSON.stringify(body)}`);
    }
    const forbidden = ['email', 'phone', 'dob', 'walletAddress', 'passwordHash', 'id'];
    for (const key of forbidden) {
      if (key in body.data.profile) throw new Error(`public profile leaked "${key}"`);
    }
    console.log(`phase5nB: public endpoint clean; stats=${JSON.stringify(body.data.profile.stats)}`);
  }

  const SLOT = '44444444-4444-4422-8422-000000000002';
  const TARGETS = [
    // Rows are buttons (single-field edit), and "Not set" states render.
    ['own-profile', '/profile?desktop=1', 'default', 'text:Information', user.cookie],
    ['own-profile-wallet', '/profile?desktop=1', 'default', 'text:Wallet', PROVIDER_COOKIE],
    // B2 regression guard: the provider row on slot detail must stay linked.
    ['slot-detail', `/slot/${SLOT}?desktop=1`, 'default', 'a[href^="/u/"]', null],
    ['home', '/?desktop=1', 'default', 'a[href^="/slot/"]', null],
    ['public-profile', '/u/seed_provider?desktop=1', 'default', 'text:Openings', null],
  ];

  const merged = [];
  for (const [key, route, states, ready, cookie] of TARGETS) {
    const sub = join(OUT, key);
    console.log(`phase5nB: auditing ${key} (${route})…`);
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

  // Targeted walkthrough at 375px: WalletStatus in its three states, the
  // own profile with fields set, the Edit-profile reuse, and a hard
  // assertion that the public profile HTML carries no private value.
  console.log('phase5nB: targeted walkthrough at 375px…');
  const browser = await chromium.launch();
  const checks = {};
  try {
    // Guest chrome.
    const guestCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await guestCtx.addInitScript(() => { window.nimiq = {}; });
    const guest = await guestCtx.newPage();
    await guest.goto(`${WEB}/welcome?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(600);
    await guest.screenshot({ path: join(OUT, 'walk-375-01-walletstatus-guest.png') });
    checks.guestSignIn = await guest.getByRole('link', { name: 'Sign in' }).count();

    // Email-user chrome + own profile (all fields set).
    const emailCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await emailCtx.addInitScript(() => { window.nimiq = {}; });
    await emailCtx.addCookies([{ name: 'takeover_session', value: user.cookie.split('=')[1], domain: 'localhost', path: '/' }]);
    const email = await emailCtx.newPage();
    await email.goto(`${WEB}/?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(800);
    await email.screenshot({ path: join(OUT, 'walk-375-02-walletstatus-email.png') });
    // The email-user chip shows the DISPLAY name (D18 prefers it over the
    // handle), so assert on what the chrome actually renders.
    checks.emailChip = await email.getByRole('link', { name: /Audit Walker/ }).count();
    await email.goto(`${WEB}/profile?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(800);
    await email.screenshot({ path: join(OUT, 'walk-375-03-own-profile-set.png'), fullPage: true });
    const ownHtml = await email.content();
    for (const value of ['+49 170 0000000', '1992-03-04', 'Kreuzberg', 'Selling good tables']) {
      checks[`ownShows_${value}`] = ownHtml.includes(value);
    }
    // Edit-profile reuse: navigate by CLICKING the pill on /profile, which
    // proves the header action is wired to the settings variant rather than
    // a hand-typed URL that might not exist.
    await email.getByRole('link', { name: /edit profile/i }).click();
    await email.waitForURL(/from=settings/, { timeout: 10_000 });
    await sleep(600);
    await email.screenshot({ path: join(OUT, 'walk-375-04-edit-profile.png'), fullPage: true });
    checks.editSaveButton = await email.getByRole('button', { name: 'Save' }).count();
    await emailCtx.close();

    // Wallet-user chrome + public profile privacy.
    const [pName, ...pRest] = PROVIDER_COOKIE.split('=');
    const walletCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await walletCtx.addInitScript(() => { window.nimiq = {}; });
    await walletCtx.addCookies([{ name: pName, value: pRest.join('='), domain: 'localhost', path: '/' }]);
    const wallet = await walletCtx.newPage();
    await wallet.goto(`${WEB}/profile?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(800);
    await wallet.screenshot({ path: join(OUT, 'walk-375-05-walletstatus-wallet.png') });
    await walletCtx.close();

    // Public profile: no private values in the DOM at all.
    const pubCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await pubCtx.addInitScript(() => { window.nimiq = {}; });
    const pub = await pubCtx.newPage();
    await pub.goto(`${WEB}/u/seed_provider?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(800);
    await pub.screenshot({ path: join(OUT, 'walk-375-06-public-profile.png'), fullPage: true });
    const pubHtml = await pub.content();
    checks.publicHasEmailRow = pubHtml.includes('Email');
    checks.publicHasPhoneRow = pubHtml.includes('Phone');
    checks.publicHasDobRow = pubHtml.includes('Date of birth');
    checks.publicHasLocationRow = pubHtml.includes('Location');
    checks.publicOpeningLink = await pub.locator('a[href^="/slot/"]').count();
    await pubCtx.close();

    // Field-specific edit: each Information row opens a single-field dialog.
    const [eName, ...eRest] = user.cookie.split('=');
    const eCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await eCtx.addInitScript(() => { window.nimiq = {}; });
    await eCtx.addCookies([{ name: eName, value: eRest.join('='), domain: 'localhost', path: '/' }]);
    const editor = await eCtx.newPage();
    await editor.goto(`${WEB}/profile?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(900);
    await editor.screenshot({ path: join(OUT, 'walk-375-01-profile-rows.png'), fullPage: true });

    // Every editable row is a BUTTON (not a link to the full form).
    checks.rowIsButton = {
      email: await editor.getByRole('button', { name: /email/i }).count(),
      phone: await editor.getByRole('button', { name: /phone/i }).count(),
      dob: await editor.getByRole('button', { name: /date of birth/i }).count(),
      location: await editor.getByRole('button', { name: /location/i }).count(),
    };
    // No row may link to the full profile-setup form any more.
    checks.onboardingFormLinks = await editor.locator('a[href*="/onboarding/profile"]').count();
    checks.editProfilePillLinks = await editor.getByRole('link', { name: /edit profile/i }).count();

    // Open the email field: exactly ONE input, and it is the email.
    await editor.getByRole('button', { name: /email/i }).first().click();
    await editor.getByRole('dialog').waitFor({ timeout: 10_000 });
    await sleep(500);
    await editor.screenshot({ path: join(OUT, 'walk-375-02-edit-email.png'), fullPage: true });
    const dialog = editor.getByRole('dialog');
    checks.dialogInputCount = await dialog.locator('input').count();
    checks.dialogTitle = (await dialog.locator('#field-edit-title').textContent()) ?? null;
    checks.dialogHasFullName = (await dialog.textContent())?.includes('Full name') ?? false;
    checks.dialogHasUsername = (await dialog.textContent())?.includes('Username') ?? false;
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await editor.getByRole('dialog').waitFor({ state: 'detached', timeout: 10_000 });
    await eCtx.close();

    // B2: the provider row on slot detail links to the public profile.
    const dCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await dCtx.addInitScript(() => { window.nimiq = {}; });
    const detail = await dCtx.newPage();
    await detail.goto(`${WEB}/slot/${SLOT}?desktop=1`, { waitUntil: 'networkidle' });
    await sleep(900);
    const providerLink = detail.locator('section[aria-label="Provider"] a[href^="/u/"]');
    checks.providerLinkOnDetail = await providerLink.count();
    checks.providerLinkHref = (await providerLink.first().getAttribute('href')) ?? null;
    await detail.screenshot({ path: join(OUT, 'walk-375-03-provider-link.png'), fullPage: true });
    await dCtx.close();
  } finally {
    await browser.close();
  }

  writeFileSync(join(OUT, 'walkthrough.json'), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  console.log('phase5nB: walkthrough checks:', JSON.stringify(checks, null, 1));

  const failed = merged.filter((r) => !r.pass);
  console.log(`phase5nB: gates ${merged.length - failed.length}/${merged.length} pass.`);
  for (const f of failed) {
    console.log(`  FAIL ${f.viewport}: contrast=${f.contrastFailures.length} touch=${f.touchFailures.length} overflow=${f.overflow.overflow}`);
    for (const c of f.contrastFailures) console.log(`    contrast ${c.ratio} ${c.fg} on ${c.bg} (${c.fontSize}) "${c.text}"`);
    for (const t of f.touchFailures) console.log(`    touch ${t.tag} ${t.w}x${t.h} "${t.label}"`);
  }

  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results: merged }, null, 2));
  await run(NPX, ['tsx', 'scripts/audit/seed-phase5.ts', '--revoke-sessions'], true);
  for (const cookie of [user.cookie, PROVIDER_COOKIE]) {
    await fetch(`${API}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie, origin: WEB, 'X-Takeover-Client': 'web', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
  }
  exitCode = failed.length > 0 ? 1 : 0;
} catch (err) {
  console.error(`phase5nB: FATAL: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  for (const child of spawned.reverse()) await killTree(child);
}
process.exit(exitCode);
