const router = require('express').Router();
const asyncHandler = require('../middleware/async');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../schemas');
const password = require('../services/password');
const userRepo = require('../repositories/userRepo');
const addressRoutes = require('./addresses');
const { unauthorized } = require('../errors');

router.use(requireAuth);

// token ยังไม่หมดอายุแต่ผู้ใช้ไม่มีในระบบแล้ว -> 401
const gone = () => unauthorized('User no longer exists', 'INVALID_TOKEN');

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = await userRepo.findById(req.auth.userId);
    if (!user) throw gone();
    res.json({ user });
  })
);

router.patch(
  '/me',
  validate(schemas.updateProfile),
  asyncHandler(async (req, res) => {
    const user = await userRepo.update(req.auth.userId, req.body);
    if (!user) throw gone();
    res.json({ user });
  })
);

router.put(
  '/me/password',
  validate(schemas.changePassword),
  asyncHandler(async (req, res) => {
    const row = await userRepo.findCredentialsById(req.auth.userId);
    if (!row) throw gone();
    const ok = await password.verify(row.passwordHash, req.body.currentPassword);
    if (!ok) throw unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
    await userRepo.updatePassword(row.id, await password.hash(req.body.newPassword));
    res.status(204).end();
  })
);

router.use('/me/addresses', addressRoutes);

module.exports = router;
