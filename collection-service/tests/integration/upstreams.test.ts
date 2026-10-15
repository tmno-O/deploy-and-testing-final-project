// The Catalog / Wallet / User Service links over the real HTTP client, with global fetch standing in for them.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AppConfig } from '../../src/config/app-config';
import type { StoreService } from '../../src/store/store.service';
import { bearer, internalKey, newId, signToken } from '../helpers/auth';
import { createTestApp } from '../helpers/app';
import { cardBody, createOrder, grant, userWithCards, validAddress } from '../helpers/fixtures';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const down = () => Promise.reject(new TypeError('fetch failed'));

type Route = { path: string; reply: () => Response | Promise<Response> };

function mockUpstreams(routes: Route[]) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    const route = routes.find((r) => String(url).includes(r.path));
    if (!route) throw new Error(`unexpected fetch ${String(url)}`);
    return route.reply();
  });
}
const callsTo = (fetch: jest.SpyInstance, path: string) =>
  fetch.mock.calls.filter(([url]) => String(url).includes(path)) as [URL, RequestInit][];
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

/** card-catalog-service `GET /cards/:id` response (trimmed). */
const catalogCard = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: 'Charizard ex',
  rarity: 'legendary',
  imageSmall: `https://images.pokemontcg.io/sv3pt5/199.png`,
  imageLarge: `https://images.pokemontcg.io/sv3pt5/199_hires.png`,
  setId: 'sv3pt5',
  available: 3,
  ...overrides,
});

describe('upstream services', () => {
  let app: INestApplication;
  let store: StoreService;
  let config: AppConfig;
  let original: Pick<AppConfig, 'catalog' | 'wallet'>;

  beforeAll(async () => {
    ({ app, store, config } = await createTestApp());
    original = { catalog: { ...config.catalog }, wallet: { ...config.wallet } };
  });
  beforeEach(() => store.reset());
  afterEach(() => {
    jest.restoreAllMocks();
    Object.assign(config.catalog, original.catalog);
    Object.assign(config.wallet, original.wallet);
  });
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const enableWallet = () => Object.assign(config.wallet, { enabled: true, url: 'http://wallet.test' });

  describe('Catalog enabled', () => {
    beforeEach(() => (config.catalog.url = 'http://catalog.test'));
    const userId = newId();
    const add = (body: object) => http().post(`/internal/collections/${userId}/cards`).set(internalKey()).send(body);

    test('takes card data from the catalog, not the payload', async () => {
      const fetch = mockUpstreams([{ path: '/cards/sv3pt5-199', reply: () => json(200, catalogCard('sv3pt5-199')) }]);
      const res = await add({ pullId: newId(), cardId: 'sv3pt5-199', cardName: 'Fake', cardRarity: 'common' });
      expect(res.status).toBe(201);
      expect(res.body.card).toMatchObject({
        cardId: 'sv3pt5-199',
        cardName: 'Charizard ex',
        cardRarity: 'legendary',
        cardImageUrl: 'https://images.pokemontcg.io/sv3pt5/199.png',
      });
      expect(String(callsTo(fetch, '/cards/')[0][0])).toBe('http://catalog.test/cards/sv3pt5-199');
    });

    test('returns 422 for a card the catalog does not know', async () => {
      mockUpstreams([{ path: '/cards/', reply: () => json(404, { error: { code: 'CARD_NOT_FOUND' } }) }]);
      const res = await add({ pullId: newId(), cardId: 'base1-999' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('CARD_NOT_FOUND');
    });

    test.each([
      ['down', down],
      ['an unexpected body', () => json(200, { id: 'x', name: 'n', rarity: 'RARE' })],
    ])('returns 503 and adds nothing when the catalog is %s', async (_label, reply) => {
      mockUpstreams([{ path: '/cards/', reply }]);
      const res = await add({ pullId: newId(), cardId: 'base1-1' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('CATALOG_SERVICE_UNAVAILABLE');
      expect(store.data.collections).toEqual([]);
      expect(store.data.pulls).toEqual([]);
    });
  });

  describe('Catalog disabled', () => {
    test('returns 400 when cardName is missing and never calls the catalog', async () => {
      const fetch = jest.spyOn(global, 'fetch');
      const res = await grant(app, newId(), 'base1-1', 1, { cardName: undefined });
      expect(res.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('Wallet enabled', () => {
    beforeEach(enableWallet);
    const one = [{ cardId: 'base1-1', quantity: 1 }];

    test('charges the shipping fee with X-Internal-Key and marks the order PAID', async () => {
      const { auth, userId } = await userWithCards(app, { 'base1-1': 1 });
      const fetch = mockUpstreams([{ path: '/charge', reply: () => json(201, { transactionId: 'tx-1' }) }]);
      const res = await createOrder(app, auth, one);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ paymentStatus: 'PAID', paymentRef: 'tx-1' });
      const [url, init] = callsTo(fetch, '/charge')[0];
      expect(String(url)).toBe(`http://wallet.test/internal/wallets/${userId}/charge`);
      expect(headersOf(init)['X-Internal-Key']).toBe(process.env.INTERNAL_API_KEY);
      expect(JSON.parse(init.body as string)).toMatchObject({ amount: 50, idempotencyKey: res.body.id });
    });

    test.each([
      ['insufficient balance', () => json(402, { error: { code: 'INSUFFICIENT_BALANCE' } }), 402, 'INSUFFICIENT_BALANCE'],
      ['wallet down', down, 503, 'WALLET_SERVICE_UNAVAILABLE'],
      ['wallet answers 500', () => json(500, {}), 503, 'WALLET_SERVICE_UNAVAILABLE'],
      ['no transactionId', () => json(201, {}), 503, 'WALLET_SERVICE_UNAVAILABLE'],
    ])('%s -> no order and cards returned', async (_label, reply, status, code) => {
      const { auth } = await userWithCards(app, { 'base1-1': 1 });
      mockUpstreams([{ path: '/charge', reply }]);
      const res = await createOrder(app, auth, one);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      expect(store.data.orders).toEqual([]);
      expect((await http().get('/collections/me/base1-1').set(auth)).body.availableQuantity).toBe(1);
    });

    test('does not call the wallet for free shipping', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 5 });
      const fetch = jest.spyOn(global, 'fetch');
      const res = await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 5 }]);
      expect(res.body.paymentStatus).toBe('NOT_REQUIRED');
      expect(fetch).not.toHaveBeenCalled();
    });

    test('refunds a PAID order on cancel', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 1 });
      const fetch = mockUpstreams([
        { path: '/charge', reply: () => json(201, { transactionId: 'tx-1' }) },
        { path: '/refund', reply: () => json(200, { transactionId: 'tx-2' }) },
      ]);
      const { id } = (await createOrder(app, auth, one)).body;
      const res = await http().post(`/fulfillments/orders/${id}/cancel`).set(auth);
      expect(res.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
      expect(JSON.parse(callsTo(fetch, '/refund')[0][1].body as string)).toEqual({
        amount: 50,
        idempotencyKey: `refund-${id}`,
      });
    });

    test('keeps the order unchanged when the refund fails', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 1 });
      mockUpstreams([
        { path: '/charge', reply: () => json(201, { transactionId: 'tx-1' }) },
        { path: '/refund', reply: down },
      ]);
      const { id } = (await createOrder(app, auth, one)).body;
      const res = await http().post(`/fulfillments/orders/${id}/cancel`).set(auth);
      expect(res.status).toBe(503);
      expect((await http().get(`/fulfillments/orders/${id}`).set(auth)).body).toMatchObject({
        status: 'PENDING',
        paymentStatus: 'PAID',
      });
    });
  });

  describe('Wallet disabled', () => {
    test('never calls the wallet and leaves paymentStatus NOT_REQUIRED', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 1 });
      const fetch = jest.spyOn(global, 'fetch');
      const { id, paymentStatus } = (await createOrder(app, auth, [{ cardId: 'base1-1', quantity: 1 }])).body;
      await http().post(`/fulfillments/orders/${id}/cancel`).set(auth);
      expect(paymentStatus).toBe('NOT_REQUIRED');
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('user-service over HTTP', () => {
    const order = (auth: object, addressId: string) =>
      createOrder(app, auth as { Authorization: string }, [{ cardId: 'base1-1', quantity: 1 }], { addressId });

    test('forwards the token and X-Request-Id to user-service', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 1 });
      const addressId = newId();
      const fetch = mockUpstreams([
        { path: `/users/me/addresses/${addressId}`, reply: () => json(200, { address: { id: addressId, ...validAddress() } }) },
      ]);
      const res = await order(auth, addressId).set('X-Request-Id', 'trace-42');
      expect(res.status).toBe(201);
      expect(res.headers['x-request-id']).toBe('trace-42');
      const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
      expect(String(url)).toBe(`${config.userService.url}/users/me/addresses/${addressId}`);
      expect(init.headers).toMatchObject({ Authorization: auth.Authorization, 'X-Request-Id': 'trace-42' });
    });

    test.each([
      ['down', down, 503, 'USER_SERVICE_UNAVAILABLE'],
      ['404', () => json(404, {}), 422, 'ADDRESS_NOT_FOUND'],
      ['401', () => json(401, {}), 401, 'INVALID_TOKEN'],
      ['400', () => json(400, {}), 400, 'VALIDATION_ERROR'],
      ['an unexpected body', () => json(200, { nope: true }), 503, 'USER_SERVICE_UNAVAILABLE'],
      ['invalid JSON', () => new Response('<html>', { status: 200 }), 503, 'USER_SERVICE_UNAVAILABLE'],
    ])('user-service %s -> %s %s', async (_label, reply, status, code) => {
      const { auth } = await userWithCards(app, { 'base1-1': 1 });
      mockUpstreams([{ path: '/users/me/addresses/', reply }]);
      const res = await order(auth, newId());
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    });

    test('forwards X-Request-Id to the catalog and wallet too', async () => {
      enableWallet();
      config.catalog.url = 'http://catalog.test';
      const userId = newId();
      const fetch = mockUpstreams([
        { path: '/cards/', reply: () => json(200, catalogCard('base1-1')) },
        { path: '/charge', reply: () => json(201, { transactionId: 'tx' }) },
      ]);
      await http()
        .post(`/internal/collections/${userId}/cards`)
        .set(internalKey())
        .set('X-Request-Id', 'trace-c')
        .send({ pullId: cardBody().pullId, cardId: 'base1-1' });
      await createOrder(app, bearer(signToken(userId)), [{ cardId: 'base1-1', quantity: 1 }]).set('X-Request-Id', 'trace-w');
      expect(headersOf(callsTo(fetch, '/cards/')[0][1])['X-Request-Id']).toBe('trace-c');
      expect(headersOf(callsTo(fetch, '/charge')[0][1])['X-Request-Id']).toBe('trace-w');
    });
  });
});
