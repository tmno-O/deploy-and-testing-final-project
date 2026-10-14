import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StoreService } from '../../src/store/store.service';
import { makeCatalog } from '../helpers/fixtures';
import { createTestApp } from '../helpers/app';

describe('packs', () => {
  let app: INestApplication;
  let store: StoreService;

  beforeAll(async () => ({ app, store } = await createTestApp()));
  beforeEach(() => store.reset(makeCatalog()));
  afterAll(() => app.close());

  const get = (url: string) => request(app.getHttpServer()).get(url);

  test('GET /packs lists only active packs with price and rates', async () => {
    const res = await get('/packs');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { id: string }) => p.id)).toEqual(['starter', 'onlyA']);
    expect(res.body.data[0]).toEqual({
      id: 'starter',
      name: 'Pack starter',
      description: 'desc',
      priceCredits: 100,
      cardsPerPack: 5,
      rates: { common: 70, rare: 25, epic: 4, legendary: 1 },
      setIds: ['setA', 'setB'],
    });
  });

  test('GET /packs/:id returns a pack, 404 for unknown or inactive, 400 for malformed', async () => {
    expect((await get('/packs/starter')).body.id).toBe('starter');
    const missing = await get('/packs/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PACK_NOT_FOUND');
    expect((await get('/packs/hidden')).status).toBe(404);
    expect((await get('/packs/' + encodeURIComponent('x y'))).status).toBe(400);
  });

  test('GET /packs/:id/pool groups in-stock cards of the pack sets by rarity', async () => {
    const res = await get('/packs/starter/pool');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      packId: 'starter',
      cardsPerPack: 5,
      rates: { common: 70, rare: 25, epic: 4, legendary: 1 },
      counts: { common: 1, rare: 1, epic: 0, legendary: 1 },
    });
    const ids = (tier: string) => res.body.pool[tier].map((c: { id: string }) => c.id);
    expect(ids('common')).toEqual(['a-1']); // a-2 fully reserved
    expect(ids('rare')).toEqual(['b-1']); // c-1 is in a set outside the pack
    expect(ids('epic')).toEqual([]); // b-2 has no stock row
    expect(ids('legendary')).toEqual(['a-3']);
    expect(res.body.pool.common[0]).toMatchObject({ id: 'a-1', available: 6, rarity: 'common' });
  });

  test('pool only includes the sets of that pack', async () => {
    const res = await get('/packs/onlyA/pool');
    expect(res.body.counts).toEqual({ common: 1, rare: 0, epic: 0, legendary: 1 });
  });

  test('pool reflects stock changes immediately', async () => {
    store.data.stock.find((s) => s.cardId === 'a-3')!.reserved = 1;
    const res = await get('/packs/starter/pool');
    expect(res.body.counts.legendary).toBe(0);
    expect(res.body.pool.legendary).toEqual([]);
  });

  test('pool of unknown or inactive pack is 404', async () => {
    expect((await get('/packs/nope/pool')).status).toBe(404);
    expect((await get('/packs/hidden/pool')).status).toBe(404);
  });
});

describe('seed data served end to end', () => {
  let app: INestApplication;
  beforeAll(async () => ({ app } = await createTestApp())); // loads the real data/mock-data.json
  afterAll(() => app.close());

  test('every seeded pack has cards in every tier', async () => {
    const list = await request(app.getHttpServer()).get('/packs');
    expect(list.body.data.length).toBe(3);
    for (const pack of list.body.data) {
      const pool = await request(app.getHttpServer()).get(`/packs/${pack.id}/pool`);
      expect(Object.values(pool.body.counts).every((n) => (n as number) > 0)).toBe(true);
    }
  });
});
