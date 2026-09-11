import { defineConfig } from 'drizzle-kit';

// Phase 1: Drizzle config + empty schema only.
// No domain tables and no live connection yet (Phase 2).
export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema',
  out: './db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
