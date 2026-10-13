const config = require('../../src/config');
const userClient = require('../../src/clients/userClient');
const catalogClient = require('../../src/clients/catalogClient');
const walletClient = require('../../src/clients/walletClient');

const respond = (status, body) =>
  jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status }));
const ctx = { requestId: 'req-9', authorization: 'Bearer abc' };
const original = { catalog: { ...config.catalog }, wallet: { ...config.wallet } };

afterEach(() => {
  jest.restoreAllMocks();
  Object.assign(config.catalog, original.catalog);
  Object.assign(config.wallet, original.wallet);
});

describe('userClient.getAddress', () => {
  const address = { id: 'a', recipientName: 'X' };

  it('returns the address and forwards the user token', async () => {
    const fetch = respond(200, { address });
    await expect(userClient.getAddress('a', ctx)).resolves.toEqual(address);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(`${config.userService.url}/users/me/addresses/a`);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer abc', 'X-Request-Id': 'req-9' });
  });

  it('maps 404 to 422 ADDRESS_NOT_FOUND', async () => {
    respond(404, {});
    await expect(userClient.getAddress('a', ctx)).rejects.toMatchObject({ status: 422, code: 'ADDRESS_NOT_FOUND' });
  });

  it('maps 401 to 401', async () => {
    respond(401, {});
    await expect(userClient.getAddress('a', ctx)).rejects.toMatchObject({ status: 401 });
  });

  it('maps 400 to 400', async () => {
    respond(400, {});
    await expect(userClient.getAddress('a')).rejects.toMatchObject({ status: 400 });
  });

  it.each([500, 503])('maps %i to 503 USER_SERVICE_UNAVAILABLE', async (status) => {
    respond(status, {});
    await expect(userClient.getAddress('a', ctx)).rejects.toMatchObject({ status: 503, code: 'USER_SERVICE_UNAVAILABLE' });
  });

  it('maps an unexpected 200 body to 503', async () => {
    respond(200, { nope: true });
    await expect(userClient.getAddress('a', ctx)).rejects.toMatchObject({ status: 503 });
  });

  it('maps connection refused to 503', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(userClient.getAddress('a', ctx)).rejects.toMatchObject({ code: 'USER_SERVICE_UNAVAILABLE' });
  });
});

describe('catalogClient', () => {
  it('is disabled without CATALOG_SERVICE_URL', () => {
    config.catalog.url = '';
    expect(catalogClient.isEnabled()).toBe(false);
  });

  describe('when enabled', () => {
    beforeEach(() => { config.catalog.url = 'http://catalog.test'; });

    it('maps the catalog card to collection fields', async () => {
      const fetch = respond(200, { cardId: 'CARD-001', name: 'Dragon', rarity: 'RARE', imageUrl: 'https://x.test/1.png' });
      expect(catalogClient.isEnabled()).toBe(true);
      await expect(catalogClient.getCard('CARD-001', ctx)).resolves.toEqual({
        cardName: 'Dragon', cardRarity: 'RARE', cardImageUrl: 'https://x.test/1.png',
      });
      expect(String(fetch.mock.calls[0][0])).toBe('http://catalog.test/cards/CARD-001');
    });

    it('accepts a { card } envelope', async () => {
      respond(200, { card: { cardId: 'CARD-001', name: 'Dragon', rarity: 'RARE', imageUrl: 'https://x.test/1.png' } });
      await expect(catalogClient.getCard('CARD-001')).resolves.toMatchObject({ cardName: 'Dragon' });
    });

    it('maps 404 to 422 CARD_NOT_FOUND', async () => {
      respond(404, {});
      await expect(catalogClient.getCard('CARD-404')).rejects.toMatchObject({ status: 422, code: 'CARD_NOT_FOUND' });
    });

    it('maps a malformed card to 503', async () => {
      respond(200, { cardId: 'CARD-001', name: 'Dragon', rarity: 'MYTHIC' });
      await expect(catalogClient.getCard('CARD-001')).rejects.toMatchObject({ code: 'CATALOG_SERVICE_UNAVAILABLE' });
    });

    it('maps other statuses to 503', async () => {
      respond(403, {});
      await expect(catalogClient.getCard('CARD-001')).rejects.toMatchObject({ status: 503 });
    });
  });
});

describe('walletClient', () => {
  it('does not call the wallet when disabled', async () => {
    config.wallet.enabled = false;
    const fetch = jest.spyOn(global, 'fetch');
    await expect(walletClient.charge('u', 50, 'o')).resolves.toEqual({ status: 'NOT_REQUIRED', transactionId: null });
    await expect(walletClient.refund('u', 50, 'o')).resolves.toEqual({ status: 'NOT_REQUIRED', transactionId: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('when enabled', () => {
    beforeEach(() => Object.assign(config.wallet, { enabled: true, url: 'http://wallet.test' }));

    it('charges with the order id as idempotency key', async () => {
      const fetch = respond(201, { transactionId: 'tx-1' });
      await expect(walletClient.charge('u1', 50, 'o1', ctx)).resolves.toEqual({ status: 'PAID', transactionId: 'tx-1' });
      const [url, init] = fetch.mock.calls[0];
      expect(String(url)).toBe('http://wallet.test/internal/wallets/u1/charge');
      expect(JSON.parse(init.body)).toMatchObject({ amount: 50, idempotencyKey: 'o1' });
      expect(init.headers).toMatchObject({ 'X-Service-Key': config.serviceApiKey, 'X-Request-Id': 'req-9' });
    });

    it('refunds with a refund- idempotency key', async () => {
      const fetch = respond(200, { transactionId: 'tx-2' });
      await expect(walletClient.refund('u1', 50, 'o1')).resolves.toEqual({ status: 'REFUNDED', transactionId: 'tx-2' });
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ amount: 50, idempotencyKey: 'refund-o1' });
    });

    it('maps 402 to INSUFFICIENT_BALANCE', async () => {
      respond(402, {});
      await expect(walletClient.charge('u1', 50, 'o1')).rejects.toMatchObject({ status: 402, code: 'INSUFFICIENT_BALANCE' });
    });

    it('maps an unexpected response to 503', async () => {
      respond(200, {});
      await expect(walletClient.charge('u1', 50, 'o1')).rejects.toMatchObject({ code: 'WALLET_SERVICE_UNAVAILABLE' });
    });
  });
});
