// Runs the real service against PostgreSQL. Skipped unless TEST_DATABASE_URL is set, e.g.
//   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/catalog_test npm run test:integration
// WARNING: the tables are truncated before every test; point it at a throwaway database, never at Supabase prod.
import * as fs from 'fs';
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { DatabaseService } from '../../src/database/database.service';
import { InventoryService } from '../../src/inventory/inventory.service';
import { signToken } from '../helpers/auth';
import { makeCard, makePack } from '../helpers/fixtures';

const url = process.env.TEST_DATABASE_URL;
const INTERNAL_KEY = process.env.INTERNAL_API_KEY as string;
const describeDb = url ? describe : describe.skip;

describeDb('PostgreSQL store', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let inventory: InventoryService;
  const previousUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const nestApp = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(nestApp);
    await nestApp.init();
    app = nestApp;
    db = app.get(DatabaseService);
    inventory = app.get(InventoryService);
    await db.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8'));
  });

  beforeEach(async () => {
    await db.query('truncate reservations, stock, packs, cards');
    for (const card of [
      makeCard('a-1', { rarity: 'common' }),
      makeCard('a-2', { rarity: 'legendary', attacks: [{ name: 'Slash', cost: ['Fire'], convertedEnergyCost: 1, damage: '30', text: '' }] }),
    ]) {
      await db.query(
        `insert into cards (id, name, image_small, image_large, rarity, source_rarity, set_id, set_name, supertype,
         subtypes, types, hp, attacks, weaknesses, retreat_cost, artist)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [card.id, card.name, card.imageSmall, card.imageLarge, card.rarity, card.sourceRarity, card.setId, card.setName,
         card.supertype, card.subtypes, card.types, card.hp, JSON.stringify(card.attacks), JSON.stringify(card.weaknesses),
         card.retreatCost, card.artist],
      );
    }
    const pack = makePack('starter', { setIds: ['setA'] });
    await db.query(
      'insert into packs (id, name, description, price_credits, cards_per_pack, rates, set_ids, active) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [pack.id, pack.name, pack.description, pack.priceCredits, pack.cardsPerPack, JSON.stringify(pack.rates), pack.setIds, pack.active],
    );
    await db.query("insert into stock (card_id, total, reserved) values ('a-1', 5, 0), ('a-2', 1, 0)");
  });

  afterAll(async () => {
    await app.close();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });

  const http = () => request(app.getHttpServer());
  const reserve = (items: unknown, key: string) =>
    http().post('/inventory/reservations').set('X-Internal-Key', INTERNAL_KEY).set('Idempotency-Key', key).send({ items });
  const stock = async (id: string) => (await db.query<{ total: number; reserved: number }>('select total, reserved from stock where card_id = $1', [id]))[0];

  test('health/ready pings the database', async () => {
    expect((await http().get('/health/ready')).status).toBe(200);
  });

  test('reads cards, packs and the draw pool', async () => {
    const list = await http().get('/cards');
    expect(list.body.total).toBe(2);
    expect(list.body.data.find((c: { id: string }) => c.id === 'a-1').available).toBe(5);
    const card = await http().get('/cards/a-2');
    expect(card.body.attacks[0].name).toBe('Slash');
    expect((await http().get('/packs')).body.data).toHaveLength(1);
    const pool = await http().get('/packs/starter/pool');
    expect(pool.body.counts).toEqual({ common: 1, rare: 0, epic: 0, legendary: 1 });
  });

  test('reserve -> commit deducts stock; replay returns the same reservation', async () => {
    const first = await reserve([{ cardId: 'a-1', qty: 2 }], 'pg-key-00000001');
    expect(first.status).toBe(201);
    expect(await stock('a-1')).toEqual({ total: 5, reserved: 2 });

    const replay = await reserve([{ cardId: 'a-1', qty: 2 }], 'pg-key-00000001');
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(await stock('a-1')).toEqual({ total: 5, reserved: 2 });

    const reused = await reserve([{ cardId: 'a-1', qty: 1 }], 'pg-key-00000001');
    expect(reused.status).toBe(422);

    const commit = await http().post(`/inventory/reservations/${first.body.id}/commit`).set('X-Internal-Key', INTERNAL_KEY);
    expect(commit.body.status).toBe('committed');
    expect(await stock('a-1')).toEqual({ total: 3, reserved: 0 });
  });

  test('insufficient stock is all-or-nothing', async () => {
    const res = await reserve([{ cardId: 'a-1', qty: 1 }, { cardId: 'a-2', qty: 2 }], 'pg-key-00000002');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stock('a-1')).toEqual({ total: 5, reserved: 0 });
  });

  test('concurrent reservations never oversell the last unit', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => reserve([{ cardId: 'a-2', qty: 1 }], `pg-race-key-${i}-0000`)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await stock('a-2')).toEqual({ total: 1, reserved: 1 });
  });

  test('concurrent requests with the same key create one reservation', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => reserve([{ cardId: 'a-1', qty: 1 }], 'pg-same-key-0001')));
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await stock('a-1')).toEqual({ total: 5, reserved: 1 });
  });

  test('release returns the stock; expired holds are returned by sweep()', async () => {
    const held = await reserve([{ cardId: 'a-1', qty: 3 }], 'pg-key-00000003');
    await http().post(`/inventory/reservations/${held.body.id}/release`).set('X-Internal-Key', INTERNAL_KEY);
    expect(await stock('a-1')).toEqual({ total: 5, reserved: 0 });

    await reserve([{ cardId: 'a-1', qty: 2 }], 'pg-key-00000004');
    await db.query("update reservations set expires_at = now() - interval '1 second' where status = 'reserved'");
    expect(await inventory.sweep()).toBe(1);
    expect(await stock('a-1')).toEqual({ total: 5, reserved: 0 });
  });

  test('database constraints reject invalid data', async () => {
    await expect(db.query("update stock set reserved = 99 where card_id = 'a-1'")).rejects.toThrow();
    await expect(db.query("update cards set rarity = 'mythic' where id = 'a-1'")).rejects.toThrow();
  });

  test('admin card/pack/stock lifecycle', async () => {
    const auth = { Authorization: `Bearer ${signToken()}` };
    const created = await http().post('/admin/cards').set(auth).send(makeCard('z-9', { name: 'New' }));
    expect(created.status).toBe(201);
    expect((await http().post('/admin/cards').set(auth).send(makeCard('z-9'))).status).toBe(409);
    expect((await http().patch('/admin/cards/z-9').set(auth).send({ name: 'Renamed' })).body.name).toBe('Renamed');

    const put = await http().put('/admin/inventory/z-9').set(auth).send({ total: 4 });
    expect(put.body).toEqual({ cardId: 'z-9', total: 4, reserved: 0, available: 4 });

    await reserve([{ cardId: 'z-9', qty: 1 }], 'pg-key-00000005');
    expect((await http().put('/admin/inventory/z-9').set(auth).send({ total: 0 })).body.error.code).toBe('TOTAL_BELOW_RESERVED');
    expect((await http().delete('/admin/cards/z-9').set(auth)).status).toBe(409);

    expect((await http().delete('/admin/cards/a-1').set(auth)).status).toBe(204);
    expect(await stock('a-1')).toBeUndefined();

    const pack = await http().post('/admin/packs').set(auth).send(makePack('gold', { rates: { common: 50, rare: 30, epic: 15, legendary: 5 } }));
    expect(pack.status).toBe(201);
    expect((await http().post('/admin/packs').set(auth).send(makePack('gold'))).status).toBe(409);
  });
});
