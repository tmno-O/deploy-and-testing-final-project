const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { requestId } = require('./middleware/requestId');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(helmet());
  app.use(cors({
    origin: config.corsOrigin.includes('*') ? true : config.corsOrigin,
    exposedHeaders: ['X-Request-Id'],
  }));
  app.use(express.json({ limit: '10kb' }));

  app.use('/health', require('./routes/health'));
  app.use('/collections', require('./routes/collections'));
  app.use('/fulfillments/orders', require('./routes/orders'));
  app.use('/internal', require('./routes/internal'));
  app.use('/admin', require('./routes/admin'));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
