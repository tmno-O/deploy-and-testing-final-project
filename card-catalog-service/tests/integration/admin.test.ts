import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StoreService } from '../../src/store/store.service';
import { algNoneToken, signToken } from '../helpers/auth';
import { createTestApp } from '../helpers/app';
import { makeCatalog } from '../helpers/fixtures';

const INTERNAL_KEY = process.env.INTERNAL_API_KEY as string;

const newCard = (overrides: Record<string, unknown> = {}) => ({
  id: 'new-1',
  name: 'Eevee',
  imageSmall: 'https://images.pokemontcg.io/new/1.png',
  imageLarge: 'https://images.pokemontcg.io/new/1_hires.png',
  rarity: 'rare',
  setId: 'setN',
  setName: 'Set N',
  hp: 60,
  ...overrides,
});

const newPack = (overrides: Record<string, unknown> = {}) => ({
  id: 'mega',
  name: 'Mega Pack',
  priceCredits: 500,
  cardsPerPack: 4,
  rates: { common: 40, rare: 30, epic: 20, legendary: 10 },
  setIds: ['setA'],
  ...overrides,
});

describe('admin', () => {
  let app: INestApplication;
  let store: StoreService;

  beforeAll(async () => ({ app, store } = await createTestApp()));
  beforeEach(() => store.reset(makeCatalog()));
  afterAll(() => app.close());

  const admin = () => `Bearer ${signToken('admin-1')}`;
  const http = () => request(app.getHttpServer());
  const call = (method: 'post' | 'patch' | 'put' | 'delete' | 'get', url: string, body?: unknown, auth = admin()) => {
    const req = http()[method](url).set('Authorization', auth);
    return body === undefined ? req : req.send(body as object);
  };

  describe('authentication & authorization', () => {
    const routes: ['post' | 'patch' | 'put' | 'delete' | 'get', string][] = [
      ['post', '/admin/cards'],
      ['patch', '/admin/cards/a-1'],
      ['delete', '/admin/cards/a-1'],
      ['get', '/admin/packs'],
      ['post', '/admin/packs'],
      ['patch', '/admin/packs/starter'],
      ['put', '/admin/inventory/a-1'],
    ];

    test.each(routes)('%s %s without a token is 401', async (method, url) => {
      const res = await http()[method](url).send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test.each([
      ['malformed header', 'Token abc'],
      ['extra parts', `Bearer ${signToken()} extra`],
      ['garbage token', 'Bearer not.a.jwt'],
      ['wrong secret', `Bearer ${signToken('admin-1', { secret: 'x'.repeat(40) })}`],
      ['wrong issuer', `Bearer ${signToken('admin-1', { issuer: 'evil' })}`],
      ['alg none', `Bearer ${algNoneToken()}`],
      ['HS512 instead of HS256', `Bearer ${signToken('admin-1', { algorithm: 'HS512' })}`],
      ['missing sub', `Bearer ${signToken(null)}`],
    ])('rejects %s with 401 INVALID_TOKEN or UNAUTHORIZED', async (_name, auth) => {
      const res = await http().get('/admin/packs').set('Authorization', auth);
      expect(res.status).toBe(401);
      expect(['INVALID_TOKEN', 'UNAUTHORIZED']).toContain(res.body.error.code);
    });

    test('expired token is 401 TOKEN_EXPIRED', async () => {
      const res = await http().get('/admin/packs').set('Authorization', `Bearer ${signToken('admin-1', { expiresIn: -10 })}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });

    test('valid token of a non-admin user is 403 and changes nothing', async () => {
      const res = await call('post', '/admin/cards', newCard(), `Bearer ${signToken('regular-user')}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(store.data.cards).toHaveLength(6);
    });

    test('the internal key does not grant admin access', async () => {
      const res = await http().post('/admin/cards').set('X-Internal-Key', INTERNAL_KEY).send(newCard());
      expect(res.status).toBe(401);
    });

    test('a JWT does not grant access to internal endpoints', async () => {
      const res = await http()
        .post('/inventory/reservations')
        .set('Authorization', admin())
        .set('Idempotency-Key', 'jwt-instead-of-key')
        .send({ items: [{ cardId: 'a-1', qty: 1 }] });
      expect(res.status).toBe(401);
    });

    test('second admin id from ADMIN_USER_IDS works', async () => {
      const res = await http().get('/admin/packs').set('Authorization', `Bearer ${signToken('admin-2')}`);
      expect(res.status).toBe(200);
    });

    test('public endpoints stay open without a token', async () => {
      expect((await http().get('/cards')).status).toBe(200);
      expect((await http().get('/packs')).status).toBe(200);
    });
  });

  describe('cards', () => {
    test('POST creates a card that appears in the public API with no stock', async () => {
      const res = await call('post', '/admin/cards', newCard());
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: 'new-1', name: 'Eevee', supertype: 'Pokémon', attacks: [], available: 0 });
      const pub = await http().get('/cards/new-1');
      expect(pub.status).toBe(200);
      expect(pub.body.available).toBe(0);
    });

    test('POST duplicate id is 409', async () => {
      const res = await call('post', '/admin/cards', newCard({ id: 'a-1' }));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CARD_EXISTS');
    });

    test.each([
      ['unknown field', { extra: 1 }],
      ['bad rarity', { rarity: 'mythic' }],
      ['non-https image', { imageSmall: 'http://x.example/a.png' }],
      ['javascript url', { imageSmall: 'javascript:alert(1)' }],
      ['hp as string', { hp: '60' }],
      ['hp zero', { hp: 0 }],
      ['huge name', { name: 'x'.repeat(101) }],
      ['control chars', { name: 'bad\u0000name' }],
      ['bad id', { id: 'a b/../c' }],
      ['too many attacks', { attacks: Array.from({ length: 11 }, () => ({ name: 'x' })) }],
    ])('POST rejects %s with 400', async (_name, override) => {
      const res = await call('post', '/admin/cards', newCard(override));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(store.data.cards).toHaveLength(6);
    });

    test('PATCH updates only the given fields and never the id', async () => {
      const res = await call('patch', '/admin/cards/a-1', { name: 'Bulba', hp: 80 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'a-1', name: 'Bulba', hp: 80, rarity: 'common', available: 6 });
      expect((await call('patch', '/admin/cards/a-1', { id: 'other' })).status).toBe(400);
      expect((await call('patch', '/admin/cards/a-1', {})).status).toBe(400);
      expect((await call('patch', '/admin/cards/nope', { name: 'x' })).body.error.code).toBe('CARD_NOT_FOUND');
    });

    test('DELETE removes the card and its stock row', async () => {
      const res = await call('delete', '/admin/cards/a-3');
      expect(res.status).toBe(204);
      expect((await http().get('/cards/a-3')).status).toBe(404);
      expect(store.data.stock.some((s) => s.cardId === 'a-3')).toBe(false);
      expect((await call('delete', '/admin/cards/a-3')).status).toBe(404);
    });

    test('DELETE is blocked while a reservation holds the card, allowed after it is released', async () => {
      const reserved = await http()
        .post('/inventory/reservations')
        .set('X-Internal-Key', INTERNAL_KEY)
        .set('Idempotency-Key', 'hold-for-delete-1')
        .send({ items: [{ cardId: 'a-3', qty: 1 }] });
      const blocked = await call('delete', '/admin/cards/a-3');
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('CARD_IN_USE');

      await http().post(`/inventory/reservations/${reserved.body.id}/release`).set('X-Internal-Key', INTERNAL_KEY);
      expect((await call('delete', '/admin/cards/a-3')).status).toBe(204);
    });
  });

  describe('packs', () => {
    test('POST creates a pack visible publicly', async () => {
      const res = await call('post', '/admin/packs', newPack());
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: 'mega', active: true, description: '' });
      expect((await http().get('/packs/mega')).status).toBe(200);
    });

    test.each([
      ['rates over 100', { rates: { common: 50, rare: 30, epic: 20, legendary: 10 } }, 422, 'INVALID_RATES'],
      ['rates under 100', { rates: { common: 10, rare: 10, epic: 10, legendary: 10 } }, 422, 'INVALID_RATES'],
      ['missing tier', { rates: { common: 100 } }, 400, 'VALIDATION_ERROR'],
      ['unknown tier', { rates: { common: 50, rare: 20, epic: 20, legendary: 10, mythic: 0 } }, 400, 'VALIDATION_ERROR'],
      ['negative rate', { rates: { common: 110, rare: -10, epic: 0, legendary: 0 } }, 400, 'VALIDATION_ERROR'],
      ['fractional rate', { rates: { common: 70.5, rare: 29.5, epic: 0, legendary: 0 } }, 400, 'VALIDATION_ERROR'],
      ['zero price', { priceCredits: 0 }, 400, 'VALIDATION_ERROR'],
      ['too many cards per pack', { cardsPerPack: 21 }, 400, 'VALIDATION_ERROR'],
      ['empty setIds', { setIds: [] }, 400, 'VALIDATION_ERROR'],
      ['unknown field', { secret: true }, 400, 'VALIDATION_ERROR'],
    ])('POST rejects %s', async (_name, override, status, code) => {
      const res = await call('post', '/admin/packs', newPack(override));
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      expect(store.data.packs).toHaveLength(3);
    });

    test('POST duplicate id is 409', async () => {
      const res = await call('post', '/admin/packs', newPack({ id: 'starter' }));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PACK_EXISTS');
    });

    test('PATCH updates fields and can deactivate or reactivate a pack', async () => {
      const res = await call('patch', '/admin/packs/starter', { priceCredits: 150, active: false });
      expect(res.body).toMatchObject({ id: 'starter', priceCredits: 150, active: false });
      expect((await http().get('/packs/starter')).status).toBe(404);
      expect((await call('get', '/admin/packs')).body.data.map((p: { id: string }) => p.id)).toContain('starter');
      await call('patch', '/admin/packs/hidden', { active: true });
      expect((await http().get('/packs/hidden')).status).toBe(200);
    });

    test('PATCH validates rates and leaves the pack unchanged on failure', async () => {
      const res = await call('patch', '/admin/packs/starter', { rates: { common: 100, rare: 0, epic: 0, legendary: 0 } });
      expect(res.status).toBe(200);
      const bad = await call('patch', '/admin/packs/starter', { rates: { common: 1, rare: 0, epic: 0, legendary: 0 } });
      expect(bad.status).toBe(422);
      expect(store.data.packs.find((p) => p.id === 'starter')!.rates.common).toBe(100);
      expect((await call('patch', '/admin/packs/nope', { name: 'x' })).body.error.code).toBe('PACK_NOT_FOUND');
    });
  });

  describe('inventory', () => {
    test('PUT sets the total and keeps reserved', async () => {
      const res = await call('put', '/admin/inventory/a-1', { total: 50 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ cardId: 'a-1', total: 50, reserved: 4, available: 46 });
      expect((await http().get('/inventory/a-1')).body.available).toBe(46);
    });

    test('PUT creates a stock row for a card that had none', async () => {
      const res = await call('put', '/admin/inventory/b-2', { total: 7 });
      expect(res.body).toEqual({ cardId: 'b-2', total: 7, reserved: 0, available: 7 });
    });

    test('PUT cannot go below the reserved quantity', async () => {
      const res = await call('put', '/admin/inventory/a-1', { total: 3 });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'TOTAL_BELOW_RESERVED', details: { reserved: 4 } });
      expect(store.data.stock.find((s) => s.cardId === 'a-1')!.total).toBe(10);
    });

    test('PUT can go to exactly the reserved quantity', async () => {
      expect((await call('put', '/admin/inventory/a-1', { total: 4 })).body.available).toBe(0);
    });

    test.each([[{ total: -1 }], [{ total: 1.5 }], [{ total: '5' }], [{ total: 1_000_001 }], [{}], [{ total: 1, reserved: 0 }]])(
      'PUT rejects invalid body %j',
      async (body) => {
        const res = await call('put', '/admin/inventory/a-1', body);
        expect(res.status).toBe(400);
      },
    );

    test('PUT for an unknown card is 404', async () => {
      expect((await call('put', '/admin/inventory/nope', { total: 1 })).body.error.code).toBe('CARD_NOT_FOUND');
    });

    test('expired reservations are released before the reserved check', async () => {
      await http()
        .post('/inventory/reservations')
        .set('X-Internal-Key', INTERNAL_KEY)
        .set('Idempotency-Key', 'will-expire-soon-1')
        .send({ items: [{ cardId: 'a-1', qty: 5 }] });
      expect((await call('put', '/admin/inventory/a-1', { total: 5 })).status).toBe(409); // 9 reserved
      const real = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(real + 11 * 60 * 1000);
      try {
        expect((await call('put', '/admin/inventory/a-1', { total: 5 })).status).toBe(200); // 4 reserved
      } finally {
        jest.restoreAllMocks();
      }
    });
  });
});

describe('admin with no ADMIN_USER_IDS configured', () => {
  test('nobody is admin (deny by default)', async () => {
    const previous = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = '';
    const { app } = await createTestApp();
    try {
      const res = await request(app.getHttpServer()).get('/admin/packs').set('Authorization', `Bearer ${signToken('admin-1')}`);
      expect(res.status).toBe(403);
    } finally {
      process.env.ADMIN_USER_IDS = previous;
      await app.close();
    }
  });
});
