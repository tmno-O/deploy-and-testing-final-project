import { Body, Controller, Get, Headers, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { parseOrThrow, uuidSchema } from '../common/parse';
import { respond } from './operation-response';
import { resolveIdempotencyKey, topupSchema, transactionsQuerySchema } from './wallet.schemas';
import { WalletService } from './wallet.service';

/** What a signed-in user does with their own wallet. The user id always comes from the JWT, never from the URL. */
@Controller('wallets')
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  /** Public: which payment methods and amounts the top-up form can offer. */
  @Get('topup-methods')
  topupMethods() {
    return this.wallets.topupOptions();
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  balance(@CurrentUser() userId: string) {
    return this.wallets.getWallet(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/transactions')
  history(@CurrentUser() userId: string, @Query() query: unknown) {
    return this.wallets.listTransactions(userId, parseOrThrow(transactionsQuerySchema, query));
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/transactions/:id')
  transaction(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.wallets.getTransaction(userId, parseOrThrow(uuidSchema('transaction id'), id));
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/topups')
  async topup(
    @CurrentUser() userId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') header: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseOrThrow(topupSchema, body);
    const key = resolveIdempotencyKey(header, input.idempotencyKey);
    return respond(res, await this.wallets.topup(userId, { amount: input.amount, method: input.method, key }));
  }
}
