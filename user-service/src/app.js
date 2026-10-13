const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin.includes('*') ? true : config.corsOrigin }));
  app.use(express.json({ limit: '10kb' }));

  app.use('/health', require('./routes/health'));
  app.use('/auth', require('./routes/auth'));
  app.use('/users', require('./routes/users'));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
