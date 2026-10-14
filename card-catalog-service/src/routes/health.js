const router = require('express').Router();
const store = require('../store');

router.get('/', (_req, res) => res.json({ status: 'ok' }));

router.get('/ready', (_req, res) => {
  const ready = store.isReady();
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
});

module.exports = router;
