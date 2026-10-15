import { loadConfig } from '../../src/config/app-config';

const base = {
  JWT_SECRET: 'a'.repeat(32),
  INTERNAL_API_KEY: 'b'.repeat(32),
};

describe('loadConfig', () => {
  test('defaults', () => {
    const c = loadConfig({ ...base });
    expect(c).toMatchObject({
      env: 'development',
      port: 3002,
      adminUserIds: [],
      rateLimitPerMinute: 300,
      trustProxy: false,
      corsOrigin: ['*'],
      jwt: { issuer: 'user-service' },
      catalog: { url: 'http://localhost:3003', timeoutMs: 3000 },
      payment: { provider: 'mock', topupMinAmount: 1, topupMaxAmount: 100_000, maxBalance: 10_000_000 },
    });
    expect(c.data.persist).toBe(true);
  });

  test('requires both secrets', () => {
    expect(() => loadConfig({ INTERNAL_API_KEY: base.INTERNAL_API_KEY })).toThrow('JWT_SECRET');
    expect(() => loadConfig({ JWT_SECRET: base.JWT_SECRET })).toThrow('INTERNAL_API_KEY');
  });

  test('short secrets are rejected in production only', () => {
    const weak = { JWT_SECRET: 'short', INTERNAL_API_KEY: 'short' };
    expect(() => loadConfig({ ...weak })).not.toThrow();
    expect(() => loadConfig({ ...weak, NODE_ENV: 'production' })).toThrow('JWT_SECRET');
    expect(() => loadConfig({ ...base, INTERNAL_API_KEY: 'short', NODE_ENV: 'production' })).toThrow(
      'INTERNAL_API_KEY',
    );
  });

  test('persistence follows NODE_ENV unless PERSIST_DATA says otherwise', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).data.persist).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'test', PERSIST_DATA: 'true' }).data.persist).toBe(true);
    expect(loadConfig({ ...base, PERSIST_DATA: 'false' }).data.persist).toBe(false);
  });

  test('parses lists, trust proxy and numbers', () => {
    const c = loadConfig({
      ...base,
      ADMIN_USER_IDS: ' a , b ,,c',
      CORS_ORIGIN: 'http://x.test,http://y.test',
      TRUST_PROXY: '1',
      PORT: '4000',
      DATA_FILE: 'custom/wallet.json',
    });
    expect(c.adminUserIds).toEqual(['a', 'b', 'c']);
    expect(c.corsOrigin).toEqual(['http://x.test', 'http://y.test']);
    expect(c.trustProxy).toBe(1);
    expect(c.port).toBe(4000);
    expect(c.data.file.endsWith('custom/wallet.json')).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
  });

  test('catalog url: unset uses the local default, empty disables it', () => {
    expect(loadConfig({ ...base }).catalog.url).toBe('http://localhost:3003');
    expect(loadConfig({ ...base, CATALOG_SERVICE_URL: '' }).catalog.url).toBe('');
    expect(loadConfig({ ...base, CATALOG_SERVICE_URL: 'http://catalog:3003' }).catalog.url).toBe(
      'http://catalog:3003',
    );
  });

  test('rejects invalid numbers', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
    expect(() => loadConfig({ ...base, RATE_LIMIT_PER_MINUTE: '0' })).toThrow('RATE_LIMIT_PER_MINUTE');
    expect(() => loadConfig({ ...base, TOPUP_MIN_AMOUNT: '1.5' })).toThrow('TOPUP_MIN_AMOUNT');
  });

  test('only a provider this build can talk to is accepted', () => {
    expect(loadConfig({ ...base, PAYMENT_PROVIDER: 'mock' }).payment.provider).toBe('mock');
    expect(() => loadConfig({ ...base, PAYMENT_PROVIDER: 'omise' })).toThrow('not supported');
  });

  test('top-up limits must be consistent', () => {
    expect(() => loadConfig({ ...base, TOPUP_MIN_AMOUNT: '500', TOPUP_MAX_AMOUNT: '100' })).toThrow('TOPUP_MIN_AMOUNT');
    expect(() => loadConfig({ ...base, TOPUP_MAX_AMOUNT: '2000', MAX_BALANCE: '1000' })).toThrow('MAX_BALANCE');
  });
});
