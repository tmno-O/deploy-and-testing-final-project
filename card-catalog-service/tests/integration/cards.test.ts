import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StoreService } from '../../src/store/store.service';
import { makeCatalog } from '../helpers/fixtures';
import { createTestApp } from '../helpers/app';

describe('GET /cards', () => {
  let app: INestApplication;
  let store: StoreService;

  beforeAll(async () => ({ app, store } = await createTestApp()));
  beforeEach(() => store.reset(makeCatalog()));
  afterAll(() => app.close());

  const get = (url: string) => request(app.getHttpServer()).get(url);

  test('lists cards with pagination metadata and availability, without auth', async () => {
    const res = await get('/cards');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 6, totalPages: 1 });
    const byId = Object.fromEntries(res.body.data.map((c: { id: string }) => [c.id, c]));
    expect(byId['a-1'].available).toBe(6);
    expect(byId['a-2'].available).toBe(0);
    expect(byId['b-2'].available).toBe(0); // no stock row
    expect(byId['a-1']).not.toHaveProperty('attacks'); // summary only
  });

  test('paginates', async () => {
    const res = await get('/cards?limit=4&page=2');
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual(['b-2', 'c-1']);
    expect(res.body).toMatchObject({ page: 2, limit: 4, total: 6, totalPages: 2 });
    expect((await get('/cards?page=9')).body.data).toEqual([]);
  });

  test('searches by name (case-insensitive substring)', async () => {
    const res = await get('/cards?q=CHAR');
    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual(['Charmander', 'Charizard']);
  });

  test('filters by rarity, type, setId and combinations', async () => {
    expect((await get('/cards?rarity=legendary')).body.total).toBe(1);
    expect((await get('/cards?type=fire')).body.total).toBe(2);
    expect((await get('/cards?setId=setB')).body.total).toBe(2);
    const combo = await get('/cards?setId=setA&type=Fire&rarity=common');
    expect(combo.body.data.map((c: { id: string }) => c.id)).toEqual(['a-2']);
  });

  test('treats search text literally (no regex / injection)', async () => {
    const res = await get('/cards?q=' + encodeURIComponent('.*'));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  test.each([
    ['rarity=mythic'],
    ['page=0'],
    ['page=abc'],
    ['limit=101'],
    ['limit=0'],
    ['q=' + 'x'.repeat(51)],
    ['setId=' + encodeURIComponent('a b/../')],
    ['rarity=common&rarity=rare'],
  ])('rejects invalid query %s with 400', async (qs) => {
    const res = await get(`/cards?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });
});

describe('GET /cards/:id', () => {
  let app: INestApplication;
  let store: StoreService;

  beforeAll(async () => ({ app, store } = await createTestApp()));
  beforeEach(() => store.reset(makeCatalog()));
  afterAll(() => app.close());

  const get = (url: string) => request(app.getHttpServer()).get(url);

  test('returns full details with availability', async () => {
    const res = await get('/cards/a-1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'a-1', name: 'Bulbasaur', hp: 60, available: 6 });
    expect(res.body).toHaveProperty('attacks');
    expect(res.body).toHaveProperty('imageLarge');
  });

  test('available is never negative', async () => {
    store.data.stock.find((s) => s.cardId === 'a-1')!.reserved = 99;
    expect((await get('/cards/a-1')).body.available).toBe(0);
  });

  test('unknown id returns 404 CARD_NOT_FOUND', async () => {
    const res = await get('/cards/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CARD_NOT_FOUND');
  });

  test('malformed id returns 400', async () => {
    const res = await get('/cards/' + encodeURIComponent('a b;drop'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
