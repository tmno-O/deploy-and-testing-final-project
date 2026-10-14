import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '../../src/config/app-config';
import { StoreService } from '../../src/store/store.service';

const env = { JWT_SECRET: 'a'.repeat(32), INTERNAL_API_KEY: 'b'.repeat(32), NODE_ENV: 'test' };

describe('StoreService', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-store-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('starts empty when the data file does not exist', () => {
    const store = new StoreService(loadConfig({ ...env, DATA_FILE: path.join(dir, 'missing.json') }));
    expect(store.data).toEqual({ cards: [], packs: [], stock: [], reservations: [] });
    expect(store.isReady()).toBe(true);
  });

  test('fills missing collections when loading a partial file', () => {
    const file = path.join(dir, 'partial.json');
    fs.writeFileSync(file, JSON.stringify({ cards: [{ id: 'x' }] }));
    const store = new StoreService(loadConfig({ ...env, DATA_FILE: file }));
    expect(store.data.cards).toHaveLength(1);
    expect(store.data.stock).toEqual([]);
  });

  test('save() does nothing when persistence is off', () => {
    const file = path.join(dir, 'off.json');
    const store = new StoreService(loadConfig({ ...env, DATA_FILE: file, PERSIST_DATA: 'false' }));
    store.save();
    expect(fs.existsSync(file)).toBe(false);
  });

  test('save() writes atomically and round-trips', () => {
    const file = path.join(dir, 'on.json');
    const store = new StoreService(loadConfig({ ...env, DATA_FILE: file, PERSIST_DATA: 'true' }));
    store.data.stock.push({ cardId: 'c1', total: 3, reserved: 1 });
    store.save();
    expect(fs.readdirSync(dir)).toEqual(['on.json']); // no temp file left behind
    expect(new StoreService(loadConfig({ ...env, DATA_FILE: file })).data.stock).toEqual([
      { cardId: 'c1', total: 3, reserved: 1 },
    ]);
  });
});
