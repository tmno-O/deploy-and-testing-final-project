import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, newId, signToken } from '../helpers/auth';
import { createTestApp } from '../helpers/app';
import { grant, userWithCards } from '../helpers/fixtures';
import type { StoreService } from '../../src/store/store.service';

describe('collections', () => {
  let app: INestApplication;
  let store: StoreService;

  beforeAll(async () => ({ app, store } = await createTestApp()));
  beforeEach(() => store.reset());
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  describe('GET /collections/me', () => {
    test('lists my cards with quantities', async () => {
      const { auth } = await userWithCards(app, { 'base1-2': 2, 'base1-1': 1 });
      const res = await http().get('/collections/me').set(auth);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
      const rows = res.body.data.map((c: Record<string, unknown>) => [
        c.cardId,
        c.quantity,
        c.redeemedQuantity,
        c.availableQuantity,
      ]);
      expect(rows).toEqual([
        ['base1-1', 1, 0, 1],
        ['base1-2', 2, 0, 2],
      ]);
    });

    test('paginates and filters by rarity', async () => {
      const { userId, auth } = await userWithCards(app, { 'base1-1': 1, 'base1-2': 1 });
      await grant(app, userId, 'base1-3', 1, { cardRarity: 'legendary' });

      const page = await http().get('/collections/me?limit=1&page=2').set(auth);
      expect(page.body).toMatchObject({ page: 2, limit: 1, total: 3, totalPages: 3, data: [{ cardId: 'base1-2' }] });

      const legendary = await http().get('/collections/me?rarity=legendary').set(auth);
      expect(legendary.body.data.map((c: { cardId: string }) => c.cardId)).toEqual(['base1-3']);
    });

    test('validates query parameters', async () => {
      const { auth } = await userWithCards(app);
      expect((await http().get('/collections/me?limit=0').set(auth)).status).toBe(400);
      expect((await http().get('/collections/me?page=0').set(auth)).status).toBe(400);
      expect((await http().get('/collections/me?rarity=mythic').set(auth)).status).toBe(400);
      expect((await http().get('/collections/me?foo=1').set(auth)).status).toBe(400);
    });

    test('only shows my own cards', async () => {
      await userWithCards(app, { 'base1-1': 5 });
      const other = await userWithCards(app);
      const res = await http().get('/collections/me').set(other.auth);
      expect(res.body).toMatchObject({ total: 0, data: [] });
    });
  });

  describe('GET /collections/me/:cardId', () => {
    test('returns one card', async () => {
      const { auth } = await userWithCards(app, { 'base1-1': 3 });
      const res = await http().get('/collections/me/base1-1').set(auth);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ cardId: 'base1-1', quantity: 3 });
    });

    test('returns 404 for a card I do not own and 400 for a bad id', async () => {
      await userWithCards(app, { 'base1-1': 1 });
      const auth = bearer(signToken(newId()));
      expect((await http().get('/collections/me/base1-1').set(auth)).status).toBe(404);
      expect((await http().get(`/collections/me/${encodeURIComponent('a b')}`).set(auth)).status).toBe(400);
    });

    test('users cannot add cards to themselves', async () => {
      const { auth } = await userWithCards(app);
      expect((await http().post('/collections/me').set(auth).send({ cardId: 'base1-1' })).status).toBe(404);
    });
  });
});
