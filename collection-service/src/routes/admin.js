const router = require('express').Router();
const asyncHandler = require('../middleware/async');
const { requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { callContext } = require('../middleware/requestId');
const schemas = require('../schemas');
const fulfillmentService = require('../services/fulfillmentService');

router.use(requireAdmin);

router.patch(
  '/fulfillments/orders/:id/status',
  validate(schemas.orderIdParam, 'params'),
  validate(schemas.updateStatus),
  asyncHandler(async (req, res) => {
    res.json({ order: await fulfillmentService.adminUpdateStatus(req.params.id, req.body, callContext(req)) });
  })
);

module.exports = router;
