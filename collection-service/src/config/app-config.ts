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
  rateLimitPerMinute: number;
  shipping: { flatFee: number; freeMinCards: number; maxCardsPerOrder: number };
  userService: { url: string; timeoutMs: number };
  catalog: { url: string; timeoutMs: number };
  wallet: { enabled: boolean; url: string; timeoutMs: number };
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

  const walletEnabled = env.WALLET_ENABLED === 'true';
  const walletUrl = env.WALLET_SERVICE_URL || '';
  if (walletEnabled && !walletUrl) throw new Error('WALLET_SERVICE_URL is required when WALLET_ENABLED=true');

  return {
    env: nodeEnv,
    port: parseInt(env, 'PORT', 3005),
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
    shipping: {
      flatFee: parseInt(env, 'SHIPPING_FLAT_FEE', 50, 0),
      freeMinCards: parseInt(env, 'FREE_SHIPPING_MIN_CARDS', 5),
      maxCardsPerOrder: parseInt(env, 'MAX_CARDS_PER_ORDER', 50),
    },
    userService: {
      url: env.USER_SERVICE_URL || 'http://localhost:3001',
      timeoutMs: parseInt(env, 'USER_SERVICE_TIMEOUT_MS', 3000),
    },
    // empty URL = catalog disabled: card details come from the Gacha payload
    catalog: { url: env.CATALOG_SERVICE_URL || '', timeoutMs: parseInt(env, 'CATALOG_SERVICE_TIMEOUT_MS', 3000) },
    wallet: { enabled: walletEnabled, url: walletUrl, timeoutMs: parseInt(env, 'WALLET_SERVICE_TIMEOUT_MS', 3000) },
  };
}
