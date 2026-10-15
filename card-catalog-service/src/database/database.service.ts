import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { APP_CONFIG, type AppConfig, type DatabaseConfig } from '../config/app-config';

/** Owns the PostgreSQL connection pool. `enabled` is false in JSON-file mode (no DATABASE_URL). */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool?: Pool;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return !!this.config.database;
  }

  private getPool(): Pool {
    const db = this.config.database;
    if (!db) throw new Error('DATABASE_URL is not configured');
    if (!this.pool) {
      this.pool = new Pool(buildPoolConfig(db));
      // an idle client dropping must not crash the process; the pool replaces it on the next checkout
      this.pool.on('error', () => undefined);
    }
    return this.pool;
  }

  query<T extends object = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
    return this.getPool()
      .query(text, values)
      .then((r) => r.rows as T[]);
  }

  /** Runs `fn` in one transaction (BEGIN ... COMMIT, ROLLBACK on error). */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('select 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}

export function buildPoolConfig(db: DatabaseConfig): PoolConfig {
  // sslmode in the URL would override the explicit `ssl` option below, so strip it
  const url = new URL(db.url);
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    max: db.poolMax,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ssl:
      db.ssl === 'disable'
        ? false
        : db.ssl === 'no-verify'
          ? { rejectUnauthorized: false }
          : { rejectUnauthorized: true, ca: db.sslCa },
  };
}
