// endpoint สำหรับ service อื่น (Gacha ฯลฯ) ใช้ X-Service-Key เท่านั้น
const router = require('express').Router();
const asyncHandler = require('../middleware/async');
const { requireService } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { callContext } = require('../middleware/requestId');
const schemas = require('../schemas');
const collectionService = require('../services/collectionService');

router.use(requireService);

router.post(
  '/collections/:userId/cards',
  validate(schemas.userIdParam, 'params'),
  validate(schemas.addCard),
  asyncHandler(async (req, res) => {
    const { created, card } = await collectionService.addFromGacha(req.params.userId, req.body, callContext(req));
    res.status(created ? 201 : 200).json({ pullId: req.body.pullId, created, card });
  })
);

router.get(
  '/collections/:userId',
  validate(schemas.userIdParam, 'params'),
  validate(schemas.listCollection, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await collectionService.list(req.params.userId, req.query));
  })
);

module.exports = router;
