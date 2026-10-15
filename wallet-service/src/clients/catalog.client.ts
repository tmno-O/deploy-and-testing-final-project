import { Inject, Injectable } from '@nestjs/common';
import { unavailable, unprocessable } from '../common/app-error';
import type { CallContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { upstreamRequest } from './http-client';

const CODE = 'CATALOG_SERVICE_UNAVAILABLE';

export interface PackInfo {
  id: string;
  name: string;
  /** price in whole credits, exactly as card-catalog-service publishes it */
  priceCredits: number;
}

@Injectable()
export class CatalogClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * The catalog is the only place a pack price comes from: the wallet never trusts a price sent by the caller
   * and never keeps its own copy. Active packs only (the catalog answers 404 for inactive ones).
   */
  async getPack(packId: string, ctx: CallContext = {}): Promise<PackInfo> {
    if (!this.config.catalog.url) throw unavailable(CODE, 'CATALOG_SERVICE_URL is not configured');

    const { status, body } = await upstreamRequest({
      baseUrl: this.config.catalog.url,
      path: `/packs/${encodeURIComponent(packId)}`,
      timeoutMs: this.config.catalog.timeoutMs,
      requestId: ctx.requestId,
      unavailableCode: CODE,
    });

    if (status === 404) throw unprocessable('PACK_NOT_FOUND', `Pack "${packId}" does not exist or is not on sale`);

    const pack = body as Partial<PackInfo> | null;
    if (
      status !== 200 ||
      !pack ||
      typeof pack.id !== 'string' ||
      typeof pack.name !== 'string' ||
      typeof pack.priceCredits !== 'number' ||
      !Number.isInteger(pack.priceCredits) ||
      pack.priceCredits < 1
    ) {
      throw unavailable(CODE, `Unexpected response from catalog service (${status})`);
    }
    return { id: pack.id, name: pack.name, priceCredits: pack.priceCredits };
  }
}
