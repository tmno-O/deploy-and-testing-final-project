import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StoreService } from '../../src/store/store.service';
import { createTestApp } from '../helpers/app';
import {
  bearer,
  json,
  mockUpstreams,
  packPool,
  PULL_ID,
  requestHeaders,
  RESERVATION_ID,
  SERVICE_URLS,
  USER_ID,
} from '../helpers/gacha-integration';

describe('Gacha pulls integration', () => {
  let app: INestApplication;
  let store: StoreService;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, store } = await createTestApp());
  });

  beforeEach(() => store.reset());
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  test('completes a pull across all upstreams, supports replay, and lists the user history', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    mockUpstreams(async (url, init) => {
      calls.push({ url, init });
      if (url === `${SERVICE_URLS.catalog}/packs/starter/pool`) return json(200, packPool);
      if (url === `${SERVICE_URLS.catalog}/inventory/reservations`) {
        return json(201, { id: RESERVATION_ID, status: 'reserved', items: JSON.parse(init.body as string).items });
      }
      if (url === `${SERVICE_URLS.wallet}/internal/wallets/${USER_ID}/purchases`) {
        return json(201, {
          transactionId: 'transaction-1',
          balance: 900,
          transaction: { id: 'transaction-1', amount: 100, type: 'purchase' },
        });
      }
      if (url === `${SERVICE_URLS.catalog}/inventory/reservations/${RESERVATION_ID}/commit`) {
        return json(200, { id: RESERVATION_ID, status: 'committed' });
      }
      if (url.startsWith(`${SERVICE_URLS.collection}/internal/collections/${USER_ID}/cards`)) {
        return json(201, { pullId: JSON.parse(init.body as string).pullId, created: true });
      }
      throw new Error(`Unexpected upstream request: ${url}`);
    });

    const response = await http()
      .post('/gacha/pulls')
      .set(bearer())
      .set('Idempotency-Key', PULL_ID)
      .set('X-Request-Id', 'gacha-trace-1')
      .send({ packId: 'starter' });

    expect(response.status).toBe(201);
    expect(response.headers['x-request-id']).toBe('gacha-trace-1');
    expect(response.body).toMatchObject({ id: PULL_ID, packId: 'starter', status: 'COMPLETED', price: 100 });
    expect(response.body.cards).toHaveLength(2);
    expect(store.data.pulls[0]).toMatchObject({ userId: USER_ID, status: 'COMPLETED', walletTransactionId: 'transaction-1' });
    expect(calls.map(({ url }) => url)).toEqual([
      `${SERVICE_URLS.catalog}/packs/starter/pool`,
      `${SERVICE_URLS.catalog}/inventory/reservations`,
      `${SERVICE_URLS.wallet}/internal/wallets/${USER_ID}/purchases`,
      `${SERVICE_URLS.catalog}/inventory/reservations/${RESERVATION_ID}/commit`,
      `${SERVICE_URLS.collection}/internal/collections/${USER_ID}/cards`,
      `${SERVICE_URLS.collection}/internal/collections/${USER_ID}/cards`,
    ]);

    const reservationHeaders = requestHeaders(calls[1].init);
    expect(reservationHeaders['x-internal-key']).toBe(process.env.INTERNAL_API_KEY);
    expect(reservationHeaders['idempotency-key']).toBe(PULL_ID);
    expect(reservationHeaders['x-request-id']).toBe('gacha-trace-1');
    expect(requestHeaders(calls[2].init)).toMatchObject({
      'x-internal-key': process.env.INTERNAL_API_KEY,
      'x-request-id': 'gacha-trace-1',
    });
    expect(JSON.parse(calls[2].init.body as string)).toEqual({ packId: 'starter', idempotencyKey: PULL_ID });
    expect(calls.slice(4).map(({ init }) => requestHeaders(init)['x-internal-key'])).toEqual([
      process.env.INTERNAL_API_KEY,
      process.env.INTERNAL_API_KEY,
    ]);

    const replay = await http()
      .post('/gacha/pulls')
      .set(bearer())
      .set('Idempotency-Key', PULL_ID)
      .send({ packId: 'starter' });
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(PULL_ID);
    expect(calls).toHaveLength(6);

    const history = await http().get('/gacha/pulls').set(bearer());
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject({ total: 1, data: [expect.objectContaining({ id: PULL_ID, status: 'COMPLETED' })] });
  });
});