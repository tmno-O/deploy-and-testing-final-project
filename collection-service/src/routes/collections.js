const router = require('express').Router();
const asyncHandler = require('../middleware/async');
const { requireUser } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../schemas');
const collectionService = require('../services/collectionService');

router.use(requireUser);

router.get(
  '/me',
  validate(schemas.listCollection, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await collectionService.list(req.auth.userId, req.query));
  })
);

router.get(
  '/me/:cardId',
  validate(schemas.cardIdParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ card: await collectionService.get(req.auth.userId, req.params.cardId) });
  })
);

module.exports = router;
