import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { InventoryService } from '../../src/inventory/inventory.service';
import type { StoreService } from '../../src/store/store.service';
import { createTestApp } from '../helpers/app';
import { makeCatalog } from '../helpers/fixtures';

const INTERNAL_KEY = process.env.INTERNAL_API_KEY as string;
const KEY = 'order-0001-attempt-1';

describe('inventory', () => {
  let app: INestApplication;
  let store: StoreService;
  let inventory: InventoryService;

  beforeAll(async () => {
    ({ app, store } = await createTestApp());
    inventory = app.get(InventoryService);
  });
  beforeEach(() => store.reset(makeCatalog()));
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const reserve = (items: unknown, key: string | null = KEY) => {
    const req = http().post('/inventory/reservations').set('X-Internal-Key', INTERNAL_KEY);
    if (key !== null) req.set('Idempotency-Key', key);
    return req.send({ items });
  };
  const act = (id: string, action: 'commit' | 'release') =>
    http().post(`/inventory/reservations/${id}/${action}`).set('X-Internal-Key', INTERNAL_KEY);
  const stockOf = (cardId: string) => store.data.stock.find((s) => s.cardId === cardId)!;

  describe('public reads', () => {
    test('GET /inventory/:cardId returns total, reserved and available', async () => {
      const res = await http().get('/inventory/a-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ cardId: 'a-1', total: 10, reserved: 4, available: 6 });
    });

    test('card without a stock row reports zeros; unknown card is 404; bad id is 400', async () => {
      expect((await http().get('/inventory/b-2')).body).toEqual({ cardId: 'b-2', total: 0, reserved: 0, available: 0 });
      expect((await http().get('/inventory/nope')).body.error.code).toBe('CARD_NOT_FOUND');
      expect((await http().get('/inventory/' + encodeURIComponent('a b'))).status).toBe(400);
    });

    test('POST /inventory/check reports per-item availability without holding stock', async () => {
      const res = await http()
        .post('/inventory/check')
        .send({ items: [{ cardId: 'a-1', qty: 6 }, { cardId: 'a-2', qty: 1 }, { cardId: 'zzz', qty: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body.allAvailable).toBe(false);
      expect(res.body.items).toEqual([
        { cardId: 'a-1', qty: 6, available: 6, ok: true },
        { cardId: 'a-2', qty: 1, available: 0, ok: false },
        { cardId: 'zzz', qty: 1, available: 0, ok: false },
      ]);
      expect(stockOf('a-1').reserved).toBe(4);
      const ok = await http().post('/inventory/check').send({ items: [{ cardId: 'a-1', qty: 2 }] });
      expect(ok.body.allAvailable).toBe(true);
    });

    test.each([[{}], [{ items: [] }], [{ items: [{ cardId: 'a-1', qty: 0 }] }], [{ items: [{ cardId: 'a-1', qty: 1.5 }] }],
      [{ items: [{ cardId: 'a-1', qty: 101 }] }], [{ items: [{ cardId: 'a-1', qty: 1 }], extra: 1 }],
      [{ items: Array.from({ length: 51 }, (_, i) => ({ cardId: `c-${i}`, qty: 1 })) }]])(
      'check rejects invalid body %#', async (body) => {
        const res = await http().post('/inventory/check').send(body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
  });

  describe('authentication', () => {
    test.each([
      ['POST', '/inventory/reservations'],
      ['POST', '/inventory/reservations/6f1c6c3e-0000-4000-8000-000000000000/commit'],
      ['POST', '/inventory/reservations/6f1c6c3e-0000-4000-8000-000000000000/release'],
    ])('%s %s requires the internal key', async (_m, url) => {
      const none = await http().post(url).set('Idempotency-Key', KEY).send({ items: [{ cardId: 'a-1', qty: 1 }] });
      expect(none.status).toBe(401);
      expect(none.body.error.code).toBe('UNAUTHORIZED');
      const wrong = await http().post(url).set('X-Internal-Key', 'wrong').set('Idempotency-Key', KEY)
        .send({ items: [{ cardId: 'a-1', qty: 1 }] });
      expect(wrong.status).toBe(401);
    });

    test('a wrong key never changes stock', async () => {
      await http().post('/inventory/reservations').set('X-Internal-Key', 'nope').set('Idempotency-Key', KEY)
        .send({ items: [{ cardId: 'a-1', qty: 1 }] });
      expect(stockOf('a-1').reserved).toBe(4);
      expect(store.data.reservations).toHaveLength(0);
    });
  });

  describe('reserve', () => {
    test('creates a reservation and holds stock', async () => {
      const res = await reserve([{ cardId: 'a-1', qty: 2 }, { cardId: 'b-1', qty: 1 }]);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'reserved', items: [{ cardId: 'a-1', qty: 2 }, { cardId: 'b-1', qty: 1 }] });
      expect(res.body).not.toHaveProperty('idempotencyKey');
      expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.parse(res.body.createdAt));
      expect(stockOf('a-1').reserved).toBe(6);
      expect(stockOf('b-1').reserved).toBe(1);
      expect((await http().get('/inventory/a-1')).body.available).toBe(4);
    });

    test('merges duplicate cardIds', async () => {
      const res = await reserve([{ cardId: 'a-1', qty: 1 }, { cardId: 'a-1', qty: 2 }]);
      expect(res.body.items).toEqual([{ cardId: 'a-1', qty: 3 }]);
      expect(stockOf('a-1').reserved).toBe(7);
    });

    test('same Idempotency-Key replays the original result without holding more stock', async () => {
      const first = await reserve([{ cardId: 'a-1', qty: 2 }]);
      const again = await reserve([{ cardId: 'a-1', qty: 2 }]);
      expect(again.status).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body).toEqual(first.body);
      expect(stockOf('a-1').reserved).toBe(6);
      expect(store.data.reservations).toHaveLength(1);
    });

    test('replay ignores item order', async () => {
      await reserve([{ cardId: 'a-1', qty: 1 }, { cardId: 'b-1', qty: 1 }]);
      const again = await reserve([{ cardId: 'b-1', qty: 1 }, { cardId: 'a-1', qty: 1 }]);
      expect(again.status).toBe(200);
      expect(store.data.reservations).toHaveLength(1);
    });

    test('same key with different items is rejected (422)', async () => {
      await reserve([{ cardId: 'a-1', qty: 2 }]);
      const res = await reserve([{ cardId: 'a-1', qty: 3 }]);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(stockOf('a-1').reserved).toBe(6);
    });

    test('is all-or-nothing when any card is short', async () => {
      const res = await reserve([{ cardId: 'a-1', qty: 2 }, { cardId: 'a-3', qty: 2 }, { cardId: 'a-2', qty: 1 }]);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.error.details).toEqual([
        { cardId: 'a-2', requested: 1, available: 0 },
        { cardId: 'a-3', requested: 2, available: 1 },
      ]);
      expect(stockOf('a-1').reserved).toBe(4); // nothing was held
      expect(store.data.reservations).toHaveLength(0);
    });

    test('a failed attempt does not burn the key', async () => {
      expect((await reserve([{ cardId: 'a-3', qty: 5 }])).status).toBe(409);
      expect((await reserve([{ cardId: 'a-3', qty: 1 }])).status).toBe(201);
    });

    test('unknown card is 404 and card without stock row is insufficient', async () => {
      expect((await reserve([{ cardId: 'zzz', qty: 1 }])).body.error.code).toBe('CARD_NOT_FOUND');
      expect((await reserve([{ cardId: 'b-2', qty: 1 }])).body.error.code).toBe('INSUFFICIENT_STOCK');
    });

    test('requires a well-formed Idempotency-Key', async () => {
      const missing = await reserve([{ cardId: 'a-1', qty: 1 }], null);
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe('VALIDATION_ERROR');
      for (const bad of ['short', 'has spaces in it', 'x'.repeat(101), 'bad;key;bad;key']) {
        expect((await reserve([{ cardId: 'a-1', qty: 1 }], bad)).status).toBe(400);
      }
    });

    test('never oversells under concurrent requests', async () => {
      // a-3 has exactly 1 unit; 8 different callers race for it
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => reserve([{ cardId: 'a-3', qty: 1 }], `race-key-${i}-abcdefgh`)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(7);
      expect(stockOf('a-3').reserved).toBe(1);
    });

    test('same key sent concurrently creates a single reservation', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => reserve([{ cardId: 'a-1', qty: 1 }])));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 200)).toHaveLength(4);
      expect(stockOf('a-1').reserved).toBe(5);
    });
  });

  describe('commit and release', () => {
    test('commit deducts total and reserved, and is repeatable', async () => {
      const { body } = await reserve([{ cardId: 'a-1', qty: 2 }]);
      const res = await act(body.id, 'commit');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('committed');
      expect(stockOf('a-1')).toMatchObject({ total: 8, reserved: 4 });

      const again = await act(body.id, 'commit');
      expect(again.status).toBe(200);
      expect(again.body.status).toBe('committed');
      expect(stockOf('a-1')).toMatchObject({ total: 8, reserved: 4 }); // not deducted twice
    });

    test('release returns the stock and is repeatable', async () => {
      const { body } = await reserve([{ cardId: 'a-1', qty: 2 }]);
      expect((await act(body.id, 'release')).body.status).toBe('released');
      expect(stockOf('a-1')).toMatchObject({ total: 10, reserved: 4 });
      expect((await act(body.id, 'release')).status).toBe(200);
      expect(stockOf('a-1')).toMatchObject({ total: 10, reserved: 4 }); // not returned twice
    });

    test('cannot commit a released reservation or release a committed one', async () => {
      const a = (await reserve([{ cardId: 'a-1', qty: 1 }], 'key-for-release-1')).body;
      await act(a.id, 'release');
      const c1 = await act(a.id, 'commit');
      expect(c1.status).toBe(409);
      expect(c1.body.error.code).toBe('RESERVATION_NOT_ACTIVE');

      const b = (await reserve([{ cardId: 'a-1', qty: 1 }], 'key-for-commit-01')).body;
      await act(b.id, 'commit');
      expect((await act(b.id, 'release')).body.error.code).toBe('RESERVATION_NOT_ACTIVE');
      expect(stockOf('a-1')).toMatchObject({ total: 9, reserved: 4 });
    });

    test('unknown or malformed reservation id', async () => {
      const unknown = await act('6f1c6c3e-0000-4000-8000-000000000000', 'commit');
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('RESERVATION_NOT_FOUND');
      expect((await act('not-a-uuid', 'commit')).status).toBe(400);
    });

    test('released stock can be reserved again', async () => {
      const a = (await reserve([{ cardId: 'a-3', qty: 1 }], 'first-holder-key')).body;
      expect((await reserve([{ cardId: 'a-3', qty: 1 }], 'second-holder-key')).status).toBe(409);
      await act(a.id, 'release');
      expect((await reserve([{ cardId: 'a-3', qty: 1 }], 'second-holder-key')).status).toBe(201);
    });
  });

  describe('expiry', () => {
    const TTL = 10 * 60 * 1000;
    const advance = (ms: number) => {
      const real = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(real + ms);
    };

    test('an expired reservation frees its stock on the next read', async () => {
      await reserve([{ cardId: 'a-3', qty: 1 }]);
      expect((await http().get('/inventory/a-3')).body.available).toBe(0);
      advance(TTL + 1000);
      expect((await http().get('/inventory/a-3')).body.available).toBe(1);
      expect(store.data.reservations[0].status).toBe('expired');
    });

    test('commit and release of an expired reservation return 410 and change nothing', async () => {
      const { body } = await reserve([{ cardId: 'a-1', qty: 2 }]);
      advance(TTL + 1000);
      const commit = await act(body.id, 'commit');
      expect(commit.status).toBe(410);
      expect(commit.body.error.code).toBe('RESERVATION_EXPIRED');
      expect((await act(body.id, 'release')).status).toBe(410);
      expect(stockOf('a-1')).toMatchObject({ total: 10, reserved: 4 });
    });

    test('reservation is still valid just before it expires', async () => {
      const { body } = await reserve([{ cardId: 'a-1', qty: 1 }]);
      advance(TTL - 1000);
      expect((await act(body.id, 'commit')).status).toBe(200);
    });

    test('replaying a key after expiry returns the stored (expired) reservation, not a new hold', async () => {
      await reserve([{ cardId: 'a-1', qty: 1 }]);
      advance(TTL + 1000);
      const again = await reserve([{ cardId: 'a-1', qty: 1 }]);
      expect(again.status).toBe(200);
      expect(again.body.status).toBe('expired');
      expect(stockOf('a-1').reserved).toBe(4);
    });

    test('background sweep expires reservations without any API call and prunes old ones', async () => {
      await reserve([{ cardId: 'a-1', qty: 3 }], 'sweep-key-0000001');
      advance(TTL + 1000);
      expect(inventory.sweep()).toBe(1);
      expect(stockOf('a-1').reserved).toBe(4);
      expect(inventory.sweep()).toBe(0);
      expect(store.data.reservations).toHaveLength(1);

      jest.restoreAllMocks();
      advance(25 * 60 * 60 * 1000);
      inventory.sweep();
      expect(store.data.reservations).toHaveLength(0);
    });

    test('active reservations are never pruned', async () => {
      await reserve([{ cardId: 'a-1', qty: 1 }]);
      inventory.sweep();
      expect(store.data.reservations).toHaveLength(1);
    });
  });
});
