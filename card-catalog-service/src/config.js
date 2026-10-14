const path = require('path');
require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseTrustProxy(value) {
  if (!value) return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value === 'true';
}

function parseList(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const env = process.env.NODE_ENV || 'development';
const jwtSecret = required('JWT_SECRET');
const internalApiKey = required('INTERNAL_API_KEY');

if (env === 'production') {
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
  if (internalApiKey.length < 32) {
    throw new Error('INTERNAL_API_KEY must be at least 32 characters in production');
  }
}

module.exports = {
  env,
  port: parseInt(process.env.PORT || '3003', 10),
  data: {
    file: process.env.DATA_FILE
      ? path.resolve(process.env.DATA_FILE)
      : path.join(__dirname, '..', 'data', 'mock-data.json'),
    // write changes back to the JSON file (disabled in tests)
    persist: process.env.PERSIST_DATA ? process.env.PERSIST_DATA === 'true' : env !== 'test',
  },
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  corsOrigin: parseList(process.env.CORS_ORIGIN || '*'),
  jwt: {
    secret: jwtSecret,
    issuer: process.env.JWT_ISSUER || 'user-service',
  },
  internalApiKey,
  adminUserIds: parseList(process.env.ADMIN_USER_IDS),
  reservationTtlMs: parseInt(process.env.RESERVATION_TTL_SECONDS || '600', 10) * 1000,
};
