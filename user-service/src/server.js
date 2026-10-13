const config = require('./config');
const { createApp } = require('./app');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[user-service] listening on :${config.port} (${config.env})`);
  console.log(`[user-service] data file: ${config.data.file} (persist: ${config.data.persist})`);
});

function shutdown(signal) {
  console.log(`[user-service] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
