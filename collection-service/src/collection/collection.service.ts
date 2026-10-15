import { Injectable } from '@nestjs/common';
import { CatalogClient } from '../clients/catalog.client';
import { badRequest, conflict, notFound } from '../common/app-error';
import { idSchema, paginate, parseOrThrow } from '../common/parse';
import type { CallContext } from '../common/request-context';
import { StoreService } from '../store/store.service';
import type { CardInfo, PullRecord } from '../store/types';
import { CollectionRepository, toCardView, type CollectionCardView } from './collection.repository';
import { addCardBody, listCollectionQuery, userIdParam, type AddCardBody } from './collection.schemas';

const CARD_FIELDS = ['cardName', 'cardRarity', 'cardImageUrl'] as const;

export interface AddCardResult {
  pullId: string;
  created: boolean;
  card: CollectionCardView;
}

@Injectable()
export class CollectionService {
  constructor(
    private readonly store: StoreService,
    private readonly collections: CollectionRepository,
    private readonly catalog: CatalogClient,
  ) {}

  list(rawUserId: unknown, rawQuery: unknown) {
    const userId = parseOrThrow(userIdParam, rawUserId);
    const query = parseOrThrow(listCollectionQuery, rawQuery);
    return paginate(this.collections.listByUser(userId, query.rarity).map(toCardView), query);
  }

  /** For the logged-in user (their id comes from the JWT, not from input). */
  listMine(userId: string, rawQuery: unknown) {
    const query = parseOrThrow(listCollectionQuery, rawQuery);
    return paginate(this.collections.listByUser(userId, query.rarity).map(toCardView), query);
  }

  getMine(userId: string, rawCardId: unknown): CollectionCardView {
    const cardId = parseOrThrow(idSchema, rawCardId);
    const record = this.collections.find(userId, cardId);
    if (!record) throw notFound('Card not in collection');
    return toCardView(record);
  }

  /** Gacha adds a pulled card. The same pullId again is a retry: the first result is returned, nothing is added. */
  async addFromGacha(rawUserId: unknown, rawBody: unknown, ctx: CallContext): Promise<AddCardResult> {
    const userId = parseOrThrow(userIdParam, rawUserId);
    const body = parseOrThrow(addCardBody, rawBody);

    const existing = this.collections.findPull(body.pullId);
    if (existing) return this.replay(existing, userId, body);

    // call the catalog outside the transaction so the lock is not held while waiting on the network
    const card = await this.resolveCard(body, ctx);

    return this.store.transaction(() => {
      const raced = this.collections.findPull(body.pullId);
      if (raced) return this.replay(raced, userId, body);
      const record = this.collections.addFromPull(userId, card, body.quantity, body.pullId);
      return { pullId: body.pullId, created: true, card: toCardView(record) };
    });
  }

  private replay(pull: PullRecord, userId: string, body: AddCardBody): AddCardResult {
    if (pull.userId !== userId || pull.cardId !== body.cardId) {
      throw conflict('PULL_ID_CONFLICT', 'pullId was already used for a different user or card');
    }
    const record = this.collections.find(userId, body.cardId);
    if (!record) throw new Error(`collection record missing for pull ${pull.pullId}`);
    return { pullId: body.pullId, created: false, card: toCardView(record) };
  }

  private async resolveCard(body: AddCardBody, ctx: CallContext): Promise<CardInfo> {
    if (this.catalog.isEnabled()) return this.catalog.getCard(body.cardId, ctx);

    const missing = CARD_FIELDS.filter((field) => body[field] === undefined);
    if (missing.length > 0 || !body.cardName || !body.cardRarity || !body.cardImageUrl) {
      throw badRequest(
        'Card details are required while the catalog service is disabled',
        missing.map((path) => ({ path, message: 'Required' })),
      );
    }
    return { cardId: body.cardId, cardName: body.cardName, cardRarity: body.cardRarity, cardImageUrl: body.cardImageUrl };
  }
}
