/**
 * Middleware ตรวจ JWT ที่ออกโดย User Service
 * ให้เพื่อนในทีม (Wallet, Catalog, Gacha, Collection) copy ไปใช้ได้เลย
 *
 * ติดตั้ง:  npm i jsonwebtoken
 * env ที่ต้องตั้ง: JWT_SECRET (ค่าเดียวกับ User Service), JWT_ISSUER (default "user-service")
 *
 * ใช้งาน:
 *   const { requireAuth } = require('./jwt-verify-middleware');
 *   app.get('/wallet', requireAuth, (req, res) => res.json({ userId: req.auth.userId }));
 *
 * หมายเหตุ: ถ้าต้องดึงที่อยู่จัดส่ง (Fulfillment Service) ให้ส่งต่อ header Authorization
 * ของผู้ใช้ไปเรียก  GET {USER_SERVICE_URL}/users/me/addresses/:id
 */
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' } });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'user-service',
    });
    req.auth = { userId: payload.sub };
    return next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    return res.status(401).json({ error: { code, message: code === 'TOKEN_EXPIRED' ? 'Token expired' : 'Invalid token' } });
  }
}

module.exports = { requireAuth };
