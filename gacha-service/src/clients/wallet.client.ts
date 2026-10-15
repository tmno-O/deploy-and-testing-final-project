import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { ServiceHttp } from './service-http';
import type { WalletOperation } from './types';

@Injectable()
export class WalletClient {
  private readonly http: ServiceHttp;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.http = new ServiceHttp('WALLET', config.services.walletUrl, config.services.timeoutMs, config.internalApiKey);
  }

  /** Wallet reads the price from the catalog itself: we only send the packId. */
  purchase(userId: string, packId: string, idempotencyKey: string, requestId?: string): Promise<WalletOperation> {
    return this.http.call({
      method: 'POST',
      path: `/internal/wallets/${encodeURIComponent(userId)}/purchases`,
      body: { packId, idempotencyKey },
      internal: true,
      requestId,
    });
  }

  refund(
    userId: string,
    amount: number,
    transactionId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<WalletOperation> {
    return this.http.call({
      method: 'POST',
      path: `/internal/wallets/${encodeURIComponent(userId)}/refund`,
      body: { amount, transactionId, idempotencyKey, reason: 'Gacha pull failed' },
      internal: true,
      requestId,
    });
  }
}