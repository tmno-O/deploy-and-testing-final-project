import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { createPaymentProvider, PAYMENT_PROVIDER } from './payment-provider';

@Module({
  providers: [{ provide: PAYMENT_PROVIDER, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createPaymentProvider(config) }],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
