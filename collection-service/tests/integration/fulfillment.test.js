const request = require('supertest');
const { createApp } = require('../../src/app');
const userClient = require('../../src/clients/userClient');
const { AppError } = require('../../src/errors');
const { resetStore, store } = require('../helpers/store');
const { userWithCards, createOrder, validAddress } = require('../helpers/factory');
const t = require('../helpers/tokens');

const app = createApp();
beforeEach(resetStore);
afterEach(() => jest.restoreAllMocks());

const myCard = async (auth, cardId) => (await request(app).get(`/collections/me/${cardId}`).set(auth)).body.card;

describe('POST /fulfillments/orders', () => {
  it('creates an order and reduces availableQuantity', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 3 });
    const res = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 2 }]);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ status: 'PENDING', shippingFee: 50, paymentStatus: 'NOT_REQUIRED', trackingNumber: null });
    expect(await myCard(auth, 'CARD-001')).toMatchObject({ quantity: 3, redeemedQuantity: 2, availableQuantity: 1 });
  });

  it('ships free from 5 cards', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 3, 'CARD-002': 2 });
    const res = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 3 }, { cardId: 'CARD-002', quantity: 2 }]);
    expect(res.body.order.shippingFee).toBe(0);
  });

  it('returns 409 and changes nothing when asking for more than available', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 3, 'CARD-002': 1 });
    const before = JSON.stringify(store.data);
    const res = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }, { cardId: 'CARD-002', quantity: 2 }]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_QUANTITY', details: [{ cardId: 'CARD-002', requested: 2, available: 1 }] });
    expect(JSON.stringify(store.data)).toBe(before);
  });

  it('cannot redeem the same cards twice', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 1 });
    expect((await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }])).status).toBe(201);
    expect((await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }])).status).toBe(409);
  });

  it('rejects more than MAX_CARDS_PER_ORDER', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 51 });
    const res = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 51 }]);
    expect(res.status).toBe(400);
  });

  it('validates the body', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 1 });
    expect((await createOrder(app, auth, [])).status).toBe(400);
    expect((await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }], {})).status).toBe(400);
    const res = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }], { shippingAddress: validAddress({ postalCode: 'x' }) });
    expect(res.body.error.details[0].field).toBe('shippingAddress.postalCode');
  });

  describe('with addressId', () => {
    it('uses the address from user-service', async () => {
      const { auth } = await userWithCards(app, { 'CARD-001': 1 });
      const addressId = t.newUserId();
      const spy = jest.spyOn(userClient, 'getAddress').mockResolvedValue({ id: addressId, ...validAddress({ province: 'Bangkok' }) });
      const res = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }], { addressId });
      expect(res.status).toBe(201);
      expect(res.body.order).toMatchObject({ addressId, shippingAddress: { province: 'Bangkok' } });
      expect(spy).toHaveBeenCalledWith(addressId, expect.objectContaining({ authorization: auth.Authorization }));
    });

    it.each([
      [new AppError(422, 'ADDRESS_NOT_FOUND', 'x'), 422],
      [new AppError(503, 'USER_SERVICE_UNAVAILABLE', 'x'), 503],
    ])('passes through %s and keeps the cards', async (error, status) => {
      const { auth } = await userWithCards(app, { 'CARD-001': 1 });
      jest.spyOn(userClient, 'getAddress').mockRejectedValue(error);
      const res = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }], { addressId: t.newUserId() });
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(error.code);
      expect((await myCard(auth, 'CARD-001')).availableQuantity).toBe(1);
    });
  });
});

describe('reading orders', () => {
  it('lists my orders newest first with status filter', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 3 });
    const first = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }]);
    await new Promise((r) => setTimeout(r, 5));
    const second = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }]);
    await request(app).post(`/fulfillments/orders/${first.body.order.id}/cancel`).set(auth);

    const all = await request(app).get('/fulfillments/orders').set(auth);
    expect(all.body.total).toBe(2);
    expect(all.body.data.map((o) => o.id)).toEqual([second.body.order.id, first.body.order.id]);

    const pending = await request(app).get('/fulfillments/orders?status=PENDING').set(auth);
    expect(pending.body.data.map((o) => o.id)).toEqual([second.body.order.id]);
  });

  it('returns one order and 400 for a bad id', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 1 });
    const created = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }]);
    expect((await request(app).get(`/fulfillments/orders/${created.body.order.id}`).set(auth)).status).toBe(200);
    expect((await request(app).get('/fulfillments/orders/abc').set(auth)).status).toBe(400);
  });

  it('hides orders of other users (404, IDOR)', async () => {
    const alice = await userWithCards(app, { 'CARD-001': 1 });
    const bob = await userWithCards(app);
    const { id } = (await createOrder(app, alice.auth, [{ cardId: 'CARD-001', quantity: 1 }])).body.order;

    expect((await request(app).get(`/fulfillments/orders/${id}`).set(bob.auth)).status).toBe(404);
    expect((await request(app).post(`/fulfillments/orders/${id}/cancel`).set(bob.auth)).status).toBe(404);
    expect((await request(app).get('/fulfillments/orders').set(bob.auth)).body.total).toBe(0);
    expect((await request(app).get(`/fulfillments/orders/${id}`).set(alice.auth)).body.order.status).toBe('PENDING');
  });
});

describe('POST /fulfillments/orders/:id/cancel', () => {
  it('cancels a PENDING order and returns the cards', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 2 });
    const { id } = (await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 2 }])).body.order;
    const res = await request(app).post(`/fulfillments/orders/${id}/cancel`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('CANCELLED');
    expect((await myCard(auth, 'CARD-001')).availableQuantity).toBe(2);
  });

  it('returns 409 once the order is PROCESSING', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 1 });
    const { id } = (await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }])).body.order;
    await request(app).patch(`/admin/fulfillments/orders/${id}/status`).set(t.adminKey()).send({ status: 'PROCESSING' });
    const res = await request(app).post(`/fulfillments/orders/${id}/cancel`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect((await myCard(auth, 'CARD-001')).availableQuantity).toBe(0);
  });

  it('cannot cancel twice', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 1 });
    const { id } = (await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }])).body.order;
    await request(app).post(`/fulfillments/orders/${id}/cancel`).set(auth);
    expect((await request(app).post(`/fulfillments/orders/${id}/cancel`).set(auth)).status).toBe(409);
    expect((await myCard(auth, 'CARD-001')).availableQuantity).toBe(1);
  });
});
