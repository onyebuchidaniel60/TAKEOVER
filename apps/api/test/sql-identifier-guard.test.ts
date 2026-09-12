// Phase 12 completion (F2): accepted drizzle-orm CVE risk
// (GHSA-gpj5-g38j-94v9), guarded. The CVE is unreachable only while no
// dynamic identifiers reach SQL, so this test fails the suite if any of the
// forbidden sinks appear in shipped server code or DB tooling. The primary
// enforcement is the ESLint no-restricted-syntax block in eslint.config.js
// (proven with a negative control during the phase); this grep runs inside
// `npm run test` too, so skipping lint cannot silently drop the guard.
// Allowed and still passing: static sql`` tagged templates (values stay
// parameterized) and db/verify.ts's static db.execute(sql`SELECT 1`)
// health check. Generated migrations are excluded by design (static DDL).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_SRC = resolve(process.cwd(), 'src');
const DB_DIR = resolve(process.cwd(), '../../db');

const FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /sql\.raw\(/, label: 'sql.raw(' },
  { pattern: /sql\.identifier\(/, label: 'sql.identifier(' },
  // .execute( is allowed only for a static sql`` tagged template argument.
  { pattern: /\.execute\(\s*(?!sql`)/, label: '.execute( with a non-sql`` argument' },
];

function collect(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'migrations' || entry === 'node_modules' || entry === 'dist') continue;
      collect(full, out);
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
}

describe('F2 guard: no dynamic SQL identifiers (no DB)', () => {
  it('forbids sql.raw / sql.identifier / unparameterized execute in src and db tooling', () => {
    const files: string[] = [];
    collect(API_SRC, files);
    collect(DB_DIR, files);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const { pattern, label } of FORBIDDEN) {
        if (pattern.test(text)) {
          // Filenames only — file contents never enter test output.
          offenders.push(`${file}: ${label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
