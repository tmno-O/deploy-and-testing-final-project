const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetStore } = require('../helpers/store');
const { card, grant } = require('../helpers/factory');
const t = require('../helpers/tokens');

const app = createApp();
beforeEach(resetStore);

const post = (userId, body) =>
  request(app).post(`/internal/collections/${userId}/cards`).set(t.serviceKey()).send(body);

describe('POST /internal/collections/:userId/cards', () => {
  it('adds a new card with 201', async () => {
    const userId = t.newUserId();
    const body = card('CARD-001');
    const res = await post(userId, body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ pullId: body.pullId, created: true, card: { cardId: 'CARD-001', quantity: 1, availableQuantity: 1 } });
  });

  it('is idempotent on pullId: a retry returns 200 and does not add again', async () => {
    const userId = t.newUserId();
    const body = card('CARD-001', { quantity: 2 });
    await post(userId, body);
    const retry = await post(userId, body);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ created: false, card: { quantity: 2 } });
  });

  it('adds 1 for the same card from a new pull', async () => {
    const userId = t.newUserId();
    await grant(app, userId, 'CARD-001');
    const res = await grant(app, userId, 'CARD-001');
    expect(res.status).toBe(201);
    expect(res.body.card.quantity).toBe(2);
  });

  it('rejects a pullId reused for a different user', async () => {
    const body = card('CARD-001');
    await post(t.newUserId(), body);
    const res = await post(t.newUserId(), body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PULL_ID_CONFLICT');
  });

  it('requires card details while the catalog is off', async () => {
    const res = await post(t.newUserId(), card('CARD-001', { cardName: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'cardName', message: 'Required' }]);
  });

  it('validates userId and body', async () => {
    expect((await post('not-a-uuid', card())).status).toBe(400);
    expect((await post(t.newUserId(), card('CARD-001', { quantity: 0 }))).status).toBe(400);
    expect((await post(t.newUserId(), { ...card(), extra: true })).status).toBe(400);
  });
});

describe('GET /internal/collections/:userId', () => {
  it('lists any user\'s collection', async () => {
    const userId = t.newUserId();
    await grant(app, userId, 'CARD-001', 2);
    const res = await request(app).get(`/internal/collections/${userId}`).set(t.serviceKey());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, data: [{ cardId: 'CARD-001', quantity: 2 }] });
  });
});
