import * as path from 'path';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  env: string;
  port: number;
  data: { file: string; persist: boolean };
  trustProxy: boolean | number | string;
  corsOrigin: string[];
  jwt: { secret: string; issuer: string };
  internalApiKey: string;
  adminUserIds: string[];
  reservationTtlMs: number;
  reservationSweepMs: number;
  rateLimitPerMinute: number;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (!value) return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value === 'true';
}

function parsePositiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

/** Reads and validates the environment. Throws (fails fast at boot) on missing or weak secrets. */
export function loadConfig(env: Env = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV || 'development';
  const jwtSecret = required(env, 'JWT_SECRET');
  const internalApiKey = required(env, 'INTERNAL_API_KEY');

  if (nodeEnv === 'production') {
    if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
    if (internalApiKey.length < 32) {
      throw new Error('INTERNAL_API_KEY must be at least 32 characters in production');
    }
  }

  return {
    env: nodeEnv,
    port: parsePositiveInt(env, 'PORT', 3003),
    data: {
      file: env.DATA_FILE
        ? path.resolve(env.DATA_FILE)
        : path.join(process.cwd(), 'data', 'mock-data.json'),
      // write changes back to the JSON file (disabled in tests)
      persist: env.PERSIST_DATA ? env.PERSIST_DATA === 'true' : nodeEnv !== 'test',
    },
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    corsOrigin: parseList(env.CORS_ORIGIN || '*'),
    jwt: { secret: jwtSecret, issuer: env.JWT_ISSUER || 'user-service' },
    internalApiKey,
    adminUserIds: parseList(env.ADMIN_USER_IDS),
    reservationTtlMs: parsePositiveInt(env, 'RESERVATION_TTL_SECONDS', 600) * 1000,
    reservationSweepMs: parsePositiveInt(env, 'RESERVATION_SWEEP_SECONDS', 30) * 1000,
    rateLimitPerMinute: parsePositiveInt(env, 'RATE_LIMIT_PER_MINUTE', 300),
  };
}
