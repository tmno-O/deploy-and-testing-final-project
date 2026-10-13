// ตรวจว่า response จริงตรงกับ docs/openapi.yaml (ที่ส่งให้ทีมอื่นใช้)
const path = require('path');
const request = require('supertest');
const jestOpenAPI = require('jest-openapi').default;
const { createApp } = require('../../src/app');
const { resetStore } = require('../helpers/store');
const { card, userWithCards, createOrder } = require('../helpers/factory');
const t = require('../helpers/tokens');

jestOpenAPI(path.join(__dirname, '../../docs/openapi.yaml'));

const app = createApp();
beforeEach(resetStore);

describe('responses match docs/openapi.yaml', () => {
  it('health', async () => {
    expect(await request(app).get('/health')).toSatisfyApiSpec();
    expect(await request(app).get('/health/ready')).toSatisfyApiSpec();
  });

  it('collection endpoints', async () => {
    const { userId, auth } = await userWithCards(app, { 'CARD-001': 2 });
    expect(await request(app).get('/collections/me').set(auth)).toSatisfyApiSpec();
    expect(await request(app).get('/collections/me/CARD-001').set(auth)).toSatisfyApiSpec();
    expect(await request(app).get('/collections/me/CARD-404').set(auth)).toSatisfyApiSpec();
    expect(await request(app).get('/collections/me')).toSatisfyApiSpec();
    expect(await request(app).get(`/internal/collections/${userId}`).set(t.serviceKey())).toSatisfyApiSpec();
  });

  it('internal add card (201, 200, 400)', async () => {
    const userId = t.newUserId();
    const body = card('CARD-001');
    const post = (b) => request(app).post(`/internal/collections/${userId}/cards`).set(t.serviceKey()).send(b);
    expect(await post(body)).toSatisfyApiSpec();
    expect(await post(body)).toSatisfyApiSpec();
    expect(await post({ ...body, pullId: 'x' })).toSatisfyApiSpec();
  });

  it('order endpoints', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 2 });
    const created = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }]);
    expect(created).toSatisfyApiSpec();
    const { id } = created.body.order;
    expect(await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 5 }])).toSatisfyApiSpec();
    expect(await request(app).get('/fulfillments/orders').set(auth)).toSatisfyApiSpec();
    expect(await request(app).get(`/fulfillments/orders/${id}`).set(auth)).toSatisfyApiSpec();
    expect(await request(app).patch(`/admin/fulfillments/orders/${id}/status`).set(t.adminKey()).send({ status: 'PROCESSING' })).toSatisfyApiSpec();
    expect(await request(app).post(`/fulfillments/orders/${id}/cancel`).set(auth)).toSatisfyApiSpec();
    expect(await request(app).patch(`/admin/fulfillments/orders/${id}/status`).set(t.adminKey()).send({ status: 'SHIPPED', trackingNumber: 'TH1' })).toSatisfyApiSpec();
  });
});
