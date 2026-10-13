const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetStore, store } = require('../helpers/store');

const app = createApp();
beforeEach(resetStore);

describe('health', () => {
  it('GET /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('reports not ready when the store is broken', async () => {
    store.data.orders = null;
    expect((await request(app).get('/health/ready')).status).toBe(503);
  });

  it('returns 404 in the standard format for unknown routes', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('generates an X-Request-Id or echoes a valid one', async () => {
    expect((await request(app).get('/health')).headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await request(app).get('/health').set('X-Request-Id', 'abc-123');
    expect(echoed.headers['x-request-id']).toBe('abc-123');
    const replaced = await request(app).get('/health').set('X-Request-Id', 'bad id with spaces');
    expect(replaced.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('rejects malformed and oversized JSON', async () => {
    const bad = await request(app).post('/fulfillments/orders').set('Content-Type', 'application/json').send('{bad');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
    const big = await request(app).post('/fulfillments/orders').send({ x: 'a'.repeat(20000) });
    expect(big.status).toBe(413);
  });
});
