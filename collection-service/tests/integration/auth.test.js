const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../src/app');
const { resetStore } = require('../helpers/store');
const t = require('../helpers/tokens');

const app = createApp();
const userId = t.newUserId();
beforeEach(resetStore);

const get = (headers) => request(app).get('/collections/me').set(headers);

describe('user JWT', () => {
  it('accepts a valid user-service token', async () => {
    expect((await get(t.bearer(t.sign(userId)))).status).toBe(200);
  });

  it.each([
    ['no header', {}, 'UNAUTHORIZED'],
    ['wrong scheme', { Authorization: `Basic ${t.sign(userId)}` }, 'UNAUTHORIZED'],
    ['bad signature', t.bearer(t.wrongSignature(userId)), 'INVALID_TOKEN'],
    ['wrong issuer', t.bearer(t.wrongIssuer(userId)), 'INVALID_TOKEN'],
    ['expired', t.bearer(t.expired(userId)), 'TOKEN_EXPIRED'],
    ['alg none', t.bearer(t.algNone(userId)), 'INVALID_TOKEN'],
    ['garbage', t.bearer('not.a.jwt'), 'INVALID_TOKEN'],
    ['no subject', t.bearer(jwt.sign({}, process.env.JWT_SECRET, { issuer: 'user-service' })), 'INVALID_TOKEN'],
  ])('rejects %s with 401 %s', async (_label, headers, code) => {
    const res = await get(headers);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(code);
  });

  it('rejects an HS512 token (algorithm pinned to HS256)', async () => {
    const token = jwt.sign({}, process.env.JWT_SECRET, { algorithm: 'HS512', subject: userId, issuer: 'user-service' });
    expect((await get(t.bearer(token))).status).toBe(401);
  });

  it('does not accept the service or admin key for user endpoints', async () => {
    expect((await get(t.serviceKey())).status).toBe(401);
    expect((await get(t.adminKey())).status).toBe(401);
  });
});

describe('service and admin keys', () => {
  const internal = `/internal/collections/${userId}`;
  const admin = `/admin/fulfillments/orders/${t.newUserId()}/status`;

  it('rejects a user Bearer token on /internal and /admin', async () => {
    const auth = t.bearer(t.sign(userId));
    expect((await request(app).get(internal).set(auth)).status).toBe(401);
    expect((await request(app).patch(admin).set(auth).send({ status: 'PROCESSING' })).status).toBe(401);
  });

  it('rejects a missing or wrong key', async () => {
    expect((await request(app).get(internal)).body.error.code).toBe('UNAUTHORIZED');
    const wrong = await request(app).get(internal).set('X-Service-Key', 'wrong');
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_API_KEY');
  });

  it('does not accept the admin key on /internal or the service key on /admin', async () => {
    expect((await request(app).get(internal).set('X-Service-Key', process.env.ADMIN_API_KEY)).status).toBe(401);
    expect((await request(app).patch(admin).set('X-Admin-Key', process.env.SERVICE_API_KEY).send({ status: 'PROCESSING' })).status).toBe(401);
  });

  it('accepts the right keys', async () => {
    expect((await request(app).get(internal).set(t.serviceKey())).status).toBe(200);
    expect((await request(app).patch(admin).set(t.adminKey()).send({ status: 'PROCESSING' })).status).toBe(404);
  });
});
