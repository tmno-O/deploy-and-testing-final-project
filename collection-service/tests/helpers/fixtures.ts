import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { bearer, internalKey, signToken } from './auth';

export const cardBody = (cardId = 'base1-1', overrides: Record<string, unknown> = {}) => ({
  pullId: randomUUID(),
  cardId,
  cardName: `Card ${cardId}`,
  cardRarity: 'rare',
  cardImageUrl: `https://images.pokemontcg.io/${cardId.replace('-', '/')}.png`,
  ...overrides,
});

/** Gacha adds a card through the internal endpoint. */
export const grant = (
  app: INestApplication,
  userId: string,
  cardId: string,
  quantity = 1,
  overrides: Record<string, unknown> = {},
) =>
  request(app.getHttpServer())
    .post(`/internal/collections/${userId}/cards`)
    .set(internalKey())
    .send(cardBody(cardId, { quantity, ...overrides }));

export const validAddress = (overrides: Record<string, unknown> = {}) => ({
  recipientName: 'Somchai Jaidee',
  phone: '0812345678',
  line1: '99/1 Moo 3',
  district: 'Mueang',
  province: 'Chiang Mai',
  postalCode: '50000',
  ...overrides,
});

export interface TestUser {
  userId: string;
  token: string;
  auth: { Authorization: string };
}

/** A new user owning the given cards: { cardId: quantity }. */
export async function userWithCards(app: INestApplication, cards: Record<string, number> = {}): Promise<TestUser> {
  const userId = randomUUID();
  for (const [cardId, quantity] of Object.entries(cards)) {
    const res = await grant(app, userId, cardId, quantity);
    if (res.status !== 201) throw new Error(`grant failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const token = signToken(userId);
  return { userId, token, auth: bearer(token) };
}

export const createOrder = (
  app: INestApplication,
  auth: { Authorization: string },
  items: unknown,
  extra: Record<string, unknown> = { shippingAddress: validAddress() },
) => request(app.getHttpServer()).post('/fulfillments/orders').set(auth).send({ items, ...extra });
