const path = require('path');
require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

const env = process.env.NODE_ENV || 'development';
const jwtSecret = required('JWT_SECRET');
const serviceApiKey = required('SERVICE_API_KEY');
const adminApiKey = required('ADMIN_API_KEY');

if (env === 'production') {
  for (const [name, value] of Object.entries({
    JWT_SECRET: jwtSecret,
    SERVICE_API_KEY: serviceApiKey,
    ADMIN_API_KEY: adminApiKey,
  })) {
    if (value.length < 32) throw new Error(`${name} must be at least 32 characters in production`);
  }
}

const walletEnabled = process.env.WALLET_ENABLED === 'true';
const walletUrl = process.env.WALLET_SERVICE_URL || '';
if (walletEnabled && !walletUrl) {
  throw new Error('WALLET_SERVICE_URL is required when WALLET_ENABLED=true');
}

// ทุกค่าอ่านจาก object นี้ตอนใช้งาน (ไม่ copy ไปเก็บ) เทสจึงสลับค่าได้ เช่นเปิด/ปิด Catalog
module.exports = {
  env,
  port: int('PORT', 3005),
  data: {
    file: process.env.DATA_FILE
      ? path.resolve(process.env.DATA_FILE)
      : path.join(__dirname, '..', 'data', 'mock-data.json'),
    // เขียนการเปลี่ยนแปลงกลับไฟล์ JSON (ปิดเองตอนรัน test)
    persist: process.env.PERSIST_DATA ? process.env.PERSIST_DATA === 'true' : env !== 'test',
  },
  corsOrigin: (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()),
  jwt: {
    secret: jwtSecret,
    issuer: process.env.JWT_ISSUER || 'user-service',
  },
  serviceApiKey,
  adminApiKey,
  shipping: {
    flatFee: int('SHIPPING_FLAT_FEE', 50),
    freeMinCards: int('FREE_SHIPPING_MIN_CARDS', 5),
    maxCardsPerOrder: int('MAX_CARDS_PER_ORDER', 50),
  },
  userService: {
    url: process.env.USER_SERVICE_URL || 'http://localhost:3001',
    timeoutMs: int('USER_SERVICE_TIMEOUT_MS', 3000),
  },
  catalog: {
    url: process.env.CATALOG_SERVICE_URL || '', // ว่าง = ปิด ใช้ข้อมูลการ์ดที่ Gacha ส่งมา
    timeoutMs: int('CATALOG_SERVICE_TIMEOUT_MS', 3000),
  },
  wallet: {
    enabled: walletEnabled,
    url: walletUrl,
    timeoutMs: int('WALLET_SERVICE_TIMEOUT_MS', 3000),
  },
};
