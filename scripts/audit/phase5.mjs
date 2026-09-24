// Phase 5 escrow audit: all eight escrow states in a real browser.
//
// The claim pages require authentication, which the stock audit script
// cannot do — so this wrapper mints a REAL session row for the audit
// buyer (same <uuid>.<base64url-secret> format as createSessionToken,
// SHA-256 stored; see apps/api/src/auth/session-token.ts), passes it
// to audit.mjs via the --cookie flag, and revokes it afterwards. No
// backend change, no backdoor: the cookie goes through the real
// session middleware against real seeded claim/escrow rows.
//
// Flow: boot API + web (reusing already-running servers, like
// with-backend.mjs) → idempotent Phase-5 seed → mint session → one
// audit run per escrow state (4 viewports each) → merge the eight
// reports + screenshots into docs/redesign/audits/phase-5/ → revoke
// the session → tear down spawned servers.
//
// Usage:
//   DATABASE_URL=... node scripts/audit/phase5.mjs
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Invoked from the repo root (see Usage); paths stay relative like
// with-backend.mjs so no file:// URL juggling is needed on Windows.
const OUT = resolve('docs/redesign/audits/phase-5');

if (!process.env.DATABASE_URL) {
  console.error('phase5: DATABASE_URL is not set — refusing (no mock fallback).');
  process.exit(2);
}

// escrow state → claim id is fixed by the seed script; readiness text
// is the rendered copy that proves the state (not a skeleton).
const STATES = [
  ['created', 'text:Pay 1.5 USDT'],
  ['funded', 'text:Held until delivery'],
  ['delivered', 'text:Marked delivered'],
  ['disputed', 'text:In review'],
  ['releasing', 'text:Releasing to provider'],
  ['released', 'text:Payment released.'],
  ['refunding', 'text:Refunding to your wallet'],
  ['refunded', 'text:Refunded to your wallet.'],
];
const VIEWPORTS = '320,375,768,1280';

// Read-only chain surface for seeded-row reads (see polygon-stub.mjs).
// Fixture deadlines sit in the future and stub receipts are null, so
// lazy transitions never fire and nothing ever broadcasts.
const STUB_PORT = '8546';
const AUDIT_CHAIN_ENV = {
  POLYGON_RPC_URL: `http://127.0.0.1:${STUB_PORT}`,
  USDT_ESCROW_CONTRACT_ADDRESS: '0x7f8f66e1e07372dc371edf8f21d2d84208a4fc06',
  USDT_TOKEN_ADDRESS: '0xc885e1eed2a2f2215b756fa04b89aad1a27559de',
};

function urlOk(url) {
  return fetch(url, { method: 'GET' })
    .then((r) => r.ok)
    .catch(() => false);
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) {
      console.log(`phase5: ${label} up (${url})`);
      return true;
    }
    await sleep(2000);
  }
  return false;
}

function launch(label, cmd, args, extraEnv, useShell) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Windows: .cmd shims require a shell — but a spaced binary path
    // (node.exe) must NOT go through one (cmd splits it unquoted).
    shell: useShell ?? process.platform === 'win32',
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
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
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => process.stderr.write(`[seed] ${d}`));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${out}`))));
  });
}

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const spawned = [];
let exitCode = 0;
try {
  console.log('phase5: starting Polygon stub (read-only, local)…');
  spawned.push(launch('stub', process.execPath, ['scripts/audit/polygon-stub.mjs', STUB_PORT], undefined, false));
  const stubOk = await (async () => {
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${STUB_PORT}/`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        });
        const j = await r.json();
        if (j.result === '0x89') return true;
      } catch { /* not up yet */ }
      await sleep(1000);
    }
    return false;
  })();
  if (!stubOk) throw new Error('Polygon stub never answered');

  if (!(await urlOk('http://localhost:3001/health'))) {
    console.log('phase5: starting API dev server…');
    spawned.push(launch('api', NPM, ['run', 'dev', '--workspace', 'takeover-api'], AUDIT_CHAIN_ENV));
    if (!(await waitFor('http://localhost:3001/health', 'api'))) throw new Error('API never healthy');
  } else {
    console.log('phase5: reusing already-running API (will not kill it; chain env may differ)');
  }

  console.log('phase5: seeding fixtures + minting session…');
  // npx.cmd needs a shell on Windows (spawn EINVAL otherwise).
  const seedOut = await run(NPX, ['tsx', 'scripts/audit/seed-phase5.ts', '--mint-session'], true);
  const { claims, cookie } = JSON.parse(seedOut.slice(seedOut.indexOf('{')));
  console.log(`phase5: seeded ${Object.keys(claims).length} claims, session minted`);

  if (!(await urlOk('http://localhost:5173/'))) {
    console.log('phase5: starting web dev server…');
    spawned.push(launch('web', NPM, ['run', 'dev', '--workspace', 'takeover-web']));
    if (!(await waitFor('http://localhost:5173/', 'web'))) throw new Error('web never healthy');
  } else {
    console.log('phase5: reusing already-running web server (will not kill it)');
  }

  // Readiness gate: the releasing fixture exercises the chain-client
  // read path (receipt poll). If it does not come back as releasing,
  // the audit env is broken — abort LOUDLY instead of capturing error
  // panels and calling them states.
  {
    const probeId = claims.releasing;
    const res = await fetch(`http://localhost:3001/api/v1/claims/${probeId}/escrow`, {
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    });
    const body = await res.json().catch(() => null);
    const got = body?.data?.escrow?.status;
    console.log(`phase5: readiness probe escrow status = ${got}`);
    if (got !== 'releasing') {
      throw new Error(`readiness probe failed (got ${got}); refusing to capture error panels as states`);
    }
  }

  const merged = [];
  for (const [state, ready] of STATES) {
    const claimId = claims[state];
    if (!claimId) throw new Error(`seed missing claim for ${state}`);
    const sub = join(OUT, state);
    console.log(`phase5: auditing ${state} (/claim/${claimId})…`);
    await run(process.execPath, ['scripts/audit/audit.mjs',
      '--route', `/claim/${claimId}?desktop=1`,
      '--viewports', VIEWPORTS,
      '--states', state,
      '--ready', ready,
      '--cookie', `${cookie.name}=${cookie.value}`,
      '--out', sub,
    ]);
    const report = JSON.parse(readFileSync(join(sub, 'report.json'), 'utf8'));
    merged.push(...report.results);
    for (const f of readdirSync(sub)) {
      if (f.endsWith('.png')) renameSync(join(sub, f), join(OUT, f));
    }
    rmSync(sub, { recursive: true, force: true });
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results: merged }, null, 2));
  const failed = merged.filter((r) => !r.pass).length;
  console.log(`phase5: done. ${merged.length - failed}/${merged.length} pass. Report: ${join(OUT, 'report.json')}`);

  console.log('phase5: revoking audit session…');
  await run(NPX, ['tsx', 'scripts/audit/seed-phase5.ts', '--revoke-sessions'], true);
} catch (err) {
  console.error(`phase5: FATAL: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  for (const child of spawned.reverse()) {
    await killTree(child);
  }
  console.log('phase5: teardown complete');
}
process.exit(exitCode);
