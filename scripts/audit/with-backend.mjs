// Audit with a live backend (Phase 3 pre-work).
//
// The plain audit script assumes a running web server and no API, so the
// feed always renders its error panel. This wrapper boots the real
// stack underneath the audit: API dev server + idempotent demo seed +
// web dev server, runs audit.mjs with the passthrough args, then tears
// down everything it spawned.
//
// Usage:
//   node scripts/audit/with-backend.mjs --route / --viewports 320,375,768,1280 \
//     --states default,loading,empty,error --out docs/redesign/audits/phase-3
// (every arg after the script path is forwarded to audit.mjs; the
// wrapper itself takes no flags.)
//
// Requirements:
//   DATABASE_URL must be set in the environment (the live dev DB).
//   Refuses to run without it — never falls back to mocks silently.
//
// Seed safety: db/seed.ts uses fixed UUIDs + onConflictDoNothing, so
// re-runs never duplicate. Seed rows carry SEED-marker wallets that can
// never authenticate (rejected by wallet canonicalization). Rows are
// left in place during the run (re-running is a no-op); the end-of-phase
// cleanup step (node scripts/db/cleanup-test-data.mjs) removes them from
// the shared DB afterwards — see the Phase 5d standing rule.
// Servers already listening before the run are reused, never killed.
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!process.env.DATABASE_URL) {
  console.error('with-backend: DATABASE_URL is not set — refusing (no mock fallback).');
  process.exit(2);
}

const auditArgs = process.argv.slice(2);

function urlOk(url) {
  return fetch(url, { method: 'GET' })
    .then((r) => r.ok)
    .catch(() => false);
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) {
      console.log(`with-backend: ${label} up (${url})`);
      return true;
    }
    await sleep(2000);
  }
  return false;
}

async function alreadyUp(url) {
  return urlOk(url);
}

function launch(label, cmd, args) {
  // Windows: .cmd shims require a shell (spawn EINVAL otherwise).
  // Teardown uses taskkill /T, which reaps the whole tree regardless.
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
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

function runAudit(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/audit/audit.mjs', ...args], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const spawned = [];
let exitCode = 0;
try {
  const apiUp = await alreadyUp('http://localhost:3001/health');
  if (!apiUp) {
    console.log('with-backend: starting API dev server…');
    spawned.push(launch('api', NPM, ['run', 'dev', '--workspace', 'takeover-api']));
    if (!(await waitFor('http://localhost:3001/health', 'api'))) {
      throw new Error('API dev server never became healthy');
    }
  } else {
    console.log('with-backend: reusing already-running API (will not kill it)');
  }

  console.log('with-backend: seeding demo fixtures (idempotent)…');
  const seed = launch('seed', NPM, ['run', 'db:seed']);
  const seedCode = await new Promise((resolve) => {
    seed.on('error', () => resolve(1));
    seed.on('exit', (code) => resolve(code ?? 1));
  });
  if (seedCode !== 0) throw new Error(`db:seed exited ${seedCode}`);

  const webUp = await alreadyUp('http://localhost:5173/');
  if (!webUp) {
    console.log('with-backend: starting web dev server…');
    spawned.push(launch('web', NPM, ['run', 'dev', '--workspace', 'takeover-web']));
    if (!(await waitFor('http://localhost:5173/', 'web'))) {
      throw new Error('web dev server never became healthy');
    }
  } else {
    console.log('with-backend: reusing already-running web server (will not kill it)');
  }

  console.log(`with-backend: running audit (args: ${auditArgs.join(' ') || '(defaults)'})`);
  exitCode = await runAudit(auditArgs);
} catch (err) {
  console.error(`with-backend: FATAL: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  for (const child of spawned.reverse()) {
    await killTree(child);
  }
  console.log('with-backend: teardown complete (spawned servers stopped; run scripts/db/cleanup-test-data.mjs at phase end to remove seed rows)');
}
process.exit(exitCode);
