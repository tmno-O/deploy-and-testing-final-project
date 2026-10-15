import { Inject, Injectable } from '@nestjs/common';
import { AppError, unavailable } from '../common/app-error';
import type { CallContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { PaymentStatus } from '../store/types';
import { upstreamRequest } from './http-client';

const CODE = 'WALLET_SERVICE_UNAVAILABLE';

export interface PaymentResult {
  status: PaymentStatus;
  transactionId: string | null;
}

@Injectable()
export class WalletClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Off until WALLET_ENABLED=true: the wallet is never called and shipping is treated as not charged. */
  isEnabled(): boolean {
    return this.config.wallet.enabled;
  }

  /** idempotencyKey = orderId, so a retry never charges twice. */
  async charge(userId: string, amount: number, orderId: string, ctx: CallContext = {}): Promise<PaymentResult> {
    if (!this.isEnabled()) return { status: 'NOT_REQUIRED', transactionId: null };
    const transactionId = await this.call(
      `/internal/wallets/${encodeURIComponent(userId)}/charge`,
      { amount, reason: `Shipping fee for order ${orderId}`, idempotencyKey: orderId },
      ctx,
    );
    return { status: 'PAID', transactionId };
  }

  async refund(userId: string, amount: number, orderId: string, ctx: CallContext = {}): Promise<PaymentResult> {
    if (!this.isEnabled()) return { status: 'NOT_REQUIRED', transactionId: null };
    const transactionId = await this.call(
      `/internal/wallets/${encodeURIComponent(userId)}/refund`,
      { amount, idempotencyKey: `refund-${orderId}` },
      ctx,
    );
    return { status: 'REFUNDED', transactionId };
  }

  private async call(path: string, body: object, ctx: CallContext): Promise<string> {
    const { status, body: res } = await upstreamRequest({
      baseUrl: this.config.wallet.url,
      path,
      method: 'POST',
      headers: { 'X-Internal-Key': this.config.internalApiKey },
      body,
      timeoutMs: this.config.wallet.timeoutMs,
      requestId: ctx.requestId,
      unavailableCode: CODE,
    });
    const transactionId = (res as { transactionId?: unknown } | null)?.transactionId;
    if ((status === 200 || status === 201) && typeof transactionId === 'string') return transactionId;
    if (status === 402) {
      throw new AppError(402, 'INSUFFICIENT_BALANCE', 'Not enough wallet balance to pay the shipping fee');
    }
    throw unavailable(CODE, `Unexpected response from wallet service (${status})`);
  }
}
