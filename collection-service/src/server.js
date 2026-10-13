const config = require('./config');
const { createApp } = require('./app');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[collection-service] listening on :${config.port} (${config.env})`);
  console.log(`[collection-service] data file: ${config.data.file} (persist: ${config.data.persist})`);
  console.log(`[collection-service] user-service: ${config.userService.url}`);
  console.log(`[collection-service] catalog: ${config.catalog.url || 'disabled'} · wallet: ${config.wallet.enabled ? config.wallet.url : 'disabled'}`);
});

function shutdown(signal) {
  console.log(`[collection-service] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
