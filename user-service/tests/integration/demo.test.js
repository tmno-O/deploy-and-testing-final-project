const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();

describe('GET /demo', () => {
  it('serves the demo app for local development', async () => {
    const res = await request(app).get('/demo/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('CardDrop');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});
