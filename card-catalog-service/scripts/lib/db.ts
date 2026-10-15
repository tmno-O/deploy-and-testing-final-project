// Shared by db-migrate.ts / db-seed.ts: builds a pg Pool from DATABASE_URL (same ssl rules as the service).
import { config } from 'dotenv';
import { Pool } from 'pg';
import { parseDatabase } from '../../src/config/app-config';
import { buildPoolConfig } from '../../src/database/database.service';

// the service's own .env wins; the repo-root .env (shared by docker compose) fills in anything missing
config({ path: ['.env', '../.env'], quiet: true });

export function connect(): Pool {
  const db = parseDatabase(process.env);
  if (!db) throw new Error('DATABASE_URL is not set (see .env.example)');
  return new Pool(buildPoolConfig(db));
}
