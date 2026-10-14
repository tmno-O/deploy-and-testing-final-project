import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { StoreModule } from './store/store.module';

@Module({
  imports: [
    // only used to load .env into process.env before AppConfigModule validates it
    ConfigModule.forRoot({ ignoreEnvVars: true, isGlobal: false }),
    AppConfigModule,
    StoreModule,
    HealthModule,
  ],
})
export class AppModule {}
