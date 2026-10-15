import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StoreService } from '../../src/store/store.service';
import { createTestApp } from '../helpers/app';

describe('health and request tracing', () => {
  let app: INestApplication;
  let store: StoreService;
  beforeAll(async () => ({ app, store } = await createTestApp()));
  afterAll(() => app.close());

  test('GET /health is alive', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('GET /health/ready is ready once the ledger is loaded', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  test('GET /health/ready answers 503 when the ledger is broken', async () => {
    const saved = store.data.transactions;
    (store.data as unknown as Record<string, unknown>).transactions = null;
    const res = await request(app.getHttpServer()).get('/health/ready');
    store.data.transactions = saved;
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });

  test('echoes a good X-Request-Id and replaces a bad one', async () => {
    const good = await request(app.getHttpServer()).get('/health').set('X-Request-Id', 'trace-123');
    expect(good.headers['x-request-id']).toBe('trace-123');
    const bad = await request(app.getHttpServer()).get('/health').set('X-Request-Id', 'bad id with spaces');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const none = await request(app.getHttpServer()).get('/health');
    expect(none.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('unknown routes use the shared error format', async () => {
    const res = await request(app.getHttpServer()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  test('malformed and oversized bodies are rejected before any logic runs', async () => {
    const bad = await request(app.getHttpServer())
      .post('/internal/wallets/u1/charge')
      .set('X-Internal-Key', process.env.INTERNAL_API_KEY as string)
      .set('Content-Type', 'application/json')
      .send('{"amount": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');

    const big = await request(app.getHttpServer())
      .post('/internal/wallets/u1/charge')
      .set('X-Internal-Key', process.env.INTERNAL_API_KEY as string)
      .send({ amount: 5, reason: 'x'.repeat(20_000) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
