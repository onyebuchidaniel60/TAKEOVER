import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// Phase 1: lazy client factory only. Nothing in Phase 1 connects to the
// database — the API boots and GET /health works without DATABASE_URL.
// First real use arrives with Phase 2 (schema/migrations).
let db: NodePgDatabase | undefined;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb(): NodePgDatabase {
  if (db) {
    return db;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not configured. Set it in .env (see .env.example).');
  }
  db = drizzle(new Pool({ connectionString: url }));
  return db;
}
