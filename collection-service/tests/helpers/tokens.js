const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SECRET = () => process.env.JWT_SECRET;

// ออก token แบบเดียวกับ user-service
const sign = (userId, options = {}) =>
  jwt.sign({}, SECRET(), { algorithm: 'HS256', subject: userId, issuer: 'user-service', expiresIn: '1h', ...options });

const newUserId = () => crypto.randomUUID();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const serviceKey = () => ({ 'X-Service-Key': process.env.SERVICE_API_KEY });
const adminKey = () => ({ 'X-Admin-Key': process.env.ADMIN_API_KEY });

// token ที่ไม่ควรผ่าน
const expired = (userId) => sign(userId, { expiresIn: -10 });
const wrongIssuer = (userId) => sign(userId, { issuer: 'someone-else' });
const wrongSignature = (userId) =>
  jwt.sign({}, 'another-secret-another-secret-123456', { algorithm: 'HS256', subject: userId, issuer: 'user-service' });
const algNone = (userId) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId, iss: 'user-service' })}.`;
};

module.exports = { sign, newUserId, bearer, serviceKey, adminKey, expired, wrongIssuer, wrongSignature, algNone };
