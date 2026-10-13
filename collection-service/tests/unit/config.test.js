const load = (env) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    let config;
    jest.isolateModules(() => { config = require('../../src/config'); });
    return config;
  } finally {
    process.env = saved;
  }
};

const LONG = 'x'.repeat(32);

describe('config', () => {
  it('loads defaults', () => {
    const config = load({ PORT: '', SHIPPING_FLAT_FEE: '' });
    expect(config.port).toBe(3005);
    expect(config.shipping).toEqual({ flatFee: 50, freeMinCards: 5, maxCardsPerOrder: 50 });
    expect(config.data.persist).toBe(false); // NODE_ENV=test
  });

  it('reads overrides', () => {
    const config = load({ SHIPPING_FLAT_FEE: '80', DATA_FILE: './x.json', PERSIST_DATA: 'true', CORS_ORIGIN: 'a, b' });
    expect(config.shipping.flatFee).toBe(80);
    expect(config.data.file).toMatch(/x\.json$/);
    expect(config.data.persist).toBe(true);
    expect(config.corsOrigin).toEqual(['a', 'b']);
  });

  it('rejects a non-integer number setting', () => {
    expect(() => load({ SHIPPING_FLAT_FEE: '12.5' })).toThrow('SHIPPING_FLAT_FEE');
  });

  it.each(['JWT_SECRET', 'SERVICE_API_KEY', 'ADMIN_API_KEY'])('requires %s', (name) => {
    expect(() => load({ [name]: '' })).toThrow(name);
  });

  it.each(['JWT_SECRET', 'SERVICE_API_KEY', 'ADMIN_API_KEY'])('requires a 32+ char %s in production', (name) => {
    const env = { NODE_ENV: 'production', JWT_SECRET: LONG, SERVICE_API_KEY: LONG, ADMIN_API_KEY: LONG };
    expect(() => load(env)).not.toThrow();
    expect(() => load({ ...env, [name]: 'short' })).toThrow(`${name} must be at least 32 characters`);
  });

  it('requires WALLET_SERVICE_URL when the wallet is enabled', () => {
    expect(() => load({ WALLET_ENABLED: 'true', WALLET_SERVICE_URL: '' })).toThrow('WALLET_SERVICE_URL');
    expect(load({ WALLET_ENABLED: 'true', WALLET_SERVICE_URL: 'http://w' }).wallet).toMatchObject({ enabled: true });
  });
});
