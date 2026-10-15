import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '../../src/config/app-config';
import { StoreService } from '../../src/store/store.service';

const secrets = { JWT_SECRET: 'x'.repeat(32), INTERNAL_API_KEY: 'y'.repeat(32) };
const wallet = (userId: string, balance = 0) => ({ userId, balance, createdAt: 't', updatedAt: 't' });

function makeStore(file: string, persist: boolean) {
  return new StoreService(loadConfig({ ...secrets, DATA_FILE: file, PERSIST_DATA: String(persist) }));
}

describe('StoreService', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-store-'));
    file = path.join(dir, 'data', 'wallet.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('starts empty when the data file does not exist', () => {
    const store = makeStore(file, false);
    expect(store.data).toEqual({ wallets: [], transactions: [] });
    expect(store.isReady()).toBe(true);
  });

  test('loads a file and ignores collections that are not arrays', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ wallets: [wallet('u1', 5)], transactions: 'oops' }));
    const store = makeStore(file, false);
    expect(store.data.wallets).toHaveLength(1);
    expect(store.data.transactions).toEqual([]);
  });

  test('a successful transaction is saved to disk (and creates the folder)', async () => {
    const store = makeStore(file, true);
    await store.transaction(() => {
      store.data.wallets.push(wallet('u1', 10));
    });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).wallets[0]).toMatchObject({ userId: 'u1', balance: 10 });
    expect(fs.readdirSync(path.dirname(file))).toEqual(['wallet.json']); // no temp file left behind
    expect(makeStore(file, false).data.wallets).toHaveLength(1); // survives a restart
  });

  test('a failing transaction rolls back and saves nothing', async () => {
    const store = makeStore(file, true);
    await expect(
      store.transaction(() => {
        store.data.wallets.push(wallet('u1', 10));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(store.data.wallets).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
  });

  test('transactions run one at a time, and a failure does not block the next', async () => {
    const store = makeStore(file, false);
    const order: string[] = [];
    const slow = store.transaction(async () => {
      order.push('a:start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a:end');
    });
    const failing = store.transaction(() => {
      order.push('b');
      throw new Error('nope');
    });
    const last = store.transaction(() => order.push('c'));
    await slow;
    await expect(failing).rejects.toThrow('nope');
    await last;
    expect(order).toEqual(['a:start', 'a:end', 'b', 'c']);
  });

  test('reset replaces the data; readiness fails when a collection is broken', () => {
    const store = makeStore(file, false);
    store.reset({ wallets: [wallet('u1')] });
    expect(store.data.wallets).toHaveLength(1);
    (store.data as unknown as Record<string, unknown>).transactions = null;
    expect(store.isReady()).toBe(false);
  });
});
