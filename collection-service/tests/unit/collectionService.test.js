const crypto = require('crypto');
const collectionService = require('../../src/services/collectionService');
const catalogClient = require('../../src/clients/catalogClient');
const { resetStore, store } = require('../helpers/store');
const { card } = require('../helpers/factory');

const userId = crypto.randomUUID();
const add = (body) => collectionService.addFromGacha(userId, { quantity: 1, ...body }, {});

beforeEach(resetStore);
afterEach(() => jest.restoreAllMocks());

describe('collectionService.addFromGacha', () => {
  it('creates a card and records the pull', async () => {
    const body = card('CARD-001');
    const result = await add(body);
    expect(result.created).toBe(true);
    expect(result.card).toMatchObject({ cardId: 'CARD-001', quantity: 1, availableQuantity: 1 });
    expect(store.data.pulls).toEqual([expect.objectContaining({ pullId: body.pullId, userId })]);
  });

  it('returns the same result for a repeated pullId', async () => {
    const body = card('CARD-001', { quantity: 2 });
    await add(body);
    const again = await add(body);
    expect(again).toMatchObject({ created: false, card: { quantity: 2 } });
    expect(store.data.pulls).toHaveLength(1);
  });

  it('handles two concurrent requests with the same pullId once', async () => {
    const body = card('CARD-001');
    const results = await Promise.all([add(body), add(body)]);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect((await collectionService.get(userId, 'CARD-001')).quantity).toBe(1);
  });

  it('rejects a pullId reused for another card', async () => {
    const body = card('CARD-001');
    await add(body);
    await expect(add({ ...body, cardId: 'CARD-002' })).rejects.toMatchObject({ status: 409, code: 'PULL_ID_CONFLICT' });
  });

  it('requires card details while the catalog is disabled', async () => {
    await expect(add({ pullId: crypto.randomUUID(), cardId: 'CARD-001', cardName: 'X' })).rejects.toMatchObject({
      status: 400,
      details: [{ field: 'cardRarity', message: 'Required' }, { field: 'cardImageUrl', message: 'Required' }],
    });
  });

  it('uses catalog data instead of the payload when the catalog is enabled', async () => {
    jest.spyOn(catalogClient, 'isEnabled').mockReturnValue(true);
    jest.spyOn(catalogClient, 'getCard').mockResolvedValue({ cardName: 'Real', cardRarity: 'SECRET_RARE', cardImageUrl: 'https://c.test/1.png' });
    const result = await add(card('CARD-001', { cardName: 'Fake', cardRarity: 'COMMON' }));
    expect(result.card).toMatchObject({ cardName: 'Real', cardRarity: 'SECRET_RARE' });
  });
});

describe('collectionService.get / list', () => {
  it('throws 404 for a card not in the collection', async () => {
    await expect(collectionService.get(userId, 'CARD-999')).rejects.toMatchObject({ status: 404 });
  });

  it('paginates and filters by rarity', async () => {
    await add(card('CARD-001', { cardRarity: 'RARE' }));
    await add(card('CARD-002', { cardRarity: 'COMMON' }));
    await add(card('CARD-003', { cardRarity: 'RARE' }));
    const page = await collectionService.list(userId, { limit: 1, offset: 1, rarity: 'RARE' });
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(page.data.map((c) => c.cardId)).toEqual(['CARD-003']);
  });
});
