const router = require('express').Router();
const store = require('../store/jsonStore');

router.get('/', (_req, res) => res.json({ status: 'ok' }));

router.get('/ready', (_req, res) => {
  const ready = ['collections', 'pulls', 'orders'].every((k) => Array.isArray(store.data[k]));
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
});

module.exports = router;
