import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StoreService } from '../../src/store/store.service';
import { createTestApp } from '../helpers/app';
import { algNoneToken } from '../helpers/auth';
import { bearer, OTHER_USER_ID, PULL_ID, RESERVATION_ID, USER_ID } from '../helpers/gacha-integration';

describe('Gacha authentication and request validation', () => {
  let app: INestApplication;
  let store: StoreService;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, store } = await createTestApp());
  });

  beforeEach(() => store.reset());
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  test.each([
    ['missing token', undefined],
    ['unsigned token', `Bearer ${algNoneToken(USER_ID)}`],
  ])('rejects %s before any upstream request', async (_label, authorization) => {
    const fetch = jest.spyOn(global, 'fetch');
    let call = http().post('/gacha/pulls').set('Idempotency-Key', PULL_ID).send({ packId: 'starter' });
    if (authorization) call = call.set('Authorization', authorization);

    const response = await call;

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.data.pulls).toEqual([]);
  });

  test('rejects missing idempotency keys and invalid pack bodies', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const missingKey = await http().post('/gacha/pulls').set(bearer()).send({ packId: 'starter' });
    const invalidPack = await http().post('/gacha/pulls').set(bearer()).set('Idempotency-Key', PULL_ID).send({ packId: '' });

    expect(missingKey.status).toBe(400);
    expect(invalidPack.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('does not expose one user\'s pull to another user', async () => {
    store.data.pulls.push({
      id: PULL_ID,
      userId: USER_ID,
      packId: 'starter',
      status: 'COMPLETED',
      price: 100,
      cards: [],
      reservationId: RESERVATION_ID,
      walletTransactionId: 'transaction-1',
      failureReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const response = await http().get(`/gacha/pulls/${PULL_ID}`).set(bearer(OTHER_USER_ID));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PULL_NOT_FOUND');
  });
});