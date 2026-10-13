const router = require('express').Router();
const asyncHandler = require('../middleware/async');
const { validate } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const schemas = require('../schemas');
const password = require('../services/password');
const tokenService = require('../services/token');
const userRepo = require('../repositories/userRepo');
const { unauthorized } = require('../errors');

const authResponse = (user) => {
  const { token, expiresIn } = tokenService.sign(user.id);
  return { user, accessToken: token, tokenType: 'Bearer', expiresIn };
};

router.post(
  '/register',
  authLimiter,
  validate(schemas.register),
  asyncHandler(async (req, res) => {
    const { email, password: plain, firstName, lastName, displayName } = req.body;
    const passwordHash = await password.hash(plain);
    const user = await userRepo.create({ email, passwordHash, firstName, lastName, displayName });
    res.status(201).json(authResponse(user));
  })
);

router.post(
  '/login',
  authLimiter,
  validate(schemas.login),
  asyncHandler(async (req, res) => {
    const { email, password: plain } = req.body;
    const row = await userRepo.findCredentialsByEmail(email);
    // ตอบข้อความเดียวกันทั้งกรณีไม่พบอีเมลและรหัสผ่านผิด
    const ok = row ? await password.verify(row.passwordHash, plain) : await password.verifyDummy(plain);
    if (!ok) throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');

    const user = await userRepo.findById(row.id);
    res.json(authResponse(user));
  })
);

module.exports = router;
