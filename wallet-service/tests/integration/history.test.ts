import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StoreService } from '../../src/store/store.service';
import type { WalletService } from '../../src/wallet/wallet.service';
import { createTestApp } from '../helpers/app';
import { adminAuth, newId } from '../helpers/auth';
import { catalogPack, charge, fund, key, mockCatalog, newUser, purchase, refund, topup } from '../helpers/fixtures';

describe('transaction history and the admin audit', () => {
  let app: INestApplication;
  let store: StoreService;
  let wallets: WalletService;
  beforeAll(async () => ({ app, store, wallets } = await createTestApp()));
  beforeEach(() => store.reset());
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  /** top-up 500, pack 100, charge 50, refund 50 -> balance 400 */
  async function busyUser() {
    mockCatalog({ starter: catalogPack('starter', 100) });
    const user = newUser();
    await topup(app, user, 500);
    await purchase(app, user.userId, { packId: 'starter', idempotencyKey: key('buy') });
    const fee = await charge(app, user.userId, { amount: 50, reason: 'Shipping', idempotencyKey: key('fee') });
    await refund(app, user.userId, { amount: 50, transactionId: fee.body.transactionId, idempotencyKey: key('undo') });
    return user;
  }

  describe('GET /wallets/me/transactions', () => {
    test('lists the newest first with the running balance', async () => {
      const user = await busyUser();
      const res = await http().get('/wallets/me/transactions').set(user.auth);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 4, totalPages: 1 });
      expect(res.body.data.map((t: { type: string }) => t.type)).toEqual(['refund', 'charge', 'purchase', 'topup']);
      expect(res.body.data.map((t: { balanceAfter: number }) => t.balanceAfter)).toEqual([400, 350, 400, 500]);
    });

    test('filters by type and paginates', async () => {
      const user = await busyUser();
      const debits = await http().get('/wallets/me/transactions?type=charge').set(user.auth);
      expect(debits.body.total).toBe(1);
      const page = await http().get('/wallets/me/transactions?limit=2&page=2').set(user.auth);
      expect(page.body.data.map((t: { type: string }) => t.type)).toEqual(['purchase', 'topup']);
      expect(page.body).toMatchObject({ page: 2, limit: 2, total: 4, totalPages: 2 });
    });

    test('rejects bad query values', async () => {
      const user = newUser();
      for (const q of ['type=gift', 'page=0', 'limit=101', 'limit=abc']) {
        const res = await http().get(`/wallets/me/transactions?${q}`).set(user.auth);
        expect(res.status).toBe(400);
      }
    });

    test('only shows the signed-in user’s own transactions', async () => {
      await busyUser();
      const other = newUser();
      const res = await http().get('/wallets/me/transactions').set(other.auth);
      expect(res.body).toMatchObject({ data: [], total: 0, totalPages: 0 });
    });
  });

  describe('GET /wallets/me/transactions/:id', () => {
    test('returns one transaction', async () => {
      const user = newUser();
      const up = await topup(app, user, 70);
      const res = await http().get(`/wallets/me/transactions/${up.body.transactionId}`).set(user.auth);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: up.body.transactionId, amount: 70, type: 'topup' });
    });

    test('another user’s transaction and unknown ids look the same: 404', async () => {
      const [owner, other] = [newUser(), newUser()];
      const up = await topup(app, owner, 70);
      for (const id of [up.body.transactionId, newId()]) {
        const res = await http().get(`/wallets/me/transactions/${id}`).set(other.auth);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('TRANSACTION_NOT_FOUND');
      }
    });

    test('an id that is not a uuid -> 400', async () => {
      const res = await http().get('/wallets/me/transactions/abc').set(newUser().auth);
      expect(res.status).toBe(400);
    });
  });

  describe('admin', () => {
    test('GET /admin/wallets/:userId shows the wallet and a consistent audit', async () => {
      const user = await busyUser();
      const res = await http().get(`/admin/wallets/${user.userId}`).set(adminAuth());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        userId: user.userId,
        balance: 400,
        audit: { balance: 400, ledgerBalance: 400, transactionCount: 4, consistent: true },
      });
    });

    test('GET /admin/wallets/:userId/transactions lists any user’s history', async () => {
      const user = await busyUser();
      const res = await http().get(`/admin/wallets/${user.userId}/transactions?limit=2`).set(adminAuth());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 4, limit: 2 });
      expect(res.body.data[0].userId).toBe(user.userId);
    });

    test('an unknown user is simply an empty, consistent wallet', async () => {
      const res = await http().get(`/admin/wallets/${newId()}`).set(adminAuth());
      expect(res.body).toMatchObject({
        balance: 0,
        audit: { ledgerBalance: 0, transactionCount: 0, consistent: true },
      });
    });

    test('the audit notices a balance that does not match the ledger', async () => {
      const user = await busyUser();
      store.data.wallets.find((w) => w.userId === user.userId)!.balance += 1_000;
      const res = await http().get(`/admin/wallets/${user.userId}`).set(adminAuth());
      expect(res.body.audit).toMatchObject({ balance: 1400, ledgerBalance: 400, consistent: false });
    });

    test('the audit notices a tampered or missing ledger row', async () => {
      const user = await busyUser();
      store.data.transactions[1].balanceAfter += 5; // a row that does not add up
      expect(wallets.audit(user.userId).consistent).toBe(false);

      store.reset();
      const other = newUser();
      await fund(app, other, 100);
      await fund(app, other, 100);
      store.data.transactions.splice(0, 1); // a row removed from the middle of the history
      expect(wallets.audit(other.userId).consistent).toBe(false);
    });

    test('rejects an invalid user id', async () => {
      const res = await http().get('/admin/wallets/bad%20id').set(adminAuth());
      expect(res.status).toBe(400);
    });
  });

  test('money never goes missing: balance always equals the sum of the ledger', async () => {
    const user = await busyUser();
    const rows = store.data.transactions.filter((t) => t.userId === user.userId);
    const sum = rows.reduce((s, t) => s + (t.direction === 'credit' ? t.amount : -t.amount), 0);
    expect(sum).toBe(wallets.getWallet(user.userId).balance);
  });
});
