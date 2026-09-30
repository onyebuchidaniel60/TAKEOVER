// Phase 5k-A audit: contrast re-audit after the text-muted/text-faint
// token fix.
//
// The `text-muted` / `text-faint` utilities emitted ZERO CSS before this
// phase (Tailwind builds `text-` + <color key>, and the config keyed the
// colors as `text-muted` / `text-faint`, so only `.text-text-muted` could
// ever exist and nothing referenced it). Every muted/tertiary element
// therefore rendered as inherited primary text — which also meant every
// contrast measurement taken in Phases 1-5j was measuring the WRONG color
// for ~100 call sites. This script re-measures every major route now that
// the tier is real, and the report is the evidence the muted tier passes
// AA on every surface it sits on.
//
// Boots the real stack (API + web + the read-only Polygon stub) reusing
// already-running servers, seeds the Phase 5 escrow fixtures for the
// claim/sell surfaces, registers two live email users through the real
// register endpoint (one fresh/un-onboarded for the /onboarding/* guards,
// one onboarded for the account surfaces), and audits every route at
// 320/375/768/1280.
//
// No mocks, no backdoor: the authed routes use real session cookies —
// minted either by the register endpoint or by a normal sessions insert
// (seed-phase5 --mint-provider-session).
//
// Usage:
//   DATABASE_URL=... node scripts/audit/phase5kA.mjs
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const OUT = resolve('docs/redesign/audits/phase-5k-A');
const API = 'http://localhost:3001';
const WEB = 'http://localhost:5173';
const STUB_PORT = '8546';
const VIEWPORTS = '320,375,768,1280';

// The API reads escrow state from the chain for transitional fixtures.
// Point it at the local read-only stub so a run can never broadcast.
// The two contract addresses are inert placeholders: the stub answers
// every eth_call/eth_getLogs with an empty result, so no real contract is
// ever contacted. They exist only because the escrow read path fails
// closed (503 ESCROW_CONTRACT_UNAVAILABLE) when they are absent — which
// is the correct production behavior, not something to work around in
// application code.
const AUDIT_CHAIN_ENV = {
  POLYGON_RPC_URL: `http://127.0.0.1:${STUB_PORT}`,
  USDT_ESCROW_CONTRACT_ADDRESS: '0x000000000000000000000000000000000000dead',
  USDT_TOKEN_ADDRESS: '0x000000000000000000000000000000000000beef',
};

function urlOk(url) {
  return fetch(url, { method: 'GET' })
    .then((r) => r.ok)
    .catch(() => false);
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) {
      console.log(`phase5kA: ${label} up (${url})`);
      return true;
    }
    await sleep(2000);
  }
  return false;
}

function launch(label, cmd, args, extraEnv, shell) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Windows: .cmd shims need a shell (spawn EINVAL otherwise), but a
    // bare node.exe + script path must NOT have one.
    shell: shell ?? process.platform === 'win32',
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

// Live email registration through the real endpoint (Phase 5j pattern).
// Run-unique usernames so a past aborted pass can never leave this run's
// user already onboarded (which would trip the /onboarding/* guards).
async function registerAuditUser(tag) {
  const name = `test_5ka${tag}${String(Date.now() % 100000).padStart(5, '0')}`;
  const res = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
    body: JSON.stringify({ email: `${name}@test.local`, password: 'audit-password-long', username: name }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  const match = /takeover_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  if (!match) throw new Error('register did not set a session cookie');
  return { cookie: `takeover_session=${match[1]}`, username: name };
}

async function markOnboarded(cookie) {
  const res = await fetch(`${API}/api/v1/me/onboarded`, {
    method: 'POST',
    headers: {
      cookie,
      origin: WEB,
      'X-Takeover-Client': 'web',
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`/me/onboarded failed: ${res.status}`);
}

const spawned = [];
let exitCode = 0;
try {
  console.log('phase5kA: starting Polygon stub (read-only, local)…');
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

  if (!(await urlOk(`${API}/health`))) {
    console.log('phase5kA: starting API dev server…');
    spawned.push(launch('api', NPM, ['run', 'dev', '--workspace', 'takeover-api'], AUDIT_CHAIN_ENV));
    if (!(await waitFor(`${API}/health`, 'api'))) throw new Error('API never healthy');
  } else {
    console.log('phase5kA: reusing already-running API (will not kill it; chain env may differ)');
  }

  console.log('phase5kA: seeding escrow fixtures + minting buyer/provider sessions…');
  const seedOut = await run(NPX, ['tsx', 'scripts/audit/seed-phase5.ts', '--mint-session'], true);
  const buyer = JSON.parse(seedOut.slice(seedOut.indexOf('{'))).cookie;
  const provOut = await run(NPX, ['tsx', 'scripts/audit/seed-phase5.ts', '--mint-provider-session'], true);
  const provider = JSON.parse(provOut.slice(provOut.indexOf('{'))).cookie;
  const BUYER_COOKIE = `${buyer.name}=${buyer.value}`;
  const PROVIDER_COOKIE = `${provider.name}=${provider.value}`;
  const CLAIM = '55555555-5555-4522-8522-000000000002';
  const SLOT = '44444444-4444-4422-8422-000000000002';

  // Readiness probe: the funded fixture exercises the chain-client read
  // path. Abort LOUDLY rather than capturing an error panel and calling
  // it a state.
  {
    const res = await fetch(`${API}/api/v1/claims/${CLAIM}/escrow`, { headers: { cookie: BUYER_COOKIE } });
    const body = await res.json().catch(() => null);
    const got = body?.data?.escrow?.status;
    console.log(`phase5kA: readiness probe escrow status = ${got}`);
    if (got !== 'funded') throw new Error(`readiness probe failed (got ${got})`);
  }

  console.log('phase5kA: registering audit users…');
  const fresh = await registerAuditUser('f');
  const onboarded = await registerAuditUser('o');
  await markOnboarded(onboarded.cookie);
  console.log(`phase5kA: audit users ready (public handle: ${onboarded.username})`);

  if (!(await urlOk(`${WEB}/`))) {
    console.log('phase5kA: starting web dev server…');
    spawned.push(launch('web', NPM, ['run', 'dev', '--workspace', 'takeover-web']));
    if (!(await waitFor(`${WEB}/`, 'web'))) throw new Error('web never healthy');
  } else {
    console.log('phase5kA: reusing already-running web server (will not kill it)');
  }

  // [key, route, states, ready, cookie|null]
  const TARGETS = [
    ['home', '/?desktop=1', 'default', 'a[href^="/slot/"]', null],
    ['openings', '/openings?desktop=1', 'default', 'a[href^="/slot/"]', null],
    ['slot', `/slot/${SLOT}?desktop=1`, 'default', null, null],
    ['welcome', '/welcome?desktop=1', 'default', 'text:Get started', null],
    ['login', '/login?desktop=1', 'default', 'text:Sign in', null],
    ['onboarding-account', '/onboarding/account?desktop=1', 'default', 'text:Continue with wallet', null],
    ['onboarding-profile', '/onboarding/profile?desktop=1', 'default', 'text:Full name', fresh.cookie],
    ['onboarding-interests', '/onboarding/interests?desktop=1', 'default', null, fresh.cookie],
    ['profile', '/profile?desktop=1', 'default', 'section[aria-label="Wallet"]', onboarded.cookie],
    ['claims', '/claims?desktop=1', 'default', 'text:My holds', onboarded.cookie],
    ['notifications', '/notifications?desktop=1', 'default', 'text:Notifications', onboarded.cookie],
    ['sell', '/sell?desktop=1', 'default', 'text:My openings', PROVIDER_COOKIE],
    ['sell-new', '/sell/new?desktop=1', 'default', 'text:New opening', onboarded.cookie],
    ['sell-detail', `/sell/${SLOT}?desktop=1`, 'default', null, PROVIDER_COOKIE],
    ['claim', `/claim/${CLAIM}?desktop=1`, 'default', null, BUYER_COOKIE],
  ];

  const merged = [];
  for (const [key, route, states, ready, cookie] of TARGETS) {
    const sub = join(OUT, key);
    console.log(`phase5kA: auditing ${key} (${route})…`);
    const args = [
      'scripts/audit/audit.mjs',
      '--route', route,
      '--viewports', VIEWPORTS,
      '--states', states,
      '--out', sub,
    ];
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

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'report.json'),
    JSON.stringify({ at: new Date().toISOString(), results: merged }, null, 2),
  );
  const failed = merged.filter((r) => !r.pass);
  console.log(`phase5kA: done. ${merged.length - failed.length}/${merged.length} pass.`);
  for (const f of failed) {
    console.log(`  FAIL ${f.route} @ ${f.viewport}: contrast=${f.contrastFails} touch=${f.touchFails} overflow=${f.overflow}`);
  }

  console.log('phase5kA: revoking sessions…');
  await run(NPX, ['tsx', 'scripts/audit/seed-phase5.ts', '--revoke-sessions'], true);
  for (const cookie of [fresh.cookie, onboarded.cookie]) {
    await fetch(`${API}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie, origin: WEB, 'X-Takeover-Client': 'web', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
  }
  exitCode = failed.length > 0 ? 1 : 0;
} catch (err) {
  console.error(`phase5kA: FATAL: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  for (const child of spawned.reverse()) {
    await killTree(child);
  }
  console.log('phase5kA: teardown complete (audit users retained for the phase-end cleanup)');
}
process.exit(exitCode);
