const rateLimit = require('express-rate-limit');
const config = require('../config');

const passthrough = (_req, _res, next) => next();

const authLimiter = config.rateLimit.enabled
  ? rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) =>
        res.status(429).json({
          error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, please try again later' },
        }),
    })
  : passthrough;

module.exports = { authLimiter };
