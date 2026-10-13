const fs = require('fs');
const os = require('os');
const path = require('path');
let dir;
let settings;

// โหลด config + store ชุดใหม่ทุกครั้ง ชี้ไปที่ไฟล์ชั่วคราว (ไม่แตะ mock data จริง)
const freshStore = () => {
  let store;
  jest.isolateModules(() => {
    Object.assign(require('../../src/config').data, settings);
    store = require('../../src/store/jsonStore');
  });
  return store;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collection-store-'));
  settings = { file: path.join(dir, 'data.json'), persist: true };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('jsonStore', () => {
  it('starts empty when the file does not exist', () => {
    expect(freshStore().data).toEqual({ collections: [], pulls: [], orders: [] });
  });

  it('ignores unknown or invalid keys in the seed file', () => {
    fs.writeFileSync(settings.file, JSON.stringify({ collections: [{ id: 1 }], orders: 'bad', extra: [] }));
    expect(freshStore().data).toEqual({ collections: [{ id: 1 }], pulls: [], orders: [] });
  });

  it('rethrows read errors other than ENOENT', () => {
    settings.file = dir; // directory → EISDIR
    expect(freshStore).toThrow();
  });

  it('persists after a successful transaction', async () => {
    const store = freshStore();
    await store.transaction((data) => { data.orders.push({ id: 'o1' }); });
    expect(JSON.parse(fs.readFileSync(settings.file, 'utf8')).orders).toEqual([{ id: 'o1' }]);
  });

  it('rolls back memory and does not write the file when a transaction throws', async () => {
    const store = freshStore();
    await store.transaction((data) => { data.orders.push({ id: 'o1' }); });
    const before = fs.readFileSync(settings.file, 'utf8');

    await expect(store.transaction((data) => {
      data.orders.push({ id: 'o2' });
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(store.data.orders).toEqual([{ id: 'o1' }]);
    expect(fs.readFileSync(settings.file, 'utf8')).toBe(before);
  });

  it('runs transactions one at a time', async () => {
    const store = freshStore();
    const events = [];
    const slow = store.transaction(async () => {
      events.push('a:start');
      await new Promise((r) => setTimeout(r, 20));
      events.push('a:end');
    });
    const fast = store.transaction(async () => { events.push('b'); });
    await Promise.all([slow, fast]);
    expect(events).toEqual(['a:start', 'a:end', 'b']);
  });

  it('does not write when persistence is off', async () => {
    settings.persist = false;
    const store = freshStore();
    await store.transaction((data) => { data.orders.push({ id: 'o1' }); });
    expect(fs.existsSync(settings.file)).toBe(false);
  });
});
