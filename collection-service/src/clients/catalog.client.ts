import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { unavailable, unprocessable } from '../common/app-error';
import type { CallContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { RARITIES, type CardInfo } from '../store/types';
import { upstreamRequest } from './http-client';

const CODE = 'CATALOG_SERVICE_UNAVAILABLE';

/** The fields we need from card-catalog-service `GET /cards/:id` (it returns the card object directly). */
const catalogCard = z.object({
  id: z.string(),
  name: z.string().min(1),
  rarity: z.enum(RARITIES),
  imageSmall: z.string().url(),
});

@Injectable()
export class CatalogClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Disabled while CATALOG_SERVICE_URL is empty: the card details sent by Gacha are used instead. */
  isEnabled(): boolean {
    return Boolean(this.config.catalog.url);
  }

  async getCard(cardId: string, ctx: CallContext = {}): Promise<CardInfo> {
    const { status, body } = await upstreamRequest({
      baseUrl: this.config.catalog.url,
      path: `/cards/${encodeURIComponent(cardId)}`,
      timeoutMs: this.config.catalog.timeoutMs,
      requestId: ctx.requestId,
      unavailableCode: CODE,
    });

    if (status === 404) throw unprocessable('CARD_NOT_FOUND', `Card ${cardId} does not exist in the catalog`);
    const parsed = status === 200 ? catalogCard.safeParse(body) : null;
    if (!parsed?.success) throw unavailable(CODE, `Unexpected response from catalog service (${status})`);
    return { cardId, cardName: parsed.data.name, cardRarity: parsed.data.rarity, cardImageUrl: parsed.data.imageSmall };
  }
}
