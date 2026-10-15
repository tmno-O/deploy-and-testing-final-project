import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { StoreModule } from './store/store.module';
import { ClientsModule } from './clients/clients.module';
import { PullsModule } from './pulls/pulls.module';

@Module({
  imports: [
    ConfigModule.forRoot({ ignoreEnvVars: true, isGlobal: false }),
    AppConfigModule,
    StoreModule,
    ClientsModule,
    PullsModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [{ ttl: 60_000, limit: config.rateLimitPerMinute }],
    }),
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}