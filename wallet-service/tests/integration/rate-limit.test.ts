import request from 'supertest';
import { createTestApp } from '../helpers/app';
import { newUser } from '../helpers/fixtures';

describe('rate limit', () => {
  const original = process.env.RATE_LIMIT_PER_MINUTE;
  afterAll(() => {
    process.env.RATE_LIMIT_PER_MINUTE = original;
  });

  test('429 TOO_MANY_REQUESTS after the per-IP limit, but /health is exempt', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '3';
    const { app } = await createTestApp();
    const user = newUser();

    for (let i = 0; i < 3; i++) {
      expect((await request(app.getHttpServer()).get('/wallets/me').set(user.auth)).status).toBe(200);
    }
    const limited = await request(app.getHttpServer()).get('/wallets/me').set(user.auth);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('TOO_MANY_REQUESTS');

    for (let i = 0; i < 10; i++) {
      expect((await request(app.getHttpServer()).get('/health')).status).toBe(200);
    }
    await app.close();
  });
});
