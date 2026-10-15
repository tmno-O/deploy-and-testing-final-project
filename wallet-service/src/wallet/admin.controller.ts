import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/jwt-auth.guard';
import { parseOrThrow } from '../common/parse';
import { transactionsQuerySchema, userIdSchema } from './wallet.schemas';
import { WalletService } from './wallet.service';

/** Read-only support tools: look at any user's wallet and check that their ledger adds up. */
@UseGuards(AdminGuard)
@Controller('admin/wallets/:userId')
export class AdminWalletController {
  constructor(private readonly wallets: WalletService) {}

  @Get()
  wallet(@Param('userId') userId: string) {
    const user = parseOrThrow(userIdSchema, userId);
    return { ...this.wallets.getWallet(user), audit: this.wallets.audit(user) };
  }

  @Get('transactions')
  transactions(@Param('userId') userId: string, @Query() query: unknown) {
    return this.wallets.listTransactions(
      parseOrThrow(userIdSchema, userId),
      parseOrThrow(transactionsQuerySchema, query),
    );
  }
}
