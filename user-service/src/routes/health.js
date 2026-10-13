const router = require('express').Router();
const store = require('../store');

router.get('/', (_req, res) => res.json({ status: 'ok' }));

router.get('/ready', (_req, res) => {
  const ready = Array.isArray(store.data.users) && Array.isArray(store.data.addresses);
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
});

module.exports = router;
