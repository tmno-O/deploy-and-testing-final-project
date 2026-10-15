import { loadConfig } from '../../src/config/app-config';

const base = { JWT_SECRET: 'a'.repeat(32), INTERNAL_API_KEY: 'b'.repeat(32) };

describe('loadConfig', () => {
  test('applies defaults', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'test' });
    expect(c.port).toBe(3005);
    expect(c.jwt.issuer).toBe('user-service');
    expect(c.rateLimitPerMinute).toBe(300);
    expect(c.shipping).toEqual({ flatFee: 50, freeMinCards: 5, maxCardsPerOrder: 50 });
    expect(c.data.persist).toBe(false);
    expect(c.data.file).toMatch(/data[\\/]mock-data\.json$/);
    expect(c.corsOrigin).toEqual(['*']);
    expect(c.adminUserIds).toEqual([]);
    expect(c.trustProxy).toBe(false);
    expect(c.userService.url).toBe('http://localhost:3001');
    expect(c.catalog).toEqual({ url: '', timeoutMs: 3000 });
    expect(c.wallet).toEqual({ enabled: false, url: '', timeoutMs: 3000 });
  });

  test('fails fast when a secret is missing', () => {
    expect(() => loadConfig({ INTERNAL_API_KEY: 'x' })).toThrow('JWT_SECRET');
    expect(() => loadConfig({ JWT_SECRET: 'x' })).toThrow('INTERNAL_API_KEY');
  });

  test('rejects short secrets in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow('JWT_SECRET');
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', INTERNAL_API_KEY: 'short' })).toThrow('INTERNAL_API_KEY');
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).data.persist).toBe(true);
  });

  test('parses lists, trust proxy and numeric values', () => {
    const c = loadConfig({
      ...base,
      ADMIN_USER_IDS: ' u1, u2 ,',
      CORS_ORIGIN: 'https://a.example,https://b.example',
      TRUST_PROXY: '1',
      PORT: '4000',
      SHIPPING_FLAT_FEE: '0',
      DATA_FILE: './x.json',
      PERSIST_DATA: 'true',
      CATALOG_SERVICE_URL: 'http://catalog:3003',
    });
    expect(c.adminUserIds).toEqual(['u1', 'u2']);
    expect(c.corsOrigin).toEqual(['https://a.example', 'https://b.example']);
    expect(c.trustProxy).toBe(1);
    expect(c.port).toBe(4000);
    expect(c.shipping.flatFee).toBe(0);
    expect(c.data.file).toMatch(/x\.json$/);
    expect(c.data.persist).toBe(true);
    expect(c.catalog.url).toBe('http://catalog:3003');
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
  });

  test.each([
    ['PORT', '0'],
    ['RATE_LIMIT_PER_MINUTE', 'abc'],
    ['SHIPPING_FLAT_FEE', '12.5'],
    ['SHIPPING_FLAT_FEE', '-1'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadConfig({ ...base, [name]: value })).toThrow(name);
  });

  test('requires WALLET_SERVICE_URL when the wallet is enabled', () => {
    expect(() => loadConfig({ ...base, WALLET_ENABLED: 'true' })).toThrow('WALLET_SERVICE_URL');
    expect(loadConfig({ ...base, WALLET_ENABLED: 'true', WALLET_SERVICE_URL: 'http://w' }).wallet).toMatchObject({
      enabled: true,
      url: 'http://w',
    });
  });
});
