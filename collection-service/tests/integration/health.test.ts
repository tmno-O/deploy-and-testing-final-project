import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app';
import type { StoreService } from '../../src/store/store.service';
import type { CollectionData } from '../../src/store/types';

describe('health and common behaviour', () => {
  let app: INestApplication;
  let store: StoreService;

  beforeAll(async () => ({ app, store } = await createTestApp()));
  beforeEach(() => store.reset());
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  test('GET /health', async () => {
    const res = await http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('GET /health/ready', async () => {
    const res = await http().get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  test('reports not ready when the store is broken', async () => {
    store.data.orders = null as unknown as CollectionData['orders'];
    const res = await http().get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });

  test('returns 404 in the standard format for unknown routes', async () => {
    const res = await http().get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('generates an X-Request-Id or echoes a valid one', async () => {
    expect((await http().get('/health')).headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await http().get('/health').set('X-Request-Id', 'abc-123');
    expect(echoed.headers['x-request-id']).toBe('abc-123');
    const replaced = await http().get('/health').set('X-Request-Id', 'bad id with spaces');
    expect(replaced.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  test('rejects malformed and oversized JSON', async () => {
    const bad = await http().post('/fulfillments/orders').set('Content-Type', 'application/json').send('{bad');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
    const big = await http().post('/fulfillments/orders').send({ x: 'a'.repeat(20000) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('sets security headers and hides x-powered-by', async () => {
    const res = await http().get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
