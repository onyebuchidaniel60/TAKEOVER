// Phase 5k-A evidence capture: proves the muted/tertiary tier is really
// rendering (and really being measured), and captures the 375px
// before/after screenshots for the token fix.
//
// audit.mjs only records contrast FAILURES, so a green report alone cannot
// distinguish "the muted tier renders and passes" from "nothing measured
// the muted tier at all". This script dumps the distinct (foreground,
// effective background, ratio) triples per route so the tier is visible in
// the evidence, and screenshots the same routes at 375px.
//
// Reusable for the before/after pair: the working tree is stashed, rebuilt,
// and this is re-run with --out pointing at the "before" directory, so both
// captures come from the same harness and the same viewport.
//
// Usage:
//   DATABASE_URL=... node scripts/audit/phase5kA-evidence.mjs --out <dir>
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

// Browser-context globals used inside addInitScript/evaluate callbacks —
// those run in Chromium, not Node.
/* global window, document, getComputedStyle, NodeFilter */

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const API = 'http://localhost:3001';
const WEB = 'http://localhost:5173';
const STUB_PORT = '8546';
const CHAIN_ENV = {
  POLYGON_RPC_URL: `http://127.0.0.1:${STUB_PORT}`,
  USDT_ESCROW_CONTRACT_ADDRESS: '0x000000000000000000000000000000000000dead',
  USDT_TOKEN_ADDRESS: '0x000000000000000000000000000000000000beef',
};

const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg > -1 ? process.argv[outArg + 1] : 'docs/redesign/audits/phase-5k-A-evidence');

function urlOk(url) {
  return fetch(url, { method: 'GET' }).then((r) => r.ok).catch(() => false);
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) {
      console.log(`evidence: ${label} up`);
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
  child.stderr.on('data', () => {});
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
  if (!(await urlOk(`${WEB}/`))) {
    spawned.push(launch('web', NPM, ['run', 'dev', '--workspace', 'takeover-web']));
    if (!(await waitFor(`${WEB}/`, 'web'))) throw new Error('web never healthy');
  }

  const BUYER_COOKIE = process.env.EVIDENCE_BUYER_COOKIE;
  const PROVIDER_COOKIE = process.env.EVIDENCE_PROVIDER_COOKIE;

  // A real onboarded email user for the account surfaces (/profile), so
  // the identity chrome and the private-field rows are in the capture.
  const tag = `test_5kae${String(Date.now() % 100000).padStart(5, '0')}`;
  const reg = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
    body: JSON.stringify({ email: `${tag}@test.local`, password: 'audit-password-long', username: tag }),
  });
  if (!reg.ok) throw new Error(`register failed: ${reg.status}`);
  const sm = /takeover_session=([^;]+)/.exec(reg.headers.get('set-cookie') ?? '');
  if (!sm) throw new Error('register did not set a session cookie');
  const USER_COOKIE = `takeover_session=${sm[1]}`;
  const onb = await fetch(`${API}/api/v1/me/onboarded`, {
    method: 'POST',
    headers: { cookie: USER_COOKIE, origin: WEB, 'X-Takeover-Client': 'web', 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!onb.ok) throw new Error(`/me/onboarded failed: ${onb.status}`);
  console.log(`evidence: onboarded audit user ${tag} registered`);
  const SLOT = '44444444-4444-4422-8422-000000000002';
  const CLAIM = '55555555-5555-4522-8522-000000000002';

  // [key, route, cookieHeader|null]
  const TARGETS = [
    ['home', '/?desktop=1', null],
    ['slot', `/slot/${SLOT}?desktop=1`, null],
    ['profile', '/profile?desktop=1', USER_COOKIE],
    ['sell', '/sell?desktop=1', PROVIDER_COOKIE],
    ['sell-detail', `/sell/${SLOT}?desktop=1`, PROVIDER_COOKIE],
    ['claim', `/claim/${CLAIM}?desktop=1`, BUYER_COOKIE],
    ['onboarding-profile', '/onboarding/profile?desktop=1', USER_COOKIE],
    ['welcome', '/welcome?desktop=1', null],
  ];

  const browser = await chromium.launch();
  const report = {};
  try {
    for (const [key, route, cookie] of TARGETS) {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
      await ctx.addInitScript(() => { window.nimiq = {}; });
      if (cookie) {
        const [name, ...rest] = cookie.split('=');
        await ctx.addCookies([{ name, value: rest.join('='), domain: 'localhost', path: '/' }]);
      }
      const page = await ctx.newPage();
      await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' });
      await sleep(1200);
      await page.screenshot({ path: join(OUT, `${key}-375.png`), fullPage: true });
      // Same measurement the gate uses, but recording the PASSING values.
      const pairs = await page.evaluate(() => {
        const lum = (r, g, b) => {
          const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const effBg = (el) => {
          let n = el;
          while (n && n !== document.documentElement) {
            const m = getComputedStyle(n).backgroundColor.match(/rgba?\(([^)]+)\)/);
            if (m) {
              const p = m[1].split(',').map((x) => Number(x.trim()));
              if (p.length >= 3 && (p[3] ?? 1) > 0.02) return { r: p[0], g: p[1], b: p[2] };
            }
            n = n.parentElement;
          }
          return { r: 10, g: 10, b: 10 };
        };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const seen = new Set();
        const out = [];
        let node;
        while ((node = walker.nextNode())) {
          const text = node.nodeValue.trim();
          if (!text) continue;
          const el = node.parentElement;
          if (!el) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          const fg = cs.color.match(/rgba?\(([^)]+)\)/);
          if (!fg) continue;
          const p = fg[1].split(',').map((x) => Number(x.trim()));
          if (p.slice(0, 3).some((n2) => !Number.isFinite(n2))) continue;
          const bg = effBg(el);
          const key = `${p[0]},${p[1]},${p[2]}|${bg.r},${bg.g},${bg.b}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const cr = (Math.max(lum(p[0], p[1], p[2]), lum(bg.r, bg.g, bg.b)) + 0.05) /
            (Math.min(lum(p[0], p[1], p[2]), lum(bg.r, bg.g, bg.b)) + 0.05);
          out.push({
            fg: `rgb(${p[0]}, ${p[1]}, ${p[2]})`,
            bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
            fontSize: cs.fontSize,
            ratio: Math.round(cr * 100) / 100,
            sample: text.slice(0, 48),
          });
        }
        return out;
      });
      report[key] = pairs;
      const tiers = [...new Set(pairs.map((p) => p.fg))];
      console.log(`evidence: ${key} — ${pairs.length} distinct pairs`);
      for (const t of tiers) {
        const lowest = Math.min(...pairs.filter((p) => p.fg === t).map((p) => p.ratio));
        console.log(`   ${t.padEnd(22)} min ratio ${lowest.toFixed(2)}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  writeFileSync(join(OUT, 'color-tiers.json'), JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
  console.log(`evidence: written to ${OUT}`);
} catch (err) {
  console.error(`evidence: FATAL: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  for (const child of spawned.reverse()) await killTree(child);
}
process.exit(exitCode);
