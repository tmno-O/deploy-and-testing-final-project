const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetStore } = require('../helpers/store');
const { userWithCards, grant } = require('../helpers/factory');
const t = require('../helpers/tokens');

const app = createApp();
beforeEach(resetStore);

describe('GET /collections/me', () => {
  it('lists my cards with quantities', async () => {
    const { auth } = await userWithCards(app, { 'CARD-002': 2, 'CARD-001': 1 });
    const res = await request(app).get('/collections/me').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, limit: 20, offset: 0 });
    expect(res.body.data.map((c) => [c.cardId, c.quantity, c.redeemedQuantity, c.availableQuantity])).toEqual([
      ['CARD-001', 1, 0, 1],
      ['CARD-002', 2, 0, 2],
    ]);
  });

  it('paginates and filters by rarity', async () => {
    const { userId, auth } = await userWithCards(app, { 'CARD-001': 1, 'CARD-002': 1 });
    await grant(app, userId, 'CARD-003', 1, { cardRarity: 'SECRET_RARE' });

    const page = await request(app).get('/collections/me?limit=1&offset=1').set(auth);
    expect(page.body).toMatchObject({ total: 3, limit: 1, offset: 1, data: [{ cardId: 'CARD-002' }] });

    const rare = await request(app).get('/collections/me?rarity=SECRET_RARE').set(auth);
    expect(rare.body.data.map((c) => c.cardId)).toEqual(['CARD-003']);
  });

  it('validates query parameters', async () => {
    const { auth } = await userWithCards(app);
    expect((await request(app).get('/collections/me?limit=0').set(auth)).status).toBe(400);
    expect((await request(app).get('/collections/me?rarity=MYTHIC').set(auth)).status).toBe(400);
    expect((await request(app).get('/collections/me?foo=1').set(auth)).status).toBe(400);
  });

  it('only shows my own cards', async () => {
    await userWithCards(app, { 'CARD-001': 5 });
    const other = await userWithCards(app);
    const res = await request(app).get('/collections/me').set(other.auth);
    expect(res.body).toMatchObject({ total: 0, data: [] });
  });
});

describe('GET /collections/me/:cardId', () => {
  it('returns one card', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 3 });
    const res = await request(app).get('/collections/me/CARD-001').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.card).toMatchObject({ cardId: 'CARD-001', quantity: 3 });
  });

  it('returns 404 for a card I do not own', async () => {
    await userWithCards(app, { 'CARD-001': 1 });
    const res = await request(app).get('/collections/me/CARD-001').set(t.bearer(t.sign(t.newUserId())));
    expect(res.status).toBe(404);
  });

  it('users cannot add cards to themselves', async () => {
    const { auth } = await userWithCards(app);
    expect((await request(app).post('/collections/me').set(auth).send({ cardId: 'CARD-001' })).status).toBe(404);
  });
});
