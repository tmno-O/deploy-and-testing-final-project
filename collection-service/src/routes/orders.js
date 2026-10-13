const router = require('express').Router();
const asyncHandler = require('../middleware/async');
const { requireUser } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { callContext } = require('../middleware/requestId');
const schemas = require('../schemas');
const fulfillmentService = require('../services/fulfillmentService');

router.use(requireUser);

router.post(
  '/',
  validate(schemas.createOrder),
  asyncHandler(async (req, res) => {
    res.status(201).json({ order: await fulfillmentService.create(req.auth.userId, req.body, callContext(req)) });
  })
);

router.get(
  '/',
  validate(schemas.listOrders, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await fulfillmentService.list(req.auth.userId, req.query));
  })
);

router.get(
  '/:id',
  validate(schemas.orderIdParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ order: await fulfillmentService.getOwned(req.auth.userId, req.params.id) });
  })
);

router.post(
  '/:id/cancel',
  validate(schemas.orderIdParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ order: await fulfillmentService.cancel(req.auth.userId, req.params.id, callContext(req)) });
  })
);

module.exports = router;
