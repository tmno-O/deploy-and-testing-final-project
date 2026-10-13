const token = require('../services/token');
const { unauthorized } = require('../errors');

function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, value] = header.split(' ');
  if (scheme !== 'Bearer' || !value) {
    return next(unauthorized('Missing or malformed Authorization header'));
  }
  try {
    const payload = token.verify(value);
    req.auth = { userId: payload.sub };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(unauthorized('Token expired', 'TOKEN_EXPIRED'));
    }
    return next(unauthorized('Invalid token', 'INVALID_TOKEN'));
  }
}

module.exports = { requireAuth };
