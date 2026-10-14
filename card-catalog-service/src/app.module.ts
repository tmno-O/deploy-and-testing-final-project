import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { CardsModule } from './cards/cards.module';
import { CatalogModule } from './catalog/catalog.module';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { PacksModule } from './packs/packs.module';
import { StoreModule } from './store/store.module';

@Module({
  imports: [
    // only used to load .env into process.env before AppConfigModule validates it
    ConfigModule.forRoot({ ignoreEnvVars: true, isGlobal: false }),
    AppConfigModule,
    StoreModule,
    // per-IP limit for all public routes (health is exempt); behind a gateway set TRUST_PROXY so the real IP is used
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [{ ttl: 60_000, limit: config.rateLimitPerMinute }],
    }),
    CatalogModule,
    HealthModule,
    CardsModule,
    PacksModule,
    InventoryModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
