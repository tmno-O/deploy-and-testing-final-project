import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminAuth, bearer, newId, signToken } from '../helpers/auth';
import { createTestApp } from '../helpers/app';
import { createOrder, userWithCards } from '../helpers/fixtures';
import type { StoreService } from '../../src/store/store.service';

describe('PATCH /admin/fulfillments/orders/:id/status', () => {
  let app: INestApplication;
  let store: StoreService;

  beforeAll(async () => ({ app, store } = await createTestApp()));
  beforeEach(() => store.reset());
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const setStatus = (id: string, body: object, headers: Record<string, string> = adminAuth()) =>
    http().patch(`/admin/fulfillments/orders/${id}/status`).set(headers).send(body);

  async function newOrder(quantity = 1) {
    const user = await userWithCards(app, { 'base1-1': quantity });
    const res = await createOrder(app, user.auth, [{ cardId: 'base1-1', quantity }]);
    return { ...user, id: res.body.id as string };
  }

  test('requires a token (401) and an admin user (403)', async () => {
    const { id, auth } = await newOrder();
    expect((await setStatus(id, { status: 'PROCESSING' }, {})).status).toBe(401);
    const res = await setStatus(id, { status: 'PROCESSING' }, auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('every id in ADMIN_USER_IDS is an admin', async () => {
    const { id } = await newOrder();
    expect((await setStatus(id, { status: 'PROCESSING' }, bearer(signToken('admin-2')))).status).toBe(200);
  });

  test('walks the full flow and records history', async () => {
    const { id, auth } = await newOrder();
    expect((await setStatus(id, { status: 'PROCESSING' })).status).toBe(200);
    const shipped = await setStatus(id, { status: 'SHIPPED', trackingNumber: 'TH1234567890' });
    expect(shipped.body).toMatchObject({ status: 'SHIPPED', trackingNumber: 'TH1234567890' });
    const delivered = await setStatus(id, { status: 'DELIVERED' });
    expect(delivered.body.statusHistory.map((h: { status: string }) => h.status)).toEqual([
      'PENDING',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
    ]);

    const mine = await http().get(`/fulfillments/orders/${id}`).set(auth);
    expect(mine.body.status).toBe('DELIVERED');
  });

  test('requires a tracking number for SHIPPED', async () => {
    const { id } = await newOrder();
    await setStatus(id, { status: 'PROCESSING' });
    const res = await setStatus(id, { status: 'SHIPPED' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('trackingNumber');
  });

  test.each([
    [['PROCESSING'], 'PENDING'],
    [[], 'SHIPPED'],
    [[], 'DELIVERED'],
    [['CANCELLED'], 'PROCESSING'],
  ])('after %j rejects -> %s with 409', async (steps, to) => {
    const { id } = await newOrder();
    for (const status of steps) await setStatus(id, { status });
    const res = await setStatus(id, { status: to, trackingNumber: 'TH1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('can cancel while PROCESSING and returns the cards', async () => {
    const { id, auth } = await newOrder(2);
    await setStatus(id, { status: 'PROCESSING' });
    const res = await setStatus(id, { status: 'CANCELLED' });
    expect(res.body.status).toBe('CANCELLED');
    const card = await http().get('/collections/me/base1-1').set(auth);
    expect(card.body.availableQuantity).toBe(2);
  });

  test('validates the body and id', async () => {
    const { id } = await newOrder();
    expect((await setStatus(id, { status: 'LOST' })).status).toBe(400);
    expect((await setStatus('abc', { status: 'PROCESSING' })).status).toBe(400);
    const missing = await setStatus(newId(), { status: 'PROCESSING' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ORDER_NOT_FOUND');
  });
});

describe('GET /admin/fulfillments/orders', () => {
  let app: INestApplication;
  let store: StoreService;

  beforeAll(async () => ({ app, store } = await createTestApp()));
  beforeEach(() => store.reset());
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const list = (query = '', headers: Record<string, string> = adminAuth()) =>
    http().get(`/admin/fulfillments/orders${query}`).set(headers);

  async function twoUsersWithOrders() {
    const a = await userWithCards(app, { 'base1-1': 1 });
    const b = await userWithCards(app, { 'base1-1': 1 });
    const orderA = (await createOrder(app, a.auth, [{ cardId: 'base1-1', quantity: 1 }])).body.id as string;
    const orderB = (await createOrder(app, b.auth, [{ cardId: 'base1-1', quantity: 1 }])).body.id as string;
    return { a, b, orderA, orderB };
  }

  test('requires a token (401) and an admin user (403)', async () => {
    const { a, orderA } = await twoUsersWithOrders();
    expect((await list('', {})).status).toBe(401);
    expect((await list('', a.auth)).status).toBe(403);
    expect((await http().get(`/admin/fulfillments/orders/${orderA}`).set(a.auth)).status).toBe(403);
  });

  test("lists every user's orders", async () => {
    const { orderA, orderB } = await twoUsersWithOrders();
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data.map((o: { id: string }) => o.id).sort()).toEqual([orderA, orderB].sort());
  });

  test('filters by status and userId', async () => {
    const { a, orderA, orderB } = await twoUsersWithOrders();
    await http().patch(`/admin/fulfillments/orders/${orderB}/status`).set(adminAuth()).send({ status: 'PROCESSING' });

    const pending = await list('?status=PENDING');
    expect(pending.body.data.map((o: { id: string }) => o.id)).toEqual([orderA]);
    const processing = await list('?status=PROCESSING');
    expect(processing.body.data.map((o: { id: string }) => o.id)).toEqual([orderB]);
    const ofA = await list(`?userId=${a.userId}`);
    expect(ofA.body.data.map((o: { id: string }) => o.id)).toEqual([orderA]);
  });

  test('validates the query', async () => {
    expect((await list('?status=LOST')).status).toBe(400);
    expect((await list('?userId=abc')).status).toBe(400);
    expect((await list('?limit=101')).status).toBe(400);
    expect((await list('?foo=1')).status).toBe(400);
  });

  test("returns any user's order by id, 404 for a missing one and 400 for a bad id", async () => {
    const { orderA } = await twoUsersWithOrders();
    const one = await http().get(`/admin/fulfillments/orders/${orderA}`).set(adminAuth());
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(orderA);
    const missing = await http().get(`/admin/fulfillments/orders/${newId()}`).set(adminAuth());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ORDER_NOT_FOUND');
    expect((await http().get('/admin/fulfillments/orders/abc').set(adminAuth())).status).toBe(400);
  });
});
