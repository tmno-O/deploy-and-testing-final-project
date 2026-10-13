const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { unauthorized } = require('../errors');

// ผู้ใช้: JWT จาก user-service (HS256, iss ต้องตรง)
function requireUser(req, _res, next) {
  const [scheme, value] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !value) {
    return next(unauthorized('Missing or malformed Authorization header'));
  }
  try {
    const payload = jwt.verify(value, config.jwt.secret, {
      algorithms: ['HS256'],
      issuer: config.jwt.issuer,
    });
    if (!payload.sub) return next(unauthorized('Invalid token', 'INVALID_TOKEN'));
    req.auth = { userId: payload.sub };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(unauthorized('Token expired', 'TOKEN_EXPIRED'));
    }
    return next(unauthorized('Invalid token', 'INVALID_TOKEN'));
  }
}

// hash ก่อนเทียบ ทำให้ความยาวเท่ากันเสมอและไม่รั่วความยาวของ key ผ่านเวลาที่ใช้
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Bearer ของผู้ใช้ไม่ถูกนับ: ต้องมี key ที่ถูกต้องเท่านั้น
const requireKey = (header, getExpected, label) => (req, _res, next) => {
  const provided = req.get(header);
  if (!provided) return next(unauthorized(`${header} header required`));
  if (!safeEqual(provided, getExpected())) return next(unauthorized(`Invalid ${label} key`, 'INVALID_API_KEY'));
  req.auth = { caller: label };
  return next();
};

const requireService = requireKey('X-Service-Key', () => config.serviceApiKey, 'service');
const requireAdmin = requireKey('X-Admin-Key', () => config.adminApiKey, 'admin');

module.exports = { requireUser, requireService, requireAdmin, safeEqual };
