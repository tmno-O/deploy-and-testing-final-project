import { loadConfig } from '../../src/config/app-config';

const base = { JWT_SECRET: 'a'.repeat(32), INTERNAL_API_KEY: 'b'.repeat(32) };

describe('loadConfig', () => {
  test('applies defaults', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'test' });
    expect(c.port).toBe(3003);
    expect(c.jwt.issuer).toBe('user-service');
    expect(c.reservationTtlMs).toBe(600000);
    expect(c.rateLimitPerMinute).toBe(300);
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

  test('uses the JSON store unless DATABASE_URL is set', () => {
    expect(loadConfig({ ...base }).database).toBeUndefined();
    expect(loadConfig({ ...base, DATABASE_URL: '' }).database).toBeUndefined();
  });

  test('parses the database settings with sensible ssl defaults', () => {
    const local = loadConfig({ ...base, DATABASE_URL: 'postgres://u:p@localhost:5432/db' }).database!;
    expect(local).toMatchObject({ ssl: 'disable', poolMax: 5 });
    const remote = loadConfig({
      ...base,
      DATABASE_URL: 'postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres',
      DATABASE_POOL_MAX: '3',
      DATABASE_SSL: 'require',
      DATABASE_SSL_CA: 'line1\\nline2',
    }).database!;
    expect(remote).toMatchObject({ ssl: 'require', poolMax: 3, sslCa: 'line1\nline2' });
    expect(loadConfig({ ...base, DATABASE_URL: 'postgres://u:p@db.example.com/x' }).database!.ssl).toBe('no-verify');
  });

  test('a blank DATABASE_SSL (as docker-compose passes it) means the default', () => {
    expect(loadConfig({ ...base, DATABASE_URL: 'postgres://h/db', DATABASE_SSL: '' }).database!.ssl).toBe('no-verify');
    expect(loadConfig({ ...base, DATABASE_URL: 'postgres://localhost/db', DATABASE_SSL: '' }).database!.ssl).toBe('disable');
  });

  test('rejects an invalid database configuration', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'not a url' })).toThrow('DATABASE_URL');
    expect(() => loadConfig({ ...base, DATABASE_URL: 'postgres://h/db', DATABASE_SSL: 'maybe' })).toThrow('DATABASE_SSL');
    expect(() => loadConfig({ ...base, DATABASE_URL: 'postgres://h/db', DATABASE_POOL_MAX: '0' })).toThrow('DATABASE_POOL_MAX');
  });
});
