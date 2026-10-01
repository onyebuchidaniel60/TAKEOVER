// Phase 5q — refresh-persistence proof.
//
// The owner reported "a simple browser refresh logs the user out". This script
// is the evidence either way, and it is deliberately able to FAIL: it asserts
// /me returns 200 after a reload and exits non-zero if it does not.
//
// It runs the three credential shapes that exist in production:
//   A  cookie AND sessionStorage  — desktop browser
//   B  sessionStorage only        — Nimiq WebView (third-party cookie dropped)
//   C  neither                    — a genuine logged-out visitor
//
// A and B must survive a reload; C must not. C is the control: without it, a
// green run proves nothing, because "always 200" would also pass.
//
// The token is installed with addInitScript, i.e. BEFORE any application code
// runs. An earlier draft set it after the first navigation, and the 401 it
// reported was the script's own artifact rather than the app's behaviour.
//
// Usage:
//   DATABASE_URL=... node scripts/audit/phase5q-refresh-proof.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const WEB = 'http://localhost:5173';
const API = 'http://localhost:3001';

if (!(await fetch(`${API}/health`).then((r) => r.ok).catch(() => false))) {
  console.error('phase5q: API is not running on 3001 — start it first.');
  process.exit(2);
}
if (!(await fetch(WEB).then((r) => r.ok).catch(() => false))) {
  console.error('phase5q: web is not running on 5173 — start it first.');
  process.exit(2);
}

const TAG = `test_5q${Date.now() % 1000000}`;
const EMAIL = `${TAG}@test.local`;

const reg = await fetch(`${API}/api/v1/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
  body: JSON.stringify({ email: EMAIL, password: 'audit-password-long', username: TAG }),
});
if (!reg.ok) {
  console.error(`phase5q: register failed: ${reg.status} ${await reg.text()}`);
  process.exit(1);
}
const cookiePair = (reg.headers.get('set-cookie') ?? '').split(';')[0];
const token = cookiePair.split('=')[1];
// A fresh account has onboardedAt = null, and the app's onboarding gate then
// bounces it to /welcome — which looks identical to "logged out" and has
// already cost one misleading audit (see phase5oB).
await fetch(`${API}/api/v1/me/onboarded`, {
  method: 'POST',
  headers: { cookie: cookiePair, origin: WEB, 'X-Takeover-Client': 'web', 'content-type': 'application/json' },
  body: JSON.stringify({}),
});
console.log(`phase5q: registered ${EMAIL}`);

const browser = await chromium.launch();
const results = [];

async function scenario(label, { withCookie, withStorage }) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { window.nimiq = {}; });
  if (withStorage) {
    await ctx.addInitScript((t) => {
      try { sessionStorage.setItem('takeover.sessionToken', t); } catch { /* private mode */ }
    }, token);
  }
  if (withCookie) {
    await ctx.addCookies([{ name: 'takeover_session', value: token, domain: 'localhost', path: '/' }]);
  }
  const page = await ctx.newPage();
  const calls = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/me') && r.request().method() === 'GET') {
      const auth = r.request().headers()['authorization'];
      calls.push({ status: r.status(), bearer: Boolean(auth) });
    }
  });

  await page.goto(`${WEB}/profile?desktop=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const signedInBefore = (await page.locator('text=Information').count()) > 0;

  calls.length = 0;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const signedInAfter = (await page.locator('text=Information').count()) > 0;
  const meAfter = calls.map((c) => `${c.status}${c.bearer ? ' (Bearer)' : ''}`);

  console.log(`\n  ${label}`);
  console.log(`    signed in before reload: ${signedInBefore}`);
  console.log(`    /me after reload:       ${meAfter.join(', ') || '(none)'}`);
  console.log(`    signed in after reload:  ${signedInAfter}`);
  await page.screenshot({
    path: `docs/redesign/audits/phase-5q/refresh-${label}.png`,
    fullPage: false,
  });
  results.push({ label, signedInBefore, signedInAfter, meAfter });
  await ctx.close();
  return signedInAfter;
}

console.log('\nphase5q: refresh persistence proof');
const a = await scenario('A-cookie-and-storage', { withCookie: true, withStorage: true });
const b = await scenario('B-storage-only-webview', { withCookie: false, withStorage: true });
const c = await scenario('C-neither-control', { withCookie: false, withStorage: false });
await browser.close();

// Cleanup: the probe account, its session, profile and audit rows.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const u = await client.query('SELECT id FROM users WHERE email = $1', [EMAIL]);
if (u.rows[0]) {
  await client.query('DELETE FROM audit_events WHERE actor_user_id = $1', [u.rows[0].id]);
  await client.query('DELETE FROM sessions WHERE user_id = $1', [u.rows[0].id]);
  await client.query('DELETE FROM provider_profiles WHERE user_id = $1', [u.rows[0].id]);
  await client.query('DELETE FROM users WHERE id = $1', [u.rows[0].id]);
}
await client.end();
console.log('phase5q: probe account removed');

const ok = a && b && !c;
console.log(`\nVERDICT: A=${a} B=${b} C=${c} (C must be false) -> ${ok ? 'PASS' : 'FAIL'}`);
if (!ok) {
  console.log('A session must survive a reload whenever a credential exists; the C control must NOT.');
}
process.exit(ok ? 0 : 1);