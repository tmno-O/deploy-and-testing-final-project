import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppError } from '../../src/common/app-error';
import type { AppConfig } from '../../src/config/app-config';
import type { PaymentProvider } from '../../src/payments/payment-provider';
import type { StoreService } from '../../src/store/store.service';
import { createTestApp } from '../helpers/app';
import { balanceOf, key, newUser, topup } from '../helpers/fixtures';

describe('showing the balance and topping up', () => {
  let app: INestApplication;
  let store: StoreService;
  let config: AppConfig;
  let original: AppConfig['payment'];

  beforeAll(async () => {
    ({ app, store, config } = await createTestApp());
    original = { ...config.payment };
  });
  beforeEach(() => store.reset());
  afterEach(() => Object.assign(config.payment, original));
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  describe('GET /wallets/me', () => {
    test('a new user has 0 credits and reading does not create a wallet', async () => {
      const user = newUser();
      const res = await http().get('/wallets/me').set(user.auth);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: user.userId, balance: 0, createdAt: null, updatedAt: null });
      expect(store.data.wallets).toHaveLength(0);
    });

    test('shows the balance after a top-up', async () => {
      const user = newUser();
      await topup(app, user, 250);
      const res = await http().get('/wallets/me').set(user.auth);
      expect(res.body).toMatchObject({ userId: user.userId, balance: 250 });
      expect(res.body.createdAt).toEqual(expect.any(String));
    });

    test('every user only sees their own wallet', async () => {
      const [a, b] = [newUser(), newUser()];
      await topup(app, a, 500);
      expect(await balanceOf(app, a)).toBe(500);
      expect(await balanceOf(app, b)).toBe(0);
    });
  });

  describe('GET /wallets/topup-methods', () => {
    test('lists the provider, methods and limits', async () => {
      const res = await http().get('/wallets/topup-methods');
      expect(res.body).toEqual({
        provider: 'mock',
        methods: ['mock'],
        minAmount: 1,
        maxAmount: 100_000,
        maxBalance: 10_000_000,
      });
    });
  });

  describe('POST /wallets/me/topups', () => {
    test('adds credit and records a topup transaction', async () => {
      const user = newUser();
      const k = key('topup');
      const res = await topup(app, user, 300, k);
      expect(res.status).toBe(201);
      expect(res.headers['idempotent-replayed']).toBeUndefined();
      expect(res.body.balance).toBe(300);
      expect(res.body.transactionId).toEqual(expect.any(String));
      expect(res.body.transaction).toMatchObject({
        id: res.body.transactionId,
        userId: user.userId,
        type: 'topup',
        direction: 'credit',
        amount: 300,
        balanceBefore: 0,
        balanceAfter: 300,
        method: 'mock',
        provider: 'mock',
        idempotencyKey: k,
      });
      expect(res.body.transaction.providerRef).toMatch(/^mock_/);
      expect(res.body.transaction).not.toHaveProperty('requestHash');
    });

    test('credits add up', async () => {
      const user = newUser();
      await topup(app, user, 100);
      const second = await topup(app, user, 50);
      expect(second.body.transaction).toMatchObject({ balanceBefore: 100, balanceAfter: 150 });
      expect(await balanceOf(app, user)).toBe(150);
    });

    test('the idempotency key can be sent in the body instead of the header', async () => {
      const user = newUser();
      const res = await http().post('/wallets/me/topups').set(user.auth).send({ amount: 10, idempotencyKey: key() });
      expect(res.status).toBe(201);
    });

    test('the method defaults to the first one the provider supports', async () => {
      const user = newUser();
      const res = await http().post('/wallets/me/topups').set(user.auth).set('Idempotency-Key', key()).send({ amount: 10 });
      expect(res.body.transaction.method).toBe('mock');
    });

    describe('input is validated', () => {
      const user = newUser();
      const send = (body: unknown, headers: Record<string, string> = { 'Idempotency-Key': key() }) =>
        http().post('/wallets/me/topups').set(user.auth).set(headers).send(body as object);

      test.each([
        ['missing amount', {}],
        ['zero', { amount: 0 }],
        ['negative', { amount: -5 }],
        ['decimal', { amount: 10.5 }],
        ['a string', { amount: '100' }],
        ['null', { amount: null }],
        ['an unknown field', { amount: 10, balance: 1_000_000 }],
        ['a user id in the body', { amount: 10, userId: 'someone-else' }],
      ])('%s -> 400 VALIDATION_ERROR and nothing is credited', async (_name, body) => {
        const res = await send(body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(store.data.transactions).toHaveLength(0);
      });

      test('amount outside the configured range', async () => {
        config.payment.topupMinAmount = 20;
        config.payment.topupMaxAmount = 1000;
        for (const amount of [19, 1001]) {
          const res = await send({ amount });
          expect(res.status).toBe(400);
          expect(res.body.error.details).toEqual([
            { path: 'amount', message: 'Must be between 20 and 1000' },
          ]);
        }
        expect((await send({ amount: 20 })).status).toBe(201);
      });

      test('unknown payment method', async () => {
        const res = await send({ amount: 10, method: 'bitcoin' });
        expect(res.status).toBe(400);
        expect(res.body.error.details[0].path).toBe('method');
      });

      test('the idempotency key is required and must be well formed', async () => {
        const missing = await send({ amount: 10 }, {});
        expect(missing.status).toBe(400);
        expect(missing.body.error.details[0].path).toBe('Idempotency-Key');
        for (const bad of ['short', 'has spaces in it', 'x'.repeat(101), 'slash/not/allowed']) {
          const res = await send({ amount: 10 }, { 'Idempotency-Key': bad });
          expect(res.status).toBe(400);
        }
        const badBody = await send({ amount: 10, idempotencyKey: 'short' }, {});
        expect(badBody.body.error.details[0].path).toBe('idempotencyKey');
      });

      test('header and body keys must agree', async () => {
        const res = await send({ amount: 10, idempotencyKey: 'body-key-12345' }, { 'Idempotency-Key': 'header-key-12345' });
        expect(res.status).toBe(400);
        const same = await send({ amount: 10, idempotencyKey: 'same-key-12345' }, { 'Idempotency-Key': 'same-key-12345' });
        expect(same.status).toBe(201);
      });
    });

    describe('the same request is never applied twice', () => {
      test('a retry with the same key replays the first result', async () => {
        const user = newUser();
        const k = key('retry');
        const first = await topup(app, user, 100, k);
        const second = await topup(app, user, 100, k);
        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect(second.headers['idempotent-replayed']).toBe('true');
        expect(second.body).toEqual(first.body);
        expect(await balanceOf(app, user)).toBe(100);
        expect(store.data.transactions).toHaveLength(1);
      });

      test('the same key with a different amount is refused', async () => {
        const user = newUser();
        const k = key('reuse');
        await topup(app, user, 100, k);
        const res = await topup(app, user, 999, k);
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
        expect(await balanceOf(app, user)).toBe(100);
      });

      test('two users may use the same key', async () => {
        const [a, b] = [newUser(), newUser()];
        const k = key('shared');
        expect((await topup(app, a, 10, k)).status).toBe(201);
        expect((await topup(app, b, 10, k)).status).toBe(201);
      });

      test('requests sent at the same time with one key credit once', async () => {
        const user = newUser();
        const k = key('parallel');
        const results = await Promise.all(Array.from({ length: 8 }, () => topup(app, user, 40, k)));
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect(results.filter((r) => r.status === 200)).toHaveLength(7);
        expect(new Set(results.map((r) => r.body.transactionId)).size).toBe(1);
        expect(await balanceOf(app, user)).toBe(40);
      });
    });

    test('a wallet cannot grow past MAX_BALANCE', async () => {
      config.payment.maxBalance = 500;
      config.payment.topupMaxAmount = 500;
      const user = newUser();
      expect((await topup(app, user, 400)).status).toBe(201);
      const res = await topup(app, user, 101);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BALANCE_LIMIT_EXCEEDED');
      expect((await topup(app, user, 100)).status).toBe(201);
      expect(await balanceOf(app, user)).toBe(500);
    });
  });
});

describe('topping up when the payment provider fails', () => {
  const decline = new AppError(402, 'PAYMENT_DECLINED', 'The payment was declined');
  const failing = (error: Error): PaymentProvider & { charge: jest.Mock } => ({
    name: 'mock',
    methods: ['mock'],
    charge: jest.fn().mockRejectedValue(error),
  });

  test('a declined payment credits nothing and does not use up the key', async () => {
    const provider = failing(decline);
    const { app, store } = await createTestApp({ provider });
    const user = newUser();
    const k = key('declined');

    const res = await topup(app, user, 100, k);
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PAYMENT_DECLINED');
    expect(store.data.transactions).toHaveLength(0);
    expect(store.data.wallets).toHaveLength(0);

    // the provider recovers: the same key may be tried again
    provider.charge.mockResolvedValue({ providerRef: 'ref-1' });
    const retry = await topup(app, user, 100, k);
    expect(retry.status).toBe(201);
    expect(retry.body.transaction.providerRef).toBe('ref-1');
    await app.close();
  });

  test('a replay never calls the provider again', async () => {
    const provider = { name: 'mock', methods: ['mock'], charge: jest.fn().mockResolvedValue({ providerRef: 'ref-1' }) };
    const { app } = await createTestApp({ provider });
    const user = newUser();
    const k = key('once');
    await topup(app, user, 100, k);
    await topup(app, user, 100, k);
    await topup(app, user, 100, k);
    expect(provider.charge).toHaveBeenCalledTimes(1);
    expect(provider.charge).toHaveBeenCalledWith({
      userId: user.userId,
      amount: 100,
      method: 'mock',
      idempotencyKey: k,
    });
    await app.close();
  });

  test('a key reused with another amount is refused before the provider is called', async () => {
    const provider = { name: 'mock', methods: ['mock'], charge: jest.fn().mockResolvedValue({ providerRef: 'r' }) };
    const { app } = await createTestApp({ provider });
    const user = newUser();
    const k = key('mismatch');
    await topup(app, user, 100, k);
    const res = await topup(app, user, 200, k);
    expect(res.status).toBe(422);
    expect(provider.charge).toHaveBeenCalledTimes(1);
    await app.close();
  });

  test('a provider that is down answers 503', async () => {
    const down = new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'try later');
    const { app, store } = await createTestApp({ provider: failing(down) });
    const res = await topup(app, newUser(), 100);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect(store.data.transactions).toHaveLength(0);
    await app.close();
  });
});
