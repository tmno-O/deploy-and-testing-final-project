// Checks that real responses match docs/openapi.yaml (the contract handed to the other teams).
import type { INestApplication } from '@nestjs/common';
import jestOpenAPI from 'jest-openapi';
import * as path from 'path';
import request from 'supertest';
import type { StoreService } from '../../src/store/store.service';
import { adminAuth, internalKey, newId } from '../helpers/auth';
import { createTestApp } from '../helpers/app';
import { cardBody, createOrder, userWithCards } from '../helpers/fixtures';

jestOpenAPI(path.join(__dirname, '../../docs/openapi.yaml'));

describe('responses match docs/openapi.yaml', () => {
  let app: INestApplication;
  let store: StoreService;

  beforeAll(async () => ({ app, store } = await createTestApp()));
  beforeEach(() => store.reset());
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  test('health', async () => {
    expect(await http().get('/health')).toSatisfyApiSpec();
    expect(await http().get('/health/ready')).toSatisfyApiSpec();
  });

  test('collection endpoints', async () => {
    const { userId, auth } = await userWithCards(app, { 'base1-1': 2 });
    expect(await http().get('/collections/me').set(auth)).toSatisfyApiSpec();
    expect(await http().get('/collections/me/base1-1').set(auth)).toSatisfyApiSpec();
    expect(await http().get('/collections/me/base1-404').set(auth)).toSatisfyApiSpec();
    expect(await http().get('/collections/me')).toSatisfyApiSpec();
    expect(await http().get(`/internal/collections/${userId}`).set(internalKey())).toSatisfyApiSpec();
  });

  test('internal add card (201, 200, 400)', async () => {
    const userId = newId();
    const body = cardBody('base1-1');
    const post = (b: object) => http().post(`/internal/collections/${userId}/cards`).set(internalKey()).send(b);
    expect(await post(body)).toSatisfyApiSpec();
    expect(await post(body)).toSatisfyApiSpec();
    expect(await post({ ...body, pullId: 'x' })).toSatisfyApiSpec();
  });

  test('order endpoints', async () => {
    const { auth } = await userWithCards(app, { 'base1-1': 2 });
    const created = await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 1 }]);
    expect(created).toSatisfyApiSpec();
    const { id } = created.body as { id: string };
    const status = (body: object, headers = adminAuth()) =>
      http().patch(`/admin/fulfillments/orders/${id}/status`).set(headers).send(body);

    expect(await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 5 }])).toSatisfyApiSpec();
    expect(await http().get('/fulfillments/orders').set(auth)).toSatisfyApiSpec();
    expect(await http().get(`/fulfillments/orders/${id}`).set(auth)).toSatisfyApiSpec();
    expect(await status({ status: 'PROCESSING' }, auth)).toSatisfyApiSpec();
    expect(await status({ status: 'PROCESSING' })).toSatisfyApiSpec();
    expect(await http().post(`/fulfillments/orders/${id}/cancel`).set(auth)).toSatisfyApiSpec();
    expect(await status({ status: 'SHIPPED', trackingNumber: 'TH1' })).toSatisfyApiSpec();
  });
});
