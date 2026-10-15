import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { ServiceHttp } from './service-http';
import type { CollectionAddResult } from './types';

@Injectable()
export class CollectionClient {
  private readonly http: ServiceHttp;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.http = new ServiceHttp(
      'COLLECTION',
      config.services.collectionUrl,
      config.services.timeoutMs,
      config.internalApiKey,
    );
  }

  /** `pullId` is the idempotency key: retry with the same value, and use a different one per card. */
  addCard(userId: string, pullId: string, cardId: string, requestId?: string): Promise<CollectionAddResult> {
    return this.http.call({
      method: 'POST',
      path: `/internal/collections/${encodeURIComponent(userId)}/cards`,
      body: { pullId, cardId, quantity: 1 },
      internal: true,
      requestId,
    });
  }
}