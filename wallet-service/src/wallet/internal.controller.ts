import { Body, Controller, Get, Headers, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { InternalKeyGuard } from '../auth/internal-key.guard';
import { parseOrThrow } from '../common/parse';
import { Ctx, type CallContext } from '../common/request-context';
import { respond } from './operation-response';
import { chargeSchema, purchaseSchema, refundSchema, resolveIdempotencyKey, userIdSchema } from './wallet.schemas';
import { WalletService } from './wallet.service';

/**
 * Service-to-service API (X-Internal-Key). Never expose it to browsers.
 *  - gacha-service buys packs: `purchases` (and `refund` if it fails after paying)
 *  - collection-service pays the shipping fee: `charge` / `refund`
 */
@UseGuards(InternalKeyGuard)
@Controller('internal/wallets/:userId')
export class InternalWalletController {
  constructor(private readonly wallets: WalletService) {}

  @Get()
  balance(@Param('userId') userId: string) {
    return this.wallets.getWallet(parseOrThrow(userIdSchema, userId));
  }

  @Post('charge')
  async charge(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') header: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = parseOrThrow(userIdSchema, userId);
    const input = parseOrThrow(chargeSchema, body);
    const key = resolveIdempotencyKey(header, input.idempotencyKey);
    return respond(res, await this.wallets.charge(user, { amount: input.amount, reason: input.reason, key }));
  }

  @Post('purchases')
  async purchase(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') header: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @Ctx() ctx: CallContext,
  ) {
    const user = parseOrThrow(userIdSchema, userId);
    const input = parseOrThrow(purchaseSchema, body);
    const key = resolveIdempotencyKey(header, input.idempotencyKey);
    return respond(res, await this.wallets.purchasePack(user, { packId: input.packId, key }, ctx));
  }

  @Post('refund')
  async refund(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') header: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = parseOrThrow(userIdSchema, userId);
    const input = parseOrThrow(refundSchema, body);
    const key = resolveIdempotencyKey(header, input.idempotencyKey);
    return respond(
      res,
      await this.wallets.refund(user, {
        amount: input.amount,
        key,
        transactionId: input.transactionId,
        reason: input.reason,
      }),
    );
  }
}
