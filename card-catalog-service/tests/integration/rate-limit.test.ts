import request from 'supertest';
import { createTestApp } from '../helpers/app';

describe('rate limiting', () => {
  const previous = process.env.RATE_LIMIT_PER_MINUTE;
  beforeAll(() => {
    process.env.RATE_LIMIT_PER_MINUTE = '3';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.RATE_LIMIT_PER_MINUTE;
    else process.env.RATE_LIMIT_PER_MINUTE = previous;
  });

  test('public routes return 429 after the limit; health is exempt', async () => {
    const { app } = await createTestApp();
    const http = () => request(app.getHttpServer());
    for (let i = 0; i < 3; i += 1) expect((await http().get('/packs')).status).toBe(200);
    const blocked = await http().get('/packs');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    for (let i = 0; i < 6; i += 1) expect((await http().get('/health')).status).toBe(200);
    await app.close();
  });
});
