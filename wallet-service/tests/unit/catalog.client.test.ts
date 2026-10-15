import { CatalogClient } from '../../src/clients/catalog.client';
import { loadConfig, type AppConfig } from '../../src/config/app-config';
import { catalogPack, json } from '../helpers/fixtures';

const secrets = { JWT_SECRET: 'x'.repeat(32), INTERNAL_API_KEY: 'y'.repeat(32) };

describe('CatalogClient', () => {
  const config: AppConfig = loadConfig({ ...secrets, CATALOG_SERVICE_URL: 'http://catalog.test', NODE_ENV: 'test' });
  const client = new CatalogClient(config);
  afterEach(() => jest.restoreAllMocks());

  test('reads id, name and priceCredits from GET /packs/:id and forwards X-Request-Id', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(json(200, catalogPack('starter', 150)));
    await expect(client.getPack('starter', { requestId: 'req-1' })).resolves.toEqual({
      id: 'starter',
      name: 'Pack starter',
      priceCredits: 150,
    });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('http://catalog.test/packs/starter');
    expect((init?.headers as Record<string, string>)['X-Request-Id']).toBe('req-1');
  });

  test('404 means the pack is not on sale', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json(404, { error: { code: 'PACK_NOT_FOUND' } }));
    await expect(client.getPack('gone')).rejects.toMatchObject({ code: 'PACK_NOT_FOUND' });
  });

  test.each([
    ['server error', () => json(500, {})],
    ['unexpected status', () => json(403, {})],
    ['no price', () => json(200, { id: 'p', name: 'P' })],
    ['price is not a whole number', () => json(200, catalogPack('p', 10.5))],
    ['price is zero', () => json(200, catalogPack('p', 0))],
    ['empty body', () => new Response(null, { status: 200 })],
  ])('%s -> CATALOG_SERVICE_UNAVAILABLE', async (_name, reply) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(reply());
    await expect(client.getPack('p')).rejects.toMatchObject({ code: 'CATALOG_SERVICE_UNAVAILABLE' });
  });

  test('unreachable catalog -> CATALOG_SERVICE_UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.getPack('p')).rejects.toMatchObject({ code: 'CATALOG_SERVICE_UNAVAILABLE' });
  });

  test('without a catalog url nothing is called', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const off = new CatalogClient({ ...config, catalog: { url: '', timeoutMs: 3000 } });
    await expect(off.getPack('p')).rejects.toMatchObject({ code: 'CATALOG_SERVICE_UNAVAILABLE' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
