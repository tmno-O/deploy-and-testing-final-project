// จุดเชื่อม Catalog / Wallet / user-service ผ่าน HTTP จริงของ httpClient โดย mock global.fetch แทนปลายทาง
const request = require('supertest');
const { createApp } = require('../../src/app');
const config = require('../../src/config');
const { resetStore, store } = require('../helpers/store');
const { card, grant, userWithCards, createOrder, validAddress } = require('../helpers/factory');
const t = require('../helpers/tokens');

const app = createApp();
const original = { catalog: { ...config.catalog }, wallet: { ...config.wallet } };

const json = (status, body) => new Response(JSON.stringify(body), { status });
const down = () => Promise.reject(new TypeError('fetch failed'));

// routes: [{ match: (url, init) => bool, reply: () => Response | Promise }]
function mockUpstreams(routes) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
    const route = routes.find((r) => String(url).includes(r.path));
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route.reply(init);
  });
}
const callsTo = (fetch, path) => fetch.mock.calls.filter(([url]) => String(url).includes(path));

beforeEach(resetStore);
afterEach(() => {
  jest.restoreAllMocks();
  Object.assign(config.catalog, original.catalog);
  Object.assign(config.wallet, original.wallet);
});

describe('Catalog enabled', () => {
  beforeEach(() => { config.catalog.url = 'http://catalog.test'; });
  const userId = t.newUserId();
  const add = (body) => request(app).post(`/internal/collections/${userId}/cards`).set(t.serviceKey()).send(body);

  it('takes card data from the catalog, not the payload', async () => {
    mockUpstreams([{ path: '/cards/CARD-001', reply: () => json(200, { cardId: 'CARD-001', name: 'Real Dragon', rarity: 'ULTRA_RARE', imageUrl: 'https://cdn.test/1.png' }) }]);
    const res = await add({ pullId: card().pullId, cardId: 'CARD-001', cardName: 'Fake', cardRarity: 'COMMON' });
    expect(res.status).toBe(201);
    expect(res.body.card).toMatchObject({ cardName: 'Real Dragon', cardRarity: 'ULTRA_RARE', cardImageUrl: 'https://cdn.test/1.png' });
  });

  it('returns 422 for a card the catalog does not know', async () => {
    mockUpstreams([{ path: '/cards/', reply: () => json(404, { error: { code: 'NOT_FOUND' } }) }]);
    const res = await add({ pullId: card().pullId, cardId: 'CARD-999' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CARD_NOT_FOUND');
  });

  it('returns 503 and adds nothing when the catalog is down', async () => {
    mockUpstreams([{ path: '/cards/', reply: down }]);
    const res = await add({ pullId: card().pullId, cardId: 'CARD-001' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('CATALOG_SERVICE_UNAVAILABLE');
    expect(store.data.collections).toEqual([]);
    expect(store.data.pulls).toEqual([]);
  });
});

describe('Catalog disabled', () => {
  it('returns 400 when cardName is missing and never calls the catalog', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const res = await grant(app, t.newUserId(), 'CARD-001', 1, { cardName: undefined });
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Wallet enabled', () => {
  beforeEach(() => Object.assign(config.wallet, { enabled: true, url: 'http://wallet.test' }));
  const one = [{ cardId: 'CARD-001', quantity: 1 }];

  it('charges the shipping fee and marks the order PAID', async () => {
    const { auth, userId } = await userWithCards(app, { 'CARD-001': 1 });
    const fetch = mockUpstreams([{ path: '/charge', reply: () => json(201, { transactionId: 'tx-1' }) }]);
    const res = await createOrder(app, auth, one);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ paymentStatus: 'PAID', paymentRef: 'tx-1' });
    const [url, init] = callsTo(fetch, '/charge')[0];
    expect(String(url)).toBe(`http://wallet.test/internal/wallets/${userId}/charge`);
    expect(JSON.parse(init.body)).toMatchObject({ amount: 50, idempotencyKey: res.body.order.id });
  });

  it.each([
    ['insufficient balance', () => json(402, { error: { code: 'INSUFFICIENT_BALANCE' } }), 402, 'INSUFFICIENT_BALANCE'],
    ['wallet down', down, 503, 'WALLET_SERVICE_UNAVAILABLE'],
  ])('%s → no order and cards returned', async (_label, reply, status, code) => {
    const { auth } = await userWithCards(app, { 'CARD-001': 1 });
    mockUpstreams([{ path: '/charge', reply }]);
    const res = await createOrder(app, auth, one);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(store.data.orders).toEqual([]);
    expect((await request(app).get('/collections/me/CARD-001').set(auth)).body.card.availableQuantity).toBe(1);
  });

  it('does not call the wallet for free shipping', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 5 });
    const fetch = jest.spyOn(global, 'fetch');
    const res = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 5 }]);
    expect(res.body.order.paymentStatus).toBe('NOT_REQUIRED');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refunds a PAID order on cancel', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 1 });
    const fetch = mockUpstreams([
      { path: '/charge', reply: () => json(201, { transactionId: 'tx-1' }) },
      { path: '/refund', reply: () => json(200, { transactionId: 'tx-2' }) },
    ]);
    const { id } = (await createOrder(app, auth, one)).body.order;
    const res = await request(app).post(`/fulfillments/orders/${id}/cancel`).set(auth);
    expect(res.body.order).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
    expect(JSON.parse(callsTo(fetch, '/refund')[0][1].body)).toEqual({ amount: 50, idempotencyKey: `refund-${id}` });
  });
});

describe('Wallet disabled', () => {
  it('never calls the wallet and leaves paymentStatus NOT_REQUIRED', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 1 });
    const fetch = jest.spyOn(global, 'fetch');
    const { id, paymentStatus } = (await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }])).body.order;
    await request(app).post(`/fulfillments/orders/${id}/cancel`).set(auth);
    expect(paymentStatus).toBe('NOT_REQUIRED');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('user-service over HTTP', () => {
  it('forwards the token and X-Request-Id to user-service', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 1 });
    const addressId = t.newUserId();
    const fetch = mockUpstreams([{ path: `/users/me/addresses/${addressId}`, reply: () => json(200, { address: { id: addressId, ...validAddress() } }) }]);
    const res = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }], { addressId }).set('X-Request-Id', 'trace-42');
    expect(res.status).toBe(201);
    expect(res.headers['x-request-id']).toBe('trace-42');
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(`${config.userService.url}/users/me/addresses/${addressId}`);
    expect(init.headers).toMatchObject({ Authorization: auth.Authorization, 'X-Request-Id': 'trace-42' });
  });

  it('returns 503 USER_SERVICE_UNAVAILABLE when user-service is down', async () => {
    const { auth } = await userWithCards(app, { 'CARD-001': 1 });
    mockUpstreams([{ path: '/users/me/addresses/', reply: down }]);
    const res = await createOrder(app, auth, [{ cardId: 'CARD-001', quantity: 1 }], { addressId: t.newUserId() });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('USER_SERVICE_UNAVAILABLE');
  });

  it('forwards X-Request-Id to the catalog and wallet too', async () => {
    Object.assign(config.wallet, { enabled: true, url: 'http://wallet.test' });
    config.catalog.url = 'http://catalog.test';
    const userId = t.newUserId();
    const fetch = mockUpstreams([
      { path: '/cards/', reply: () => json(200, { cardId: 'CARD-001', name: 'D', rarity: 'RARE', imageUrl: 'https://c.test/1.png' }) },
      { path: '/charge', reply: () => json(201, { transactionId: 'tx' }) },
    ]);
    await request(app).post(`/internal/collections/${userId}/cards`).set(t.serviceKey()).set('X-Request-Id', 'trace-c')
      .send({ pullId: card().pullId, cardId: 'CARD-001' });
    await createOrder(app, t.bearer(t.sign(userId)), [{ cardId: 'CARD-001', quantity: 1 }]).set('X-Request-Id', 'trace-w');
    expect(callsTo(fetch, '/cards/')[0][1].headers['X-Request-Id']).toBe('trace-c');
    expect(callsTo(fetch, '/charge')[0][1].headers['X-Request-Id']).toBe('trace-w');
  });
});
