// Backend latency probe (Phase 5b diagnostic, read-only GETs/POSTs that
// the UI itself performs — no writes beyond a verify-deposit status read).
// Two targets:
//   1. Local dev API (dev DB): per-endpoint TTFB, warm (median of 5).
//   2. Railway production: /health + /config warm, then cold after a
//      6-minute idle window (set --cold-minutes 0 to skip the wait).
//
// Usage:
//   DATABASE_URL=... node scripts/perf/backend-latency.mjs --cookie "..." --claim <id> --slot <id>
import { setTimeout as sleep } from 'node:timers/promises';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const COOKIE = arg('cookie', '');
const CLAIM = arg('claim', '');
const SLOT = arg('slot', '');
const COLD_MIN = Number(arg('cold-minutes', '6')) || 0;
const API = 'http://localhost:3001';
const PROD = 'https://takeover-api-production-1511.up.railway.app';

const headers = COOKIE ? { cookie: COOKIE.includes('=') && !COOKIE.startsWith('takeover') ? COOKIE : `takeover_session=${COOKIE.split('=').pop()}` } : {};

async function hit(url, init) {
  const t0 = Date.now();
  const res = await fetch(url, { headers, ...init });
  const ttfb = Date.now() - t0;
  await res.arrayBuffer().catch(() => undefined);
  return { status: res.status, ttfbMs: ttfb };
}

function median(ns) {
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

console.log('== local dev API (warm, median of 5) ==');
const eps = [
  ['GET /config', `${API}/api/v1/config`],
  ['GET /slots?limit=12', `${API}/api/v1/slots?limit=12`],
  ...(SLOT ? [['GET /slots/:id', `${API}/api/v1/slots/${SLOT}`]] : []),
  ['GET /me', `${API}/api/v1/me`],
  ['GET /me/slots', `${API}/api/v1/me/slots?limit=50`],
  ['GET /me/claims', `${API}/api/v1/me/claims?limit=50`],
  ['GET /me/notifications', `${API}/api/v1/me/notifications`],
  ...(CLAIM ? [
    [`GET /claims/:id`, `${API}/api/v1/claims/${CLAIM}`],
    [`GET /claims/:id/escrow`, `${API}/api/v1/claims/${CLAIM}/escrow`],
  ] : []),
];
for (const [name, url] of eps) {
  const ts = [];
  let status = 0;
  for (let i = 0; i < 5; i++) {
    const r = await hit(url);
    ts.push(r.ttfbMs);
    status = r.status;
  }
  console.log(`${name}: status=${status} ttfbMedian=${median(ts)}ms runs=[${ts.join(',')}]`);
}

console.log('== Railway production (warm) ==');
for (const [name, url] of [['GET /health', `${PROD}/health`], ['GET /config', `${PROD}/api/v1/config`]]) {
  const ts = [];
  for (let i = 0; i < 3; i++) ts.push((await hit(url)).ttfbMs);
  console.log(`${name}: ttfbMedian=${median(ts)}ms runs=[${ts.join(',')}]`);
}

if (COLD_MIN > 0) {
  console.log(`== idle ${COLD_MIN} min, then cold probe ==`);
  await sleep(COLD_MIN * 60_000);
  for (const [name, url] of [['GET /health', `${PROD}/health`], ['GET /config', `${PROD}/api/v1/config`]]) {
    const r = await hit(url);
    console.log(`${name} cold: status=${r.status} ttfb=${r.ttfbMs}ms`);
  }
  const r2 = await hit(`${API}/api/v1/config`);
  console.log(`local GET /config after-idle: status=${r2.status} ttfb=${r2.ttfbMs}ms`);
}
console.log('done.');
