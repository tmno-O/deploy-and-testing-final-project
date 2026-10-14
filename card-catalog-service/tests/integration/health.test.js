const request = require('supertest');
const { createApp } = require('../../src/app');
const store = require('../../src/store');

const app = createApp();

describe('health', () => {
  afterEach(() => store.reset());

  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('GET /health/ready returns ready when the store is loaded', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  test('GET /health/ready returns 503 when the store is broken', async () => {
    store.data.cards = null;
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });

  test('unknown route returns the standard error shape', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('malformed JSON returns 400 without leaking internals', async () => {
    const res = await request(app).post('/health').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  test('sets security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
