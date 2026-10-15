// Shared by db-migrate.ts / db-seed.ts: builds a pg Pool from DATABASE_URL (same ssl rules as the service).
import 'dotenv/config';
import { Pool } from 'pg';
import { parseDatabase } from '../../src/config/app-config';
import { buildPoolConfig } from '../../src/database/database.service';

export function connect(): Pool {
  const db = parseDatabase(process.env);
  if (!db) throw new Error('DATABASE_URL is not set (see .env.example)');
  return new Pool(buildPoolConfig(db));
}
