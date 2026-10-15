// Applies db/schema.sql (idempotent: create ... if not exists). Usage: npm run db:migrate
import * as fs from 'fs';
import * as path from 'path';
import { connect } from './lib/db';

async function main(): Promise<void> {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const pool = connect();
  try {
    await pool.query(sql);
    console.log('schema applied');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
