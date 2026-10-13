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

const env = process.env.NODE_ENV || 'development';
const jwtSecret = required('JWT_SECRET');

if (env === 'production' && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

module.exports = {
  env,
  port: parseInt(process.env.PORT || '3001', 10),
  data: {
    file: process.env.DATA_FILE
      ? path.resolve(process.env.DATA_FILE)
      : path.join(__dirname, '..', 'data', 'mock-data.json'),
    // เขียนการเปลี่ยนแปลงกลับไฟล์ JSON (ปิดเองตอนรัน test)
    persist: process.env.PERSIST_DATA ? process.env.PERSIST_DATA === 'true' : env !== 'test',
  },
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  corsOrigin: (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()),
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    issuer: process.env.JWT_ISSUER || 'user-service',
  },
  rateLimit: {
    enabled: env !== 'test',
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '20', 10),
  },
};
