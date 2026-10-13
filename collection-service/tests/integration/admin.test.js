const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetStore } = require('../helpers/store');
const { userWithCards, createOrder } = require('../helpers/factory');
const t = require('../helpers/tokens');

const app = createApp();
beforeEach(resetStore);

const setStatus = (id, body, headers = t.adminKey()) =>
  request(app).patch(`/admin/fulfillments/orders/${id}/status`).set(headers).send(body);

async function newOrder(quantity = 1) {
  const user = await userWithCards(app, { 'CARD-001': quantity });
  const res = await createOrder(app, user.auth, [{ cardId: 'CARD-001', quantity }]);
  return { ...user, id: res.body.order.id };
}

describe('PATCH /admin/fulfillments/orders/:id/status', () => {
  it('requires the admin key', async () => {
    const { id } = await newOrder();
    expect((await setStatus(id, { status: 'PROCESSING' }, {})).status).toBe(401);
  });

  it('walks the full flow and records history', async () => {
    const { id, auth } = await newOrder();
    expect((await setStatus(id, { status: 'PROCESSING' })).status).toBe(200);
    const shipped = await setStatus(id, { status: 'SHIPPED', trackingNumber: 'TH1234567890' });
    expect(shipped.body.order).toMatchObject({ status: 'SHIPPED', trackingNumber: 'TH1234567890' });
    const delivered = await setStatus(id, { status: 'DELIVERED' });
    expect(delivered.body.order.statusHistory.map((h) => h.status)).toEqual(['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED']);

    const mine = await request(app).get(`/fulfillments/orders/${id}`).set(auth);
    expect(mine.body.order.status).toBe('DELIVERED');
  });

  it('requires a tracking number for SHIPPED', async () => {
    const { id } = await newOrder();
    await setStatus(id, { status: 'PROCESSING' });
    const res = await setStatus(id, { status: 'SHIPPED' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('trackingNumber');
  });

  it.each([
    [['PROCESSING'], 'PENDING'],
    [[], 'SHIPPED'],
    [[], 'DELIVERED'],
    [['CANCELLED'], 'PROCESSING'],
  ])('after %j rejects → %s with 409', async (path, to) => {
    const { id } = await newOrder();
    for (const status of path) await setStatus(id, { status });
    const res = await setStatus(id, { status: to, trackingNumber: 'TH1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('can cancel while PROCESSING and returns the cards', async () => {
    const { id, auth } = await newOrder(2);
    await setStatus(id, { status: 'PROCESSING' });
    const res = await setStatus(id, { status: 'CANCELLED' });
    expect(res.body.order.status).toBe('CANCELLED');
    const card = await request(app).get('/collections/me/CARD-001').set(auth);
    expect(card.body.card.availableQuantity).toBe(2);
  });

  it('validates the body and id', async () => {
    const { id } = await newOrder();
    expect((await setStatus(id, { status: 'LOST' })).status).toBe(400);
    expect((await setStatus('abc', { status: 'PROCESSING' })).status).toBe(400);
    expect((await setStatus(t.newUserId(), { status: 'PROCESSING' })).status).toBe(404);
  });
});
