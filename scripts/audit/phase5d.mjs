// Phase 5d browser audit: open-sign nav icon, avatars, opening images.
//
// Boots API + web (reusing already-running servers, like with-backend.mjs),
// seeds (db:seed + seed-phase5), stamps avatar/image fixtures onto seed rows,
// mints the audit-buyer session, and captures:
//
//   /                        feed (mandated: 4 viewports x default,loading,empty,error)
//   /?desktop=1              real feed behind the desktop-gate bypass
//   /slot/<id>?desktop=1    detail WITH image + provider avatar
//   /profile?desktop=1       profile WITH avatar (cookie)
//   /sell?desktop=1          provider list, Sell icon ACTIVE (cookie)
//   /sell/new?desktop=1      SlotForm image field, empty (cookie)
//
// Fixture images are generated PNGs (a lime/magenta gradient built with
// node:zlib + a small CRC32 — no new dependency): real pixels, so the
// screenshots prove layout AND rendering, not just empty boxes.
//
// Reports merge into docs/redesign/audits/phase-5d/report.json;
// screenshots are prefixed per target (<target>-<w>x<h>-<state>.png).
// The audit session is revoked afterwards; spawned servers are torn down.
// Seed/test rows stay in place for the phase-end cleanup step
// (node scripts/db/cleanup-test-data.mjs — the standing rule).
//
// Usage:
//   DATABASE_URL=... node scripts/audit/phase5d.mjs
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Client } from 'pg';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const OUT = resolve('docs/redesign/audits/phase-5d');

if (!process.env.DATABASE_URL) {
  console.error('phase5d: DATABASE_URL is not set — refusing (no mock fallback).');
  process.exit(2);
}

// -- fixture image generation (pure node, no new dependency) ---------------

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Diagonal lime→magenta gradient PNG (visible at any stretch). */
function gradientPng(width, height) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height);
      const o = y * (1 + width * 3) + 1 + x * 3;
      raw[o] = Math.round(190 * (1 - t) + 220 * t);
      raw[o + 1] = Math.round(240 * (1 - t) + 40 * t);
      raw[o + 2] = Math.round(60 * (1 - t) + 220 * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

// -- process helpers (with-backend.mjs / phase5.mjs precedent) ---------------

function urlOk(url) {
  return fetch(url, { method: 'GET' })
    .then((r) => r.ok)
    .catch(() => false);
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) {
      console.log(`phase5d: ${label} up (${url})`);
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

function run(cmd, args, shell = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => process.stderr.write(`[seed] ${d}`));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${out}`))));
  });
}

const VIEWPORTS = '320,375,768,1280';
// Fixed phase-5 fixture ids (seed-phase5.ts): published future slot on the
// shared provider, plus the audit buyer.
const IMAGE_SLOT_ID = '44444444-4444-4422-8422-000000000001';
const PROVIDER_ID = '11111111-1111-4111-8111-000000000001';
const BUYER_ID = '33333333-3333-4333-8333-000000000001';

const spawned = [];
let exitCode = 0;
try {
  if (!(await urlOk('http://localhost:3001/health'))) {
    console.log('phase5d: starting API dev server…');
    spawned.push(launch('api', NPM, ['run', 'dev', '--workspace', 'takeover-api']));
    if (!(await waitFor('http://localhost:3001/health', 'api'))) {
      throw new Error('API dev server never became healthy');
    }
  } else {
    console.log('phase5d: reusing already-running API (will not kill it)');
  }

  console.log('phase5d: seeding demo fixtures (idempotent)…');
  await run(NPM, ['run', 'db:seed'], true);
  const seedOut = await run(NPX, ['tsx', 'scripts/audit/seed-phase5.ts', '--mint-session'], true);
  const { claims, cookie } = JSON.parse(seedOut.slice(seedOut.indexOf('{')));
  console.log(`phase5d: seeded ${Object.keys(claims).length} claims, session minted`);

  console.log('phase5d: stamping avatar/image fixtures…');
  const avatar = gradientPng(48, 48);
  const slotImage = gradientPng(96, 60);
  console.log(
    `phase5d: fixture sizes (decoded bytes): avatar=${Buffer.from(avatar.split(',')[1], 'base64').length} image=${Buffer.from(slotImage.split(',')[1], 'base64').length}`,
  );
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(`UPDATE users SET avatar_data = $1 WHERE id = $2`, [avatar, BUYER_ID]);
    await db.query(`UPDATE users SET avatar_data = $1 WHERE id = $2`, [avatar, PROVIDER_ID]);
    await db.query(`UPDATE slots SET image_data = $1 WHERE id = $2`, [slotImage, IMAGE_SLOT_ID]);
    // Top-of-feed card (db/seed.ts fixture, starts soonest): puts an image
    // card near the top of / so the scrolled feed capture shows it.
    await db.query(`UPDATE slots SET image_data = $1 WHERE id = $2`, [
      slotImage,
      '22222222-2222-4222-8222-000000000001',
    ]);
  } finally {
    await db.end();
  }

  if (!(await urlOk('http://localhost:5173/'))) {
    console.log('phase5d: starting web dev server…');
    spawned.push(launch('web', NPM, ['run', 'dev', '--workspace', 'takeover-web']));
    if (!(await waitFor('http://localhost:5173/', 'web'))) {
      throw new Error('web dev server never became healthy');
    }
  } else {
    console.log('phase5d: reusing already-running web server (will not kill it)');
  }

  const cookieFlag = `${cookie.name}=${cookie.value}`;
  const TARGETS = [
    // [key, route, states, ready, authed, scrollY]
    ['feed', '/', 'default,loading,empty,error', 'text:Table for two', false, 0],
    ['feed-app', '/?desktop=1', 'default', 'text:Table for two', false, 700],
    ['slot-image', `/slot/${IMAGE_SLOT_ID}?desktop=1`, 'default', 'text:Gallery preview', false, 0],
    ['profile', '/profile?desktop=1', 'default', 'text:Change picture', true, 0],
    ['sell', '/sell?desktop=1', 'default', '', true, 0],
    ['sell-new', '/sell/new?desktop=1', 'default', 'text:Save draft', true, 0],
  ];

  const merged = [];
  for (const [key, route, states, ready, authed, scrollY] of TARGETS) {
    const sub = join(OUT, key);
    console.log(`phase5d: auditing ${key} (${route})…`);
    const args = [
      'scripts/audit/audit.mjs',
      '--route', route,
      '--viewports', VIEWPORTS,
      '--states', states,
      '--out', sub,
    ];
    if (ready) args.push('--ready', ready);
    if (authed) args.push('--cookie', cookieFlag);
    if (scrollY) args.push('--scrollY', String(scrollY));
    await run(process.execPath, args);
    const report = JSON.parse(readFileSync(join(sub, 'report.json'), 'utf8'));
    merged.push(...report.results);
    for (const f of readdirSync(sub)) {
      if (f.endsWith('.png')) renameSync(join(sub, f), join(OUT, `${key}-${f}`));
    }
    rmSync(sub, { recursive: true, force: true });
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'report.json'),
    JSON.stringify({ at: new Date().toISOString(), results: merged }, null, 2),
  );
  const failed = merged.filter((r) => !r.pass).length;
  console.log(`phase5d: done. ${merged.length - failed}/${merged.length} pass. Report: ${join(OUT, 'report.json')}`);

  console.log('phase5d: revoking audit session…');
  await run(NPX, ['tsx', 'scripts/audit/seed-phase5.ts', '--revoke-sessions'], true);
} catch (err) {
  console.error(`phase5d: FATAL: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  for (const child of spawned.reverse()) {
    await killTree(child);
  }
  console.log('phase5d: teardown complete (seed rows retained for the phase-end cleanup)');
}
process.exit(exitCode);
