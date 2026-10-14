import { loadConfig } from '../../src/config/app-config';

const base = { JWT_SECRET: 'a'.repeat(32), INTERNAL_API_KEY: 'b'.repeat(32) };

describe('loadConfig', () => {
  test('applies defaults', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'test' });
    expect(c.port).toBe(3003);
    expect(c.jwt.issuer).toBe('user-service');
    expect(c.reservationTtlMs).toBe(600000);
    expect(c.data.persist).toBe(false);
    expect(c.corsOrigin).toEqual(['*']);
    expect(c.adminUserIds).toEqual([]);
  });

  test('fails fast when a secret is missing', () => {
    expect(() => loadConfig({ INTERNAL_API_KEY: 'x' })).toThrow('JWT_SECRET');
    expect(() => loadConfig({ JWT_SECRET: 'x' })).toThrow('INTERNAL_API_KEY');
  });

  test('rejects short secrets in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short', INTERNAL_API_KEY: base.INTERNAL_API_KEY })).toThrow(
      'JWT_SECRET',
    );
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: base.JWT_SECRET, INTERNAL_API_KEY: 'short' })).toThrow(
      'INTERNAL_API_KEY',
    );
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).data.persist).toBe(true);
  });

  test('parses lists, trust proxy and numeric values', () => {
    const c = loadConfig({
      ...base,
      ADMIN_USER_IDS: ' u1, u2 ,',
      CORS_ORIGIN: 'https://a.example,https://b.example',
      TRUST_PROXY: '1',
      PORT: '4000',
      RESERVATION_TTL_SECONDS: '30',
    });
    expect(c.adminUserIds).toEqual(['u1', 'u2']);
    expect(c.corsOrigin).toEqual(['https://a.example', 'https://b.example']);
    expect(c.trustProxy).toBe(1);
    expect(c.port).toBe(4000);
    expect(c.reservationTtlMs).toBe(30000);
  });

  test('rejects invalid numbers', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
    expect(() => loadConfig({ ...base, RESERVATION_TTL_SECONDS: '-5' })).toThrow('RESERVATION_TTL_SECONDS');
  });
});
