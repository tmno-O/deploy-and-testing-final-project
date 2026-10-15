import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, internalKey, newId, signToken } from './auth';

export interface TestUser {
  userId: string;
  token: string;
  auth: { Authorization: string };
}

export function newUser(): TestUser {
  const userId = newId();
  const token = signToken(userId);
  return { userId, token, auth: bearer(token) };
}

let counter = 0;
/** A fresh, valid idempotency key. */
export const key = (prefix = 'key') => `${prefix}-${Date.now()}-${++counter}`;

export const topup = (app: INestApplication, user: TestUser, amount: number, idempotencyKey = key('topup'), extra = {}) =>
  request(app.getHttpServer())
    .post('/wallets/me/topups')
    .set(user.auth)
    .set('Idempotency-Key', idempotencyKey)
    .send({ amount, ...extra });

/** Gives the user credit through the public top-up flow and fails loudly if it did not work. */
export async function fund(app: INestApplication, user: TestUser, amount: number): Promise<void> {
  const res = await topup(app, user, amount);
  if (res.status !== 201) throw new Error(`fund failed: ${res.status} ${JSON.stringify(res.body)}`);
}

export const charge = (app: INestApplication, userId: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post(`/internal/wallets/${userId}/charge`).set(internalKey()).send(body);

export const refund = (app: INestApplication, userId: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post(`/internal/wallets/${userId}/refund`).set(internalKey()).send(body);

export const purchase = (app: INestApplication, userId: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post(`/internal/wallets/${userId}/purchases`).set(internalKey()).send(body);

export const balanceOf = async (app: INestApplication, user: TestUser): Promise<number> => {
  const res = await request(app.getHttpServer()).get('/wallets/me').set(user.auth);
  return res.body.balance;
};

// ---- card-catalog-service stand-in (global fetch) ----

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** card-catalog-service `GET /packs/:id` response (trimmed to what the wallet reads + a few real fields). */
export const catalogPack = (id = 'starter', priceCredits = 100, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Pack ${id}`,
  description: 'test pack',
  priceCredits,
  cardsPerPack: 5,
  rates: { common: 70, rare: 25, epic: 4, legendary: 1 },
  setIds: ['base1'],
  ...overrides,
});

/** Answers `GET /packs/:id` for the given packs; anything else is a test bug. */
export function mockCatalog(packs: Record<string, ReturnType<typeof catalogPack>>) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    const match = /\/packs\/([^/?]+)$/.exec(String(url));
    if (!match) throw new Error(`unexpected fetch ${String(url)}`);
    const pack = packs[decodeURIComponent(match[1])];
    return pack ? json(200, pack) : json(404, { error: { code: 'PACK_NOT_FOUND', message: 'not found' } });
  });
}
