import * as path from 'path';

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Payment providers this build can actually talk to. A real gateway is added here once its credentials exist. */
export const SUPPORTED_PAYMENT_PROVIDERS = ['mock'] as const;

export interface AppConfig {
  env: string;
  port: number;
  data: { file: string; persist: boolean };
  trustProxy: boolean | number | string;
  corsOrigin: string[];
  jwt: { secret: string; issuer: string };
  internalApiKey: string;
  adminUserIds: string[];
  rateLimitPerMinute: number;
  /** card-catalog-service: the only source of pack prices. Empty url = pack purchases answer 503. */
  catalog: { url: string; timeoutMs: number };
  payment: {
    provider: string;
    topupMinAmount: number;
    topupMaxAmount: number;
    /** a wallet can never hold more than this (whole credits) */
    maxBalance: number;
  };
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

function parseInt(env: Env, name: string, fallback: number, min = 1): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
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

  const provider = env.PAYMENT_PROVIDER || 'mock';
  if (!(SUPPORTED_PAYMENT_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(
      `PAYMENT_PROVIDER "${provider}" is not supported (supported: ${SUPPORTED_PAYMENT_PROVIDERS.join(', ')})`,
    );
  }

  const topupMinAmount = parseInt(env, 'TOPUP_MIN_AMOUNT', 1);
  const topupMaxAmount = parseInt(env, 'TOPUP_MAX_AMOUNT', 100_000);
  const maxBalance = parseInt(env, 'MAX_BALANCE', 10_000_000);
  if (topupMinAmount > topupMaxAmount) throw new Error('TOPUP_MIN_AMOUNT must not be greater than TOPUP_MAX_AMOUNT');
  if (topupMaxAmount > maxBalance) throw new Error('TOPUP_MAX_AMOUNT must not be greater than MAX_BALANCE');

  return {
    env: nodeEnv,
    port: parseInt(env, 'PORT', 3002),
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
    rateLimitPerMinute: parseInt(env, 'RATE_LIMIT_PER_MINUTE', 300),
    // unset = local default, empty string = explicitly disabled
    catalog: {
      url: env.CATALOG_SERVICE_URL === undefined ? 'http://localhost:3003' : env.CATALOG_SERVICE_URL,
      timeoutMs: parseInt(env, 'CATALOG_SERVICE_TIMEOUT_MS', 3000),
    },
    payment: { provider, topupMinAmount, topupMaxAmount, maxBalance },
  };
}
