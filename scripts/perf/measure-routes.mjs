// Route load baseline (Phase 5b diagnostic, read-only).
// Measures cold (fresh context) vs warm (same-context revisit) loads:
// first-contentful-paint, total network bytes, and every /api call with
// its TTFB. No backend writes; auth via --cookie (minted session).
//
// Usage (servers already running, e.g. via with-backend or manually):
//   node scripts/perf/measure-routes.mjs \
//     --base http://localhost:5173 \
//     --cookie "takeover_session=<id>.<secret>" \
//     --slot <live-slot-id> --claim <owned-claim-id> --sellSlot <owned-draft-id>
//
// Viewport is a 390px phone (the product surface): no desktop gate,
// no bypass param, no filter-param side effects.
import { chromium } from 'playwright';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const BASE = (arg('base', 'http://localhost:5173') || '').replace(/\/$/, '');
const COOKIE = arg('cookie', '');
const SLOT = arg('slot', '');
const CLAIM = arg('claim', '');
const SELLSLOT = arg('sellSlot', '');

// ?desktop=1 on every route: without window.nimiq the Phase 4c gate
// takes over mid-measurement (500ms grace), which would measure the
// gate instead of the route. The bypass isolates app performance.
// (Side effect: Home sees a query param and offers "Clear filters" in
// the empty state — cosmetic only.)
const BYPASS = '?desktop=1';
const ROUTES = [
  // [name, path, readiness needle proving the route's own data rendered
  // (guards against measuring an auth-bounce intermediate instead)].
  ['home', `/${BYPASS}`, 'Available now'],
  ['openings', `/openings${BYPASS}`, 'Available now'],
  ['slot', SLOT && `/slot/${SLOT}${BYPASS}`, 'Back to openings'],
  ['claim', CLAIM && `/claim/${CLAIM}${BYPASS}`, 'Back to my holds'],
  ['sell', `/sell${BYPASS}`, 'My openings'],
  ['sell-new', `/sell/new${BYPASS}`, 'New opening'],
  ['sell-detail', SELLSLOT && `/sell/${SELLSLOT}${BYPASS}`, 'Back to my openings'],
  ['profile', `/profile${BYPASS}`, 'Wallet'],
  ['claims', `/claims${BYPASS}`, 'My holds'],
  ['notifications', `/notifications${BYPASS}`, 'Notifications'],
].filter(([, r]) => r);

async function measure(page, route, readyText) {
  const api = [];
  const starts = new Map();
  const bytes = { total: 0 };
  const onRequest = (req) => {
    try {
      const url = new URL(req.url());
      if (url.pathname.startsWith('/api/')) starts.set(req, Date.now());
    } catch { /* ignore */ }
  };
  const onResponse = async (res) => {
    try {
      const buf = await res.body().catch(() => null);
      const n = buf ? buf.length : Number(res.headers()['content-length'] || 0);
      bytes.total += n;
      const url = new URL(res.url());
      if (url.pathname.startsWith('/api/')) {
        const t0 = starts.get(res.request());
        api.push({
          endpoint: `${res.request().method()} ${url.pathname}${url.search}`,
          status: res.status(),
          // Wall-clock TTFB: request dispatch to first response byte.
          ttfbMs: t0 === undefined ? null : Date.now() - t0,
          bytes: n,
        });
        starts.delete(res.request());
      }
    } catch { /* ignore raced responses */ }
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  const t0 = Date.now();
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Readiness first: the route's own content must render (otherwise an
  // auth-bounce intermediate would be measured instead of the route).
  if (readyText) {
    await page.waitForFunction(
      (needle) => (document.body.textContent || '').includes(needle),
      readyText,
      { timeout: 30000 },
    ).catch(() => undefined);
  }
  // Quiescence: wait until no /api response has arrived for 1.5s (covers
  // auth-bounce-then-fetch chains), capped at 20s.
  let lastApi = Date.now();
  const apiSeen = () => api.length;
  let seen = 0;
  const deadline = Date.now() + 20000;
  for (;;) {
    await page.waitForTimeout(300);
    if (apiSeen() !== seen) {
      seen = apiSeen();
      lastApi = Date.now();
    }
    if (Date.now() - lastApi > 1500 || Date.now() > deadline) break;
  }
  const paint = await page.evaluate(() => {
    const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
    return fcp ? Math.round(fcp.startTime) : null;
  });
  page.off('request', onRequest);
  page.off('response', onResponse);
  return { wallMs: Date.now() - t0, fcpMs: paint, bytes: bytes.total, api };
}

const browser = await chromium.launch();
const out = [];
try {
  // Cold: brand-new context (empty HTTP cache, fresh JS parse).
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (COOKIE) {
      const cut = COOKIE.indexOf('=');
      await context.addCookies([{
        name: COOKIE.slice(0, cut),
        value: COOKIE.slice(cut + 1),
        domain: new URL(BASE).hostname,
        path: '/',
      }]);
    }
    const page = await context.newPage();
    for (const [name, route, ready] of ROUTES) {
      out.push({ route: name, pass: 'cold', ...(await measure(page, route, ready)) });
      console.log(`cold ${name}: fcp=${out[out.length - 1].fcpMs}ms bytes=${out[out.length - 1].bytes} api=${out[out.length - 1].api.length}`);
    }
    await context.close();
  }
  // Warm: revisit each route in a lived-in context (HTTP cache + parsed
  // modules persist; React state does not survive a full navigation).
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (COOKIE) {
      const cut = COOKIE.indexOf('=');
      await context.addCookies([{
        name: COOKIE.slice(0, cut),
        value: COOKIE.slice(cut + 1),
        domain: new URL(BASE).hostname,
        path: '/',
      }]);
    }
    const page = await context.newPage();
    for (const [name, route, ready] of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      // Away, then back = the revisit.
      await page.goto(`${BASE}/openings${BYPASS}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
      out.push({ route: name, pass: 'warm', ...(await measure(page, route, ready)) });
      console.log(`warm ${name}: fcp=${out[out.length - 1].fcpMs}ms bytes=${out[out.length - 1].bytes} api=${out[out.length - 1].api.length}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));
