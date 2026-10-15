import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, newId, signToken } from '../helpers/auth';
import { createTestApp } from '../helpers/app';

describe('rate limit', () => {
  let app: INestApplication;
  const previous = process.env.RATE_LIMIT_PER_MINUTE;

  beforeAll(async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '3';
    ({ app } = await createTestApp());
  });
  afterAll(async () => {
    process.env.RATE_LIMIT_PER_MINUTE = previous;
    await app.close();
  });

  test('returns 429 after RATE_LIMIT_PER_MINUTE requests, but never limits health', async () => {
    const auth = bearer(signToken(newId()));
    const http = () => request(app.getHttpServer());
    for (let i = 0; i < 3; i++) expect((await http().get('/collections/me').set(auth)).status).toBe(200);
    const limited = await http().get('/collections/me').set(auth);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('TOO_MANY_REQUESTS');
    for (let i = 0; i < 5; i++) expect((await http().get('/health')).status).toBe(200);
  });
});
