import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { internalKey, newId } from '../helpers/auth';
import { createTestApp } from '../helpers/app';
import { cardBody, grant } from '../helpers/fixtures';
import type { StoreService } from '../../src/store/store.service';

describe('internal collection endpoints', () => {
  let app: INestApplication;
  let store: StoreService;

  beforeAll(async () => ({ app, store } = await createTestApp()));
  beforeEach(() => store.reset());
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const post = (userId: string, body: object) =>
    http().post(`/internal/collections/${userId}/cards`).set(internalKey()).send(body);

  describe('POST /internal/collections/:userId/cards', () => {
    test('adds a new card with 201', async () => {
      const body = cardBody('base1-1');
      const res = await post(newId(), body);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        pullId: body.pullId,
        created: true,
        card: { cardId: 'base1-1', cardRarity: 'rare', quantity: 1, availableQuantity: 1 },
      });
    });

    test('is idempotent on pullId: a retry returns 200 and does not add again', async () => {
      const userId = newId();
      const body = cardBody('base1-1', { quantity: 2 });
      await post(userId, body);
      const retry = await post(userId, body);
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ created: false, card: { quantity: 2 } });
      expect(store.data.pulls).toHaveLength(1);
    });

    test('adds 1 for the same card from a new pull', async () => {
      const userId = newId();
      await grant(app, userId, 'base1-1');
      const res = await grant(app, userId, 'base1-1');
      expect(res.status).toBe(201);
      expect(res.body.card.quantity).toBe(2);
    });

    test('rejects a pullId reused for a different user or card', async () => {
      const userId = newId();
      const body = cardBody('base1-1');
      await post(userId, body);
      const otherUser = await post(newId(), body);
      expect(otherUser.status).toBe(409);
      expect(otherUser.body.error.code).toBe('PULL_ID_CONFLICT');
      expect((await post(userId, { ...body, cardId: 'base1-2' })).status).toBe(409);
    });

    test('requires card details while the catalog is off', async () => {
      const res = await post(newId(), cardBody('base1-1', { cardName: undefined }));
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: 'cardName', message: 'Required' }]);
    });

    test('validates userId and body', async () => {
      expect((await post('not-a-uuid', cardBody())).status).toBe(400);
      expect((await post(newId(), cardBody('base1-1', { quantity: 0 }))).status).toBe(400);
      expect((await post(newId(), cardBody('base1-1', { cardRarity: 'RARE' }))).status).toBe(400);
      expect((await post(newId(), cardBody('bad id'))).status).toBe(400);
      expect((await post(newId(), { ...cardBody(), extra: true })).status).toBe(400);
    });
  });

  describe('GET /internal/collections/:userId', () => {
    test("lists any user's collection", async () => {
      const userId = newId();
      await grant(app, userId, 'base1-1', 2);
      const res = await http().get(`/internal/collections/${userId}`).set(internalKey());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 1, data: [{ cardId: 'base1-1', quantity: 2 }] });
    });

    test('validates userId', async () => {
      expect((await http().get('/internal/collections/nope').set(internalKey())).status).toBe(400);
    });
  });
});
