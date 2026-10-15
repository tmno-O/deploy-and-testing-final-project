import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AppConfig } from '../../src/config/app-config';
import type { StoreService } from '../../src/store/store.service';
import { createTestApp } from '../helpers/app';
import { internalKey, newId } from '../helpers/auth';
import {
  balanceOf,
  catalogPack,
  charge,
  fund,
  json,
  key,
  mockCatalog,
  newUser,
  purchase,
  refund,
  topup,
} from '../helpers/fixtures';

describe('internal API (gacha-service and collection-service)', () => {
  let app: INestApplication;
  let store: StoreService;
  let config: AppConfig;
  let originalCatalog: AppConfig['catalog'];

  beforeAll(async () => {
    ({ app, store, config } = await createTestApp());
    originalCatalog = { ...config.catalog };
  });
  beforeEach(() => store.reset());
  afterEach(() => {
    jest.restoreAllMocks();
    Object.assign(config.catalog, originalCatalog);
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  describe('GET /internal/wallets/:userId', () => {
    test('returns the balance of any user', async () => {
      const user = newUser();
      await fund(app, user, 120);
      const res = await http().get(`/internal/wallets/${user.userId}`).set(internalKey());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ userId: user.userId, balance: 120 });
    });

    test('unknown users have 0 and an invalid id is rejected', async () => {
      const res = await http().get(`/internal/wallets/${newId()}`).set(internalKey());
      expect(res.body.balance).toBe(0);
      const bad = await http().get('/internal/wallets/bad%20id').set(internalKey());
      expect(bad.status).toBe(400);
    });
  });

  describe('POST /internal/wallets/:userId/charge', () => {
    test('takes credit and records a charge', async () => {
      const user = newUser();
      await fund(app, user, 200);
      const res = await charge(app, user.userId, { amount: 50, reason: 'Shipping fee', idempotencyKey: key('order') });
      expect(res.status).toBe(201);
      expect(res.body.balance).toBe(150);
      expect(res.body.transaction).toMatchObject({
        type: 'charge',
        direction: 'debit',
        amount: 50,
        balanceBefore: 200,
        balanceAfter: 150,
        reason: 'Shipping fee',
      });
      expect(await balanceOf(app, user)).toBe(150);
    });

    test('the idempotency key can also come in the header', async () => {
      const user = newUser();
      await fund(app, user, 100);
      const res = await http()
        .post(`/internal/wallets/${user.userId}/charge`)
        .set(internalKey())
        .set('Idempotency-Key', key('hdr'))
        .send({ amount: 10 });
      expect(res.status).toBe(201);
      expect(res.body.transaction.reason).toBeNull();
    });

    test('not enough credit -> 402 INSUFFICIENT_BALANCE, nothing changes, key is not used up', async () => {
      const user = newUser();
      await fund(app, user, 30);
      const k = key('poor');
      const res = await charge(app, user.userId, { amount: 31, idempotencyKey: k });
      expect(res.status).toBe(402);
      expect(res.body.error).toMatchObject({
        code: 'INSUFFICIENT_BALANCE',
        details: { balance: 30, required: 31 },
      });
      expect(await balanceOf(app, user)).toBe(30);
      expect(store.data.transactions).toHaveLength(1); // only the top-up

      await fund(app, user, 10); // user tops up and the caller retries with the same key
      const retry = await charge(app, user.userId, { amount: 31, idempotencyKey: k });
      expect(retry.status).toBe(201);
      expect(retry.body.balance).toBe(9);
    });

    test('a user who never had a wallet cannot be charged and no wallet is created for them', async () => {
      const res = await charge(app, newId(), { amount: 5, idempotencyKey: key() });
      expect(res.status).toBe(402);
      expect(store.data.wallets).toHaveLength(0);
    });

    test('can spend the exact balance down to 0 but never below', async () => {
      const user = newUser();
      await fund(app, user, 100);
      expect((await charge(app, user.userId, { amount: 100, idempotencyKey: key() })).body.balance).toBe(0);
      expect((await charge(app, user.userId, { amount: 1, idempotencyKey: key() })).status).toBe(402);
    });

    test('a repeated key charges once (the caller retried after a timeout)', async () => {
      const user = newUser();
      await fund(app, user, 100);
      const k = key('order');
      const first = await charge(app, user.userId, { amount: 50, reason: 'Shipping', idempotencyKey: k });
      const again = await charge(app, user.userId, { amount: 50, reason: 'Shipping (retry text)', idempotencyKey: k });
      expect(again.status).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.transactionId).toBe(first.body.transactionId);
      expect(await balanceOf(app, user)).toBe(50);
    });

    test('the same key with another amount -> 422 IDEMPOTENCY_KEY_REUSED', async () => {
      const user = newUser();
      await fund(app, user, 100);
      const k = key('order');
      await charge(app, user.userId, { amount: 50, idempotencyKey: k });
      const res = await charge(app, user.userId, { amount: 60, idempotencyKey: k });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await balanceOf(app, user)).toBe(50);
    });

    test('a key used for a top-up cannot be reused for a charge', async () => {
      const user = newUser();
      const k = key('mixed');
      await topup(app, user, 100, k);
      const res = await charge(app, user.userId, { amount: 100, idempotencyKey: k });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    test('many requests at once can never spend more than the balance', async () => {
      const user = newUser();
      await fund(app, user, 100);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => charge(app, user.userId, { amount: 30, idempotencyKey: key('race') })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 402)).toHaveLength(7);
      expect(await balanceOf(app, user)).toBe(10);
    });

    test.each([
      ['no amount', { idempotencyKey: 'order-12345678' }],
      ['zero', { amount: 0, idempotencyKey: 'order-12345678' }],
      ['negative (would add credit)', { amount: -50, idempotencyKey: 'order-12345678' }],
      ['decimal', { amount: 1.5, idempotencyKey: 'order-12345678' }],
      ['a numeric string', { amount: '50', idempotencyKey: 'order-12345678' }],
      ['an empty reason', { amount: 5, reason: '', idempotencyKey: 'order-12345678' }],
      ['an unknown field', { amount: 5, idempotencyKey: 'order-12345678', balance: 9 }],
      ['no idempotency key', { amount: 5 }],
    ])('%s -> 400 VALIDATION_ERROR', async (_name, body) => {
      const res = await charge(app, newId(), body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /internal/wallets/:userId/purchases', () => {
    test('charges the price published by the catalog and returns a transaction id', async () => {
      const fetch = mockCatalog({ starter: catalogPack('starter', 100) });
      const user = newUser();
      await fund(app, user, 250);
      const res = await purchase(app, user.userId, { packId: 'starter', idempotencyKey: key('buy') });
      expect(res.status).toBe(201);
      expect(res.body.balance).toBe(150);
      expect(res.body.transaction).toMatchObject({
        type: 'purchase',
        direction: 'debit',
        amount: 100,
        packId: 'starter',
        reason: 'Pack purchase: Pack starter',
      });
      expect(String(fetch.mock.calls[0][0])).toBe('http://catalog.test/packs/starter');
    });

    test('there is no way to send a price: the catalog decides', async () => {
      mockCatalog({ starter: catalogPack('starter', 100) });
      const user = newUser();
      await fund(app, user, 500);
      const res = await purchase(app, user.userId, { packId: 'starter', price: 1, amount: 1, idempotencyKey: key() });
      expect(res.status).toBe(400);
      expect(await balanceOf(app, user)).toBe(500);
    });

    test('follows a price change in the catalog (nothing is cached)', async () => {
      const packs = { starter: catalogPack('starter', 100) };
      mockCatalog(packs);
      const user = newUser();
      await fund(app, user, 1000);
      await purchase(app, user.userId, { packId: 'starter', idempotencyKey: key('a') });
      packs.starter = catalogPack('starter', 250);
      const res = await purchase(app, user.userId, { packId: 'starter', idempotencyKey: key('b') });
      expect(res.body.transaction.amount).toBe(250);
      expect(await balanceOf(app, user)).toBe(650);
    });

    test('not enough credit -> 402 and the user keeps their credit', async () => {
      mockCatalog({ starter: catalogPack('starter', 100) });
      const user = newUser();
      await fund(app, user, 99);
      const res = await purchase(app, user.userId, { packId: 'starter', idempotencyKey: key() });
      expect(res.status).toBe(402);
      expect(res.body.error.details).toEqual({ balance: 99, required: 100 });
      expect(await balanceOf(app, user)).toBe(99);
    });

    test('forwards X-Request-Id to the catalog', async () => {
      const fetch = mockCatalog({ starter: catalogPack('starter', 10) });
      const user = newUser();
      await fund(app, user, 10);
      await purchase(app, user.userId, { packId: 'starter', idempotencyKey: key() }).set('X-Request-Id', 'trace-42');
      const headers = fetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['X-Request-Id']).toBe('trace-42');
    });

    test('unknown or inactive pack -> 422 PACK_NOT_FOUND and nothing is charged', async () => {
      mockCatalog({});
      const user = newUser();
      await fund(app, user, 100);
      const res = await purchase(app, user.userId, { packId: 'ghost', idempotencyKey: key() });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PACK_NOT_FOUND');
      expect(await balanceOf(app, user)).toBe(100);
    });

    test('catalog down, slow, broken or not configured -> 503 CATALOG_SERVICE_UNAVAILABLE and nothing is charged', async () => {
      const user = newUser();
      await fund(app, user, 100);
      const body = () => ({ packId: 'starter', idempotencyKey: key() });

      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));
      expect((await purchase(app, user.userId, body())).status).toBe(503);

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(json(500, {}));
      expect((await purchase(app, user.userId, body())).status).toBe(503);

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(json(200, { id: 'starter' }));
      expect((await purchase(app, user.userId, body())).status).toBe(503);

      const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(timeout);
      const slow = await purchase(app, user.userId, body());
      expect(slow.status).toBe(503);
      expect(slow.body.error.code).toBe('CATALOG_SERVICE_UNAVAILABLE');

      config.catalog.url = '';
      const off = await purchase(app, user.userId, body());
      expect(off.status).toBe(503);
      expect(off.body.error.message).toContain('not configured');

      expect(await balanceOf(app, user)).toBe(100);
    });

    test('a repeated key replays the purchase even if the catalog is down or the price changed', async () => {
      const packs = { starter: catalogPack('starter', 100) };
      mockCatalog(packs);
      const user = newUser();
      await fund(app, user, 300);
      const k = key('buy');
      const first = await purchase(app, user.userId, { packId: 'starter', idempotencyKey: k });

      jest.restoreAllMocks();
      const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
      const again = await purchase(app, user.userId, { packId: 'starter', idempotencyKey: k });
      expect(again.status).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body).toEqual(first.body);
      expect(fetch).not.toHaveBeenCalled();
      expect(await balanceOf(app, user)).toBe(200);
    });

    test('the same key for another pack -> 422 IDEMPOTENCY_KEY_REUSED', async () => {
      mockCatalog({ a: catalogPack('a', 10), b: catalogPack('b', 10) });
      const user = newUser();
      await fund(app, user, 100);
      const k = key('buy');
      await purchase(app, user.userId, { packId: 'a', idempotencyKey: k });
      const res = await purchase(app, user.userId, { packId: 'b', idempotencyKey: k });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await balanceOf(app, user)).toBe(90);
    });

    test('parallel requests with one key buy one pack', async () => {
      mockCatalog({ starter: catalogPack('starter', 100) });
      const user = newUser();
      await fund(app, user, 500);
      const k = key('buy');
      const results = await Promise.all(
        Array.from({ length: 6 }, () => purchase(app, user.userId, { packId: 'starter', idempotencyKey: k })),
      );
      expect(new Set(results.map((r) => r.body.transactionId)).size).toBe(1);
      expect(await balanceOf(app, user)).toBe(400);
    });

    test.each([
      ['no packId', {}],
      ['a packId that is not a plain id', { packId: '../admin' }],
      ['an empty packId', { packId: '' }],
    ])('%s -> 400', async (_name, body) => {
      const res = await purchase(app, newId(), { ...body, idempotencyKey: key() });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /internal/wallets/:userId/refund', () => {
    test('gives credit back (what collection-service sends: amount + key only)', async () => {
      const user = newUser();
      await fund(app, user, 100);
      await charge(app, user.userId, { amount: 50, idempotencyKey: 'order-1234' });
      const res = await refund(app, user.userId, { amount: 50, idempotencyKey: 'refund-order-1234' });
      expect(res.status).toBe(201);
      expect(res.body.transaction).toMatchObject({ type: 'refund', direction: 'credit', amount: 50, refundOf: null });
      expect(await balanceOf(app, user)).toBe(100);
    });

    test('a repeated key refunds once', async () => {
      const user = newUser();
      await fund(app, user, 100);
      await charge(app, user.userId, { amount: 50, idempotencyKey: 'order-1234' });
      const first = await refund(app, user.userId, { amount: 50, idempotencyKey: 'refund-order-1234' });
      const again = await refund(app, user.userId, { amount: 50, idempotencyKey: 'refund-order-1234' });
      expect(again.status).toBe(200);
      expect(again.body.transactionId).toBe(first.body.transactionId);
      expect(await balanceOf(app, user)).toBe(100);
    });

    test('refunds are not limited by MAX_BALANCE', async () => {
      const user = newUser();
      await fund(app, user, 100);
      const spent = await charge(app, user.userId, { amount: 100, idempotencyKey: key() });
      config.payment.maxBalance = 10;
      const res = await refund(app, user.userId, { amount: 100, transactionId: spent.body.transactionId, idempotencyKey: key() });
      config.payment.maxBalance = 10_000_000;
      expect(res.status).toBe(201);
    });

    describe('tied to the original charge (transactionId)', () => {
      async function spent(amount = 100) {
        const user = newUser();
        await fund(app, user, 500);
        const res = await charge(app, user.userId, { amount, idempotencyKey: key('order') });
        return { user, txId: res.body.transactionId as string };
      }

      test('a full refund works', async () => {
        const { user, txId } = await spent();
        const res = await refund(app, user.userId, { amount: 100, transactionId: txId, idempotencyKey: key() });
        expect(res.status).toBe(201);
        expect(res.body.transaction.refundOf).toBe(txId);
        expect(await balanceOf(app, user)).toBe(500);
      });

      test('partial refunds are allowed until the charge is used up', async () => {
        const { user, txId } = await spent();
        expect((await refund(app, user.userId, { amount: 60, transactionId: txId, idempotencyKey: key() })).status).toBe(201);
        const over = await refund(app, user.userId, { amount: 41, transactionId: txId, idempotencyKey: key() });
        expect(over.status).toBe(409);
        expect(over.body.error).toMatchObject({
          code: 'REFUND_EXCEEDS_CHARGE',
          details: { charged: 100, refunded: 60, requested: 41 },
        });
        expect((await refund(app, user.userId, { amount: 40, transactionId: txId, idempotencyKey: key() })).status).toBe(201);
        expect(await balanceOf(app, user)).toBe(500);
      });

      test('refunding a purchase works the same way', async () => {
        mockCatalog({ starter: catalogPack('starter', 100) });
        const user = newUser();
        await fund(app, user, 100);
        const bought = await purchase(app, user.userId, { packId: 'starter', idempotencyKey: key('buy') });
        const res = await refund(app, user.userId, {
          amount: 100,
          transactionId: bought.body.transactionId,
          reason: 'Gacha could not give the cards',
          idempotencyKey: key('undo'),
        });
        expect(res.status).toBe(201);
        expect(res.body.transaction.reason).toBe('Gacha could not give the cards');
        expect(await balanceOf(app, user)).toBe(100);
      });

      test('a top-up cannot be refunded', async () => {
        const user = newUser();
        const up = await topup(app, user, 100);
        const res = await refund(app, user.userId, { amount: 100, transactionId: up.body.transactionId, idempotencyKey: key() });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('NOT_REFUNDABLE');
        expect(await balanceOf(app, user)).toBe(100);
      });

      test("another user's charge or an unknown id cannot be refunded", async () => {
        const { txId } = await spent();
        const stranger = newUser();
        const other = await refund(app, stranger.userId, { amount: 10, transactionId: txId, idempotencyKey: key() });
        expect(other.status).toBe(422);
        expect(other.body.error.code).toBe('TRANSACTION_NOT_FOUND');
        const unknown = await refund(app, stranger.userId, { amount: 10, transactionId: newId(), idempotencyKey: key() });
        expect(unknown.body.error.code).toBe('TRANSACTION_NOT_FOUND');
        expect(await balanceOf(app, stranger)).toBe(0);
        expect(store.data.wallets.find((w) => w.userId === stranger.userId)).toBeUndefined();
      });

      test('parallel refunds of one charge cannot exceed it', async () => {
        const { user, txId } = await spent();
        const results = await Promise.all(
          Array.from({ length: 6 }, () => refund(app, user.userId, { amount: 40, transactionId: txId, idempotencyKey: key() })),
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(2);
        expect(results.filter((r) => r.status === 409)).toHaveLength(4);
        expect(await balanceOf(app, user)).toBe(480);
      });

      test('a retried refund replays even when the charge is already fully refunded', async () => {
        const { user, txId } = await spent();
        const k = key('undo');
        const first = await refund(app, user.userId, { amount: 100, transactionId: txId, idempotencyKey: k });
        const again = await refund(app, user.userId, { amount: 100, transactionId: txId, idempotencyKey: k });
        expect(again.status).toBe(200);
        expect(again.body.transactionId).toBe(first.body.transactionId);
      });
    });

    test.each([
      ['a negative amount', { amount: -1 }],
      ['a transactionId that is not a uuid', { amount: 5, transactionId: 'abc' }],
      ['an unknown field', { amount: 5, balance: 1 }],
    ])('%s -> 400', async (_name, body) => {
      const res = await refund(app, newId(), { ...body, idempotencyKey: key() });
      expect(res.status).toBe(400);
    });
  });

  describe('contract expected by collection-service (WalletClient)', () => {
    // collection-service/src/clients/wallet.client.ts sends exactly these bodies and reads `transactionId`.
    test('charge { amount, reason, idempotencyKey: orderId } -> 201 { transactionId } / 402', async () => {
      const user = newUser();
      const orderId = newId();
      await fund(app, user, 100);

      const ok = await charge(app, user.userId, {
        amount: 50,
        reason: `Shipping fee for order ${orderId}`,
        idempotencyKey: orderId,
      });
      expect([200, 201]).toContain(ok.status);
      expect(typeof ok.body.transactionId).toBe('string');

      const poor = await charge(app, user.userId, { amount: 500, reason: 'x', idempotencyKey: newId() });
      expect(poor.status).toBe(402);
    });

    test('refund { amount, idempotencyKey: "refund-<orderId>" } -> 201 { transactionId }', async () => {
      const user = newUser();
      const orderId = newId();
      await fund(app, user, 100);
      await charge(app, user.userId, { amount: 50, reason: 'r', idempotencyKey: orderId });
      const res = await refund(app, user.userId, { amount: 50, idempotencyKey: `refund-${orderId}` });
      expect([200, 201]).toContain(res.status);
      expect(typeof res.body.transactionId).toBe('string');
    });
  });
});
