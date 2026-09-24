// Repeated-navigation test (Phase 5b diagnostic, read-only).
// The owner's exact complaint: Home -> slot -> Home -> same slot.
// Reports every request per step: does step 3/4 re-fetch, or serve cache?
//
// Usage: servers running; --slot <id> --cookie "..." (same as measure-routes).
import { chromium } from 'playwright';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const BASE = (arg('base', 'http://localhost:5173') || '').replace(/\/$/, '');
const COOKIE = arg('cookie', '');
const SLOT = arg('slot', '');
if (!SLOT) {
  console.error('repeat-nav: --slot is required');
  process.exit(2);
}

const browser = await chromium.launch();
try {
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
  const log = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/') || r.resourceType() === 'document') {
      log.push({ step: log.step, kind: r.resourceType(), api: url.pathname.startsWith('/api/') ? `${r.method()} ${url.pathname}${url.search}` : null });
    }
  });
  const step = async (name, fn) => {
    const before = log.length;
    const t0 = Date.now();
    await fn();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const slice = log.slice(before);
    const apis = slice.filter((e) => e.api).map((e) => e.api);
    console.log(`--- ${name}: ${Date.now() - t0}ms, ${apis.length} api calls`);
    for (const a of apis) console.log(`    ${a}`);
    return apis;
  };

  await step('1 home (cold)', () => page.goto(`${BASE}/?desktop=1`, { waitUntil: 'domcontentloaded' }));
  // Click the first feed card into the slot page (real navigation).
  await step('2 slot (via card click)', async () => {
    await page.waitForSelector('main li a', { timeout: 30000 });
    await Promise.all([
      page.waitForURL(`**/slot/*`, { timeout: 30000 }),
      page.click('main li a'),
    ]);
  });
  await step('3 home (back)', () => page.goto(`${BASE}/?desktop=1`, { waitUntil: 'domcontentloaded' }));
  await step('4 same slot (direct revisit)', () => page.goto(`${BASE}/slot/${SLOT}?desktop=1`, { waitUntil: 'domcontentloaded' }));
  await context.close();
} finally {
  await browser.close();
}
console.log('done.');
