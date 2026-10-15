import type { INestApplication } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { adminAuth, algNoneToken, bearer, internalKey, newId, signToken } from '../helpers/auth';
import { createTestApp } from '../helpers/app';
import type { StoreService } from '../../src/store/store.service';

describe('auth', () => {
  let app: INestApplication;
  let store: StoreService;
  const userId = newId();

  beforeAll(async () => ({ app, store } = await createTestApp()));
  beforeEach(() => store.reset());
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const get = (headers: Record<string, string>) => http().get('/collections/me').set(headers);

  describe('user JWT', () => {
    test('accepts a valid user-service token', async () => {
      expect((await get(bearer(signToken(userId)))).status).toBe(200);
    });

    test.each([
      ['no header', {}, 'UNAUTHORIZED'],
      ['wrong scheme', { Authorization: `Basic ${signToken(userId)}` }, 'UNAUTHORIZED'],
      ['extra parts', { Authorization: `Bearer ${signToken(userId)} extra` }, 'UNAUTHORIZED'],
      ['bad signature', bearer(signToken(userId, { secret: 'another-secret-another-secret-123456' })), 'INVALID_TOKEN'],
      ['wrong issuer', bearer(signToken(userId, { issuer: 'someone-else' })), 'INVALID_TOKEN'],
      ['expired', bearer(signToken(userId, { expiresIn: -10 })), 'TOKEN_EXPIRED'],
      ['alg none', bearer(algNoneToken(userId)), 'INVALID_TOKEN'],
      ['garbage', bearer('not.a.jwt'), 'INVALID_TOKEN'],
      ['no subject', bearer(signToken(null)), 'INVALID_TOKEN'],
    ])('rejects %s with 401 %s', async (_label, headers, code) => {
      const res = await get(headers as Record<string, string>);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(code);
    });

    test('rejects an HS512 token (algorithm pinned to HS256)', async () => {
      const token = jwt.sign({}, process.env.JWT_SECRET as string, {
        algorithm: 'HS512',
        subject: userId,
        issuer: 'user-service',
      });
      expect((await get(bearer(token))).status).toBe(401);
    });

    test('does not accept the internal key for user endpoints', async () => {
      expect((await get(internalKey())).status).toBe(401);
    });
  });

  describe('internal key and admin', () => {
    const internal = `/internal/collections/${userId}`;
    const admin = `/admin/fulfillments/orders/${newId()}/status`;

    test('a user (or admin) Bearer token is not accepted on /internal', async () => {
      expect((await http().get(internal).set(bearer(signToken(userId)))).status).toBe(401);
      expect((await http().get(internal).set(adminAuth())).status).toBe(401);
    });

    test('a missing or wrong internal key is 401', async () => {
      expect((await http().get(internal)).body.error.code).toBe('UNAUTHORIZED');
      expect((await http().get(internal).set('X-Internal-Key', 'wrong')).status).toBe(401);
    });

    test('the internal key is not accepted on /admin', async () => {
      expect((await http().patch(admin).set(internalKey()).send({ status: 'PROCESSING' })).status).toBe(401);
    });

    test('accepts the right credentials', async () => {
      expect((await http().get(internal).set(internalKey())).status).toBe(200);
      expect((await http().patch(admin).set(adminAuth()).send({ status: 'PROCESSING' })).status).toBe(404);
    });
  });
});
