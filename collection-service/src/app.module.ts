import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClientsModule } from './clients/clients.module';
import { CollectionModule } from './collection/collection.module';
import { requestIdMiddleware } from './common/request-context';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { AppConfigModule } from './config/config.module';
import { FulfillmentModule } from './fulfillment/fulfillment.module';
import { HealthModule } from './health/health.module';
import { StoreModule } from './store/store.module';

@Module({
  imports: [
    // only used to load .env into process.env before AppConfigModule validates it
    ConfigModule.forRoot({ ignoreEnvVars: true, isGlobal: false }),
    AppConfigModule,
    StoreModule,
    ClientsModule,
    // per-IP limit for all routes (health is exempt); behind a gateway set TRUST_PROXY so the real IP is used
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [{ ttl: 60_000, limit: config.rateLimitPerMinute }],
    }),
    HealthModule,
    CollectionModule,
    FulfillmentModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes('*');
  }
}
