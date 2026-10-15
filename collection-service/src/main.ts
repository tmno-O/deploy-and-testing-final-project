import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { APP_CONFIG, type AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableShutdownHooks(); // graceful stop on SIGTERM / SIGINT

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port);

  const logger = new Logger('collection-service');
  logger.log(`listening on :${config.port} (${config.env})`);
  logger.log(`data file: ${config.data.file} (persist: ${config.data.persist})`);
  logger.log(`user-service: ${config.userService.url}`);
  logger.log(
    `catalog: ${config.catalog.url || 'disabled'} · wallet: ${config.wallet.enabled ? config.wallet.url : 'disabled'}`,
  );
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
