import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app';
import { adminAuth, algNoneToken, bearer, internalKey, newId, signToken } from '../helpers/auth';
import { key, newUser } from '../helpers/fixtures';

describe('authentication', () => {
  let app: INestApplication;
  beforeAll(async () => ({ app } = await createTestApp()));
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  describe('user routes need a JWT from user-service', () => {
    const routes: [string, string][] = [
      ['get', '/wallets/me'],
      ['get', '/wallets/me/transactions'],
      ['get', `/wallets/me/transactions/${newId()}`],
      ['post', '/wallets/me/topups'],
    ];

    test.each(routes)('%s %s without a token -> 401 UNAUTHORIZED', async (method, path) => {
      const res = await (http() as unknown as Record<string, (p: string) => request.Test>)[method](path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('rejects a malformed Authorization header', async () => {
      for (const header of ['Basic abc', 'Bearer', 'Bearer a b', 'token']) {
        const res = await http().get('/wallets/me').set('Authorization', header);
        expect(res.status).toBe(401);
      }
    });

    test('rejects bad tokens with INVALID_TOKEN', async () => {
      const bad = [
        signToken(newId(), { secret: 'another-secret-another-secret-12345' }),
        signToken(newId(), { issuer: 'someone-else' }),
        algNoneToken(newId()),
        signToken(null),
        'not.a.jwt',
      ];
      for (const token of bad) {
        const res = await http().get('/wallets/me').set(bearer(token));
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_TOKEN');
      }
    });

    test('rejects an expired token with TOKEN_EXPIRED', async () => {
      const res = await http()
        .get('/wallets/me')
        .set(bearer(signToken(newId(), { expiresIn: -10 })));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });

    test('a valid token works', async () => {
      const res = await http().get('/wallets/me').set(newUser().auth);
      expect(res.status).toBe(200);
    });

    test('the internal key is not a substitute for a user token', async () => {
      const res = await http().get('/wallets/me').set(internalKey());
      expect(res.status).toBe(401);
    });
  });

  describe('internal routes need X-Internal-Key', () => {
    const user = newId();
    const routes: [string, string][] = [
      ['get', `/internal/wallets/${user}`],
      ['post', `/internal/wallets/${user}/charge`],
      ['post', `/internal/wallets/${user}/purchases`],
      ['post', `/internal/wallets/${user}/refund`],
    ];

    test.each(routes)('%s %s without the key -> 401', async (method, path) => {
      const res = await (http() as unknown as Record<string, (p: string) => request.Test>)[method](path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('a wrong key or a user JWT is refused', async () => {
      const wrong = await http().post(`/internal/wallets/${user}/charge`).set('X-Internal-Key', 'wrong').send({});
      expect(wrong.status).toBe(401);
      const jwt = await http().post(`/internal/wallets/${user}/charge`).set(newUser().auth).send({});
      expect(jwt.status).toBe(401);
    });

    test('the right key passes the guard', async () => {
      const res = await http().get(`/internal/wallets/${user}`).set(internalKey());
      expect(res.status).toBe(200);
    });
  });

  describe('admin routes need a JWT of an admin', () => {
    const target = newId();

    test('no token -> 401, normal user -> 403, admin -> 200', async () => {
      expect((await http().get(`/admin/wallets/${target}`)).status).toBe(401);
      const user = await http().get(`/admin/wallets/${target}`).set(newUser().auth);
      expect(user.status).toBe(403);
      expect(user.body.error.code).toBe('FORBIDDEN');
      expect((await http().get(`/admin/wallets/${target}`).set(adminAuth())).status).toBe(200);
    });

    test('the internal key does not grant admin access', async () => {
      const res = await http().get(`/admin/wallets/${target}/transactions`).set(internalKey());
      expect(res.status).toBe(401);
    });
  });

  test('public: the top-up methods need no login', async () => {
    const res = await http().get('/wallets/topup-methods');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'mock', methods: ['mock'] });
    expect(key()).toBeTruthy();
  });
});
