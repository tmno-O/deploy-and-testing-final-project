import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../src/payments/payment-provider';
import { StoreService } from '../../src/store/store.service';
import { WalletService } from '../../src/wallet/wallet.service';

export interface TestApp {
  app: INestApplication;
  store: StoreService;
  wallets: WalletService;
  /** the live config object; tests may change limits / catalog url and restore them afterwards */
  config: AppConfig;
}

export async function createTestApp(opts: { provider?: PaymentProvider } = {}): Promise<TestApp> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (opts.provider) builder.overrideProvider(PAYMENT_PROVIDER).useValue(opts.provider);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  return {
    app,
    store: app.get(StoreService),
    wallets: app.get(WalletService),
    config: app.get<AppConfig>(APP_CONFIG),
  };
}
