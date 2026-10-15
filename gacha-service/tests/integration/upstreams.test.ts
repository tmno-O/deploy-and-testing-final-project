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
  RESERVATION_ID,
  SERVICE_URLS,
  USER_ID,
} from '../helpers/gacha-integration';

describe('Gacha upstream failure and recovery', () => {
  let app: INestApplication;
  let store: StoreService;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, store } = await createTestApp());
  });

  beforeEach(() => store.reset());
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  test('releases reserved stock and records FAILED when Wallet rejects payment', async () => {
    const paths: string[] = [];
    mockUpstreams(async (url) => {
      paths.push(url);
      if (url.endsWith('/packs/starter/pool')) return json(200, packPool);
      if (url.endsWith('/inventory/reservations')) return json(201, { id: RESERVATION_ID, status: 'reserved' });
      if (url.endsWith(`/internal/wallets/${USER_ID}/purchases`)) {
        return json(402, { error: { code: 'INSUFFICIENT_BALANCE', message: 'not enough credits' } });
      }
      if (url.endsWith(`/inventory/reservations/${RESERVATION_ID}/release`)) {
        return json(200, { id: RESERVATION_ID, status: 'released' });
      }
      throw new Error(`Unexpected upstream request: ${url}`);
    });

    const response = await http()
      .post('/gacha/pulls')
      .set(bearer())
      .set('Idempotency-Key', PULL_ID)
      .send({ packId: 'starter' });

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(store.data.pulls[0]).toMatchObject({ status: 'FAILED', failureReason: 'INSUFFICIENT_BALANCE' });
    expect(paths.at(-1)).toBe(`${SERVICE_URLS.catalog}/inventory/reservations/${RESERVATION_ID}/release`);
    expect(paths.some((url) => url.startsWith(`${SERVICE_URLS.collection}/`))).toBe(false);
  });

  test('retries Collection delivery without charging twice after a temporary failure', async () => {
    let collectionCalls = 0;
    let purchases = 0;
    mockUpstreams(async (url) => {
      if (url.endsWith('/packs/starter/pool')) return json(200, packPool);
      if (url.endsWith('/inventory/reservations')) return json(201, { id: RESERVATION_ID, status: 'reserved' });
      if (url.endsWith(`/internal/wallets/${USER_ID}/purchases`)) {
        purchases++;
        return json(201, {
          transactionId: 'transaction-1',
          balance: 900,
          transaction: { id: 'transaction-1', amount: 100, type: 'purchase' },
        });
      }
      if (url.endsWith(`/inventory/reservations/${RESERVATION_ID}/commit`)) {
        return json(200, { id: RESERVATION_ID, status: 'committed' });
      }
      if (url.startsWith(`${SERVICE_URLS.collection}/internal/collections/${USER_ID}/cards`)) {
        collectionCalls++;
        if (collectionCalls === 2) return json(503, { error: { code: 'TEMPORARILY_UNAVAILABLE', message: 'try again' } });
        return json(201, { pullId: `collection-pull-${collectionCalls}`, created: true });
      }
      throw new Error(`Unexpected upstream request: ${url}`);
    });

    const first = await http()
      .post('/gacha/pulls')
      .set(bearer())
      .set('Idempotency-Key', PULL_ID)
      .send({ packId: 'starter' });
    expect(first.status).toBe(503);
    expect(store.data.pulls[0]).toMatchObject({ status: 'PAID', price: 100 });
    expect(store.data.pulls[0].cards.filter((item) => item.delivered)).toHaveLength(1);

    const retry = await http()
      .post('/gacha/pulls')
      .set(bearer())
      .set('Idempotency-Key', PULL_ID)
      .send({ packId: 'starter' });

    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('COMPLETED');
    expect(purchases).toBe(1);
    expect(collectionCalls).toBe(3);
    expect(store.data.pulls[0].cards.every((item) => item.delivered)).toBe(true);
  });
});