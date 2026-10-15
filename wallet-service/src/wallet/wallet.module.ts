import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { AdminWalletController } from './admin.controller';
import { InternalWalletController } from './internal.controller';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [PaymentsModule],
  controllers: [WalletController, InternalWalletController, AdminWalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
