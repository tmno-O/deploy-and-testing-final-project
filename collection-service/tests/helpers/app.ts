import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config';
import { StoreService } from '../../src/store/store.service';

export interface TestApp {
  app: INestApplication;
  store: StoreService;
  /** the live config object; tests may change catalog / wallet settings and restore them afterwards */
  config: AppConfig;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  return { app, store: app.get(StoreService), config: app.get<AppConfig>(APP_CONFIG) };
}
