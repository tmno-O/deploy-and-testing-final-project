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
