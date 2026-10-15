import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserClient } from '../../src/clients/user.client';
import { AppError } from '../../src/common/app-error';
import type { StoreService } from '../../src/store/store.service';
import { adminAuth, newId } from '../helpers/auth';
import { createTestApp } from '../helpers/app';
import { createOrder, userWithCards, validAddress } from '../helpers/fixtures';

describe('fulfillment orders', () => {
  let app: INestApplication;
  let store: StoreService;
  let users: UserClient;

  beforeAll(async () => {
    ({ app, store } = await createTestApp());
    users = app.get(UserClient);
  });
  beforeEach(() => store.reset());
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const myCard = async (auth: { Authorization: string }, cardId: string) =>
    (await http().get(`/collections/me/${cardId}`).set(auth)).body as Record<string, unknown>;

  describe('POST /fulfillments/orders', () => {
    test('creates an order and reduces availableQuantity', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 3 });
      const res = await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 2 }]);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'PENDING',
        shippingFee: 50,
        paymentStatus: 'NOT_REQUIRED',
        trackingNumber: null,
        addressId: null,
        items: [{ cardId: 'base1-1', cardName: 'Card base1-1', quantity: 2 }],
      });
      expect(await myCard(auth, 'base1-1')).toMatchObject({ quantity: 3, redeemedQuantity: 2, availableQuantity: 1 });
    });

    test('ships free from 5 cards', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 3, 'base1-2': 2 });
      const res = await createOrder(app, auth, [
        { cardId: 'base1-1', quantity: 3 },
        { cardId: 'base1-2', quantity: 2 },
      ]);
      expect(res.body.shippingFee).toBe(0);
    });

    test('returns 409 and changes nothing when asking for more than available', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 3, 'base1-2': 1 });
      const before = JSON.stringify(store.data);
      const res = await createOrder(app, auth, [
        { cardId: 'base1-1', quantity: 1 },
        { cardId: 'base1-2', quantity: 2 },
        { cardId: 'base1-9', quantity: 1 },
      ]);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'INSUFFICIENT_QUANTITY',
        details: [
          { cardId: 'base1-2', requested: 2, available: 1 },
          { cardId: 'base1-9', requested: 1, available: 0 },
        ],
      });
      expect(JSON.stringify(store.data)).toBe(before);
    });

    test('cannot redeem the same cards twice', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 1 });
      expect((await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 1 }])).status).toBe(201);
      expect((await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 1 }])).status).toBe(409);
    });

    test('rejects more than MAX_CARDS_PER_ORDER', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 51 });
      expect((await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 51 }])).status).toBe(400);
    });

    test('validates the body', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 1 });
      const one = [{ cardId: 'base1-1', quantity: 1 }];
      expect((await createOrder(app, auth, [])).status).toBe(400);
      expect((await createOrder(app, auth, one, {})).status).toBe(400);
      const both = await createOrder(app, auth, one, { addressId: newId(), shippingAddress: validAddress() });
      expect(both.status).toBe(400);
      const dup = await createOrder(app, auth, [...one, ...one]);
      expect(dup.body.error.details[0]).toEqual({ path: 'items.1.cardId', message: 'Duplicate cardId in items' });
      const res = await createOrder(app, auth, one, { shippingAddress: validAddress({ postalCode: 'x' }) });
      expect(res.body.error.details[0].path).toBe('shippingAddress.postalCode');
    });

    describe('with addressId', () => {
      test('uses the address from user-service', async () => {
        const { auth } = await userWithCards(app, { 'base1-1': 1 });
        const addressId = newId();
        const spy = jest
          .spyOn(users, 'getAddress')
          .mockResolvedValue({ id: addressId, ...validAddress({ province: 'Bangkok', line2: null }) });
        const res = await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 1 }], { addressId });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ addressId, shippingAddress: { province: 'Bangkok' } });
        expect(res.body.shippingAddress).not.toHaveProperty('id');
        expect(res.body.shippingAddress).not.toHaveProperty('line2');
        expect(spy).toHaveBeenCalledWith(addressId, expect.objectContaining({ authorization: auth.Authorization }));
      });

      test.each([
        [new AppError(422, 'ADDRESS_NOT_FOUND', 'x'), 422],
        [new AppError(503, 'USER_SERVICE_UNAVAILABLE', 'x'), 503],
      ])('passes through %s and keeps the cards', async (error, status) => {
        const { auth } = await userWithCards(app, { 'base1-1': 1 });
        jest.spyOn(users, 'getAddress').mockRejectedValue(error);
        const res = await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 1 }], { addressId: newId() });
        expect(res.status).toBe(status);
        expect(res.body.error.code).toBe(error.code);
        expect((await myCard(auth, 'base1-1')).availableQuantity).toBe(1);
      });
    });
  });

  describe('reading orders', () => {
    test('lists my orders newest first with status filter', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 3 });
      const first = await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 1 }]);
      await new Promise((r) => setTimeout(r, 5));
      const second = await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 1 }]);
      await http().post(`/fulfillments/orders/${first.body.id}/cancel`).set(auth);

      const all = await http().get('/fulfillments/orders').set(auth);
      expect(all.body).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
      expect(all.body.data.map((o: { id: string }) => o.id)).toEqual([second.body.id, first.body.id]);

      const pending = await http().get('/fulfillments/orders?status=PENDING').set(auth);
      expect(pending.body.data.map((o: { id: string }) => o.id)).toEqual([second.body.id]);
      expect((await http().get('/fulfillments/orders?status=LOST').set(auth)).status).toBe(400);
    });

    test('returns one order and 400 for a bad id', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 1 });
      const created = await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 1 }]);
      expect((await http().get(`/fulfillments/orders/${created.body.id}`).set(auth)).status).toBe(200);
      expect((await http().get('/fulfillments/orders/abc').set(auth)).status).toBe(400);
    });

    test('hides orders of other users (404, IDOR)', async () => {
      const alice = await userWithCards(app, { 'base1-1': 1 });
      const bob = await userWithCards(app);
      const { id } = (await createOrder(app, alice.auth, [{ cardId: 'base1-1', quantity: 1 }])).body;

      const peek = await http().get(`/fulfillments/orders/${id}`).set(bob.auth);
      expect(peek.status).toBe(404);
      expect(peek.body.error.code).toBe('ORDER_NOT_FOUND');
      expect((await http().post(`/fulfillments/orders/${id}/cancel`).set(bob.auth)).status).toBe(404);
      expect((await http().get('/fulfillments/orders').set(bob.auth)).body.total).toBe(0);
      expect((await http().get(`/fulfillments/orders/${id}`).set(alice.auth)).body.status).toBe('PENDING');
    });
  });

  describe('POST /fulfillments/orders/:id/cancel', () => {
    test('cancels a PENDING order and returns the cards', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 2 });
      const { id } = (await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 2 }])).body;
      const res = await http().post(`/fulfillments/orders/${id}/cancel`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      expect((await myCard(auth, 'base1-1')).availableQuantity).toBe(2);
    });

    test('returns 409 once the order is PROCESSING', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 1 });
      const { id } = (await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 1 }])).body;
      await http().patch(`/admin/fulfillments/orders/${id}/status`).set(adminAuth()).send({ status: 'PROCESSING' });
      const res = await http().post(`/fulfillments/orders/${id}/cancel`).set(auth);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      expect((await myCard(auth, 'base1-1')).availableQuantity).toBe(0);
    });

    test('cannot cancel twice', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 1 });
      const { id } = (await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 1 }])).body;
      await http().post(`/fulfillments/orders/${id}/cancel`).set(auth);
      expect((await http().post(`/fulfillments/orders/${id}/cancel`).set(auth)).status).toBe(409);
      expect((await myCard(auth, 'base1-1')).availableQuantity).toBe(1);
    });
  });
});
