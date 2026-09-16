import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Test-infrastructure chore: Supabase Supavisor (session mode) caps this
    // tier at 15 concurrent sessions, and every fork worker is a separate
    // process holding its own pg Pool (never closed). Bound each fork's
    // pool to 3 so peak server sessions stay below 15 with margin
    // (3 default forks x 3 = 9 < 15 on a 4-CPU runner; revisit if runner
    // hardware or the suite outgrows this headroom). Default pool max (10)
    // is unchanged outside test mode; see PGPOOL_MAX in db/client.ts.
    env: {
      PGPOOL_MAX: '3',
    },
  },
});
