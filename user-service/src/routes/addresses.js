const router = require('express').Router();
const asyncHandler = require('../middleware/async');
const { validate } = require('../middleware/validate');
const schemas = require('../schemas');
const addressRepo = require('../repositories/addressRepo');
const { notFound } = require('../errors');

const NOT_FOUND = () => notFound('Address not found', 'ADDRESS_NOT_FOUND');

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ addresses: await addressRepo.list(req.auth.userId) });
  })
);

router.post(
  '/',
  validate(schemas.createAddress),
  asyncHandler(async (req, res) => {
    res.status(201).json({ address: await addressRepo.create(req.auth.userId, req.body) });
  })
);

router.get(
  '/:id',
  validate(schemas.idParam, 'params'),
  asyncHandler(async (req, res) => {
    const address = await addressRepo.findById(req.auth.userId, req.params.id);
    if (!address) throw NOT_FOUND();
    res.json({ address });
  })
);

router.patch(
  '/:id',
  validate(schemas.idParam, 'params'),
  validate(schemas.updateAddress),
  asyncHandler(async (req, res) => {
    const address = await addressRepo.update(req.auth.userId, req.params.id, req.body);
    if (!address) throw NOT_FOUND();
    res.json({ address });
  })
);

router.delete(
  '/:id',
  validate(schemas.idParam, 'params'),
  asyncHandler(async (req, res) => {
    const removed = await addressRepo.remove(req.auth.userId, req.params.id);
    if (!removed) throw NOT_FOUND();
    res.status(204).end();
  })
);

module.exports = router;
