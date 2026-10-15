import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '../../src/config/app-config';
import { StoreService } from '../../src/store/store.service';
import type { Order } from '../../src/store/types';

let dir: string;
let file: string;

const makeStore = (persist = true) =>
  new StoreService(
    loadConfig({ ...process.env, DATA_FILE: file, PERSIST_DATA: String(persist) }),
  );
const order = (id: string) => ({ id }) as Order;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collection-store-'));
  file = path.join(dir, 'data.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('StoreService', () => {
  test('starts empty when the file does not exist', () => {
    expect(makeStore().data).toEqual({ collections: [], pulls: [], orders: [] });
  });

  test('ignores unknown or invalid keys in the seed file', () => {
    fs.writeFileSync(file, JSON.stringify({ collections: [{ id: 1 }], orders: 'bad', extra: [] }));
    expect(makeStore().data).toEqual({ collections: [{ id: 1 }], pulls: [], orders: [] });
  });

  test('persists after a successful transaction (atomic, no temp file left)', async () => {
    const store = makeStore();
    await store.transaction(() => store.data.orders.push(order('o1')));
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).orders).toEqual([{ id: 'o1' }]);
    expect(fs.readdirSync(dir)).toEqual(['data.json']);
  });

  test('rolls back memory and does not write the file when a transaction throws', async () => {
    const store = makeStore();
    await store.transaction(() => store.data.orders.push(order('o1')));
    const before = fs.readFileSync(file, 'utf8');

    await expect(
      store.transaction(() => {
        store.data.orders.push(order('o2'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(store.data.orders).toEqual([{ id: 'o1' }]);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    // the queue keeps going after a failure
    await expect(store.transaction(() => 'next')).resolves.toBe('next');
  });

  test('runs transactions one at a time', async () => {
    const store = makeStore();
    const events: string[] = [];
    const slow = store.transaction(async () => {
      events.push('a:start');
      await new Promise((r) => setTimeout(r, 20));
      events.push('a:end');
    });
    const fast = store.transaction(() => {
      events.push('b');
    });
    await Promise.all([slow, fast]);
    expect(events).toEqual(['a:start', 'a:end', 'b']);
  });

  test('does not write when persistence is off', async () => {
    const store = makeStore(false);
    await store.transaction(() => store.data.orders.push(order('o1')));
    expect(fs.existsSync(file)).toBe(false);
  });

  test('reset() copies its input and isReady() checks every collection', () => {
    const store = makeStore();
    const seed = { orders: [order('o1')] };
    store.reset(seed);
    seed.orders.push(order('o2'));
    expect(store.data.orders).toHaveLength(1);
    expect(store.isReady()).toBe(true);
    store.reset();
    expect(store.data.orders).toEqual([]);
  });
});
