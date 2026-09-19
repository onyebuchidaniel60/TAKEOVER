import { defineConfig } from 'drizzle-kit';

// Drizzle-kit config: reads ./db/schema, writes ./db/migrations.
export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema',
  out: './db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
