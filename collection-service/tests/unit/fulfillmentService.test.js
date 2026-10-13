const crypto = require('crypto');
const fulfillmentService = require('../../src/services/fulfillmentService');
const collectionService = require('../../src/services/collectionService');
const userClient = require('../../src/clients/userClient');
const walletClient = require('../../src/clients/walletClient');
const { AppError } = require('../../src/errors');
const { resetStore, store } = require('../helpers/store');
const { card, validAddress } = require('../helpers/factory');

let userId;
const give = (cardId, quantity) => collectionService.addFromGacha(userId, card(cardId, { quantity }), {});
const available = async (cardId) => (await collectionService.get(userId, cardId)).availableQuantity;
const order = (items, extra = { shippingAddress: validAddress() }) =>
  fulfillmentService.create(userId, { items, ...extra }, { requestId: 'r' });

beforeEach(async () => {
  resetStore();
  userId = crypto.randomUUID();
  await give('CARD-001', 3);
  await give('CARD-002', 1);
});
afterEach(() => jest.restoreAllMocks());

describe('fulfillmentService.create', () => {
  it('reserves every card when all are available', async () => {
    const created = await order([{ cardId: 'CARD-001', quantity: 2 }, { cardId: 'CARD-002', quantity: 1 }]);
    expect(created).toMatchObject({ status: 'PENDING', shippingFee: 50, paymentStatus: 'NOT_REQUIRED', addressId: null });
    expect(created.items).toEqual([
      { cardId: 'CARD-001', cardName: 'Card CARD-001', quantity: 2 },
      { cardId: 'CARD-002', cardName: 'Card CARD-002', quantity: 1 },
    ]);
    expect(await available('CARD-001')).toBe(1);
    expect(await available('CARD-002')).toBe(0);
  });

  it('changes nothing when one of several cards is short', async () => {
    const before = JSON.stringify(store.data);
    await expect(order([{ cardId: 'CARD-001', quantity: 1 }, { cardId: 'CARD-002', quantity: 2 }, { cardId: 'CARD-404', quantity: 1 }]))
      .rejects.toMatchObject({
        status: 409,
        code: 'INSUFFICIENT_QUANTITY',
        details: [
          { cardId: 'CARD-002', requested: 2, available: 1 },
          { cardId: 'CARD-404', requested: 1, available: 0 },
        ],
      });
    expect(JSON.stringify(store.data)).toBe(before);
  });

  it('snapshots the address from user-service', async () => {
    const addressId = crypto.randomUUID();
    jest.spyOn(userClient, 'getAddress').mockResolvedValue({ id: addressId, isDefault: true, line2: null, ...validAddress() });
    const created = await order([{ cardId: 'CARD-001', quantity: 1 }], { addressId });
    expect(created.addressId).toBe(addressId);
    expect(created.shippingAddress).toEqual(validAddress());
  });

  it('does not touch cards when user-service is down', async () => {
    jest.spyOn(userClient, 'getAddress').mockRejectedValue(new AppError(503, 'USER_SERVICE_UNAVAILABLE', 'down'));
    await expect(order([{ cardId: 'CARD-001', quantity: 1 }], { addressId: crypto.randomUUID() })).rejects.toMatchObject({ status: 503 });
    expect(await available('CARD-001')).toBe(3);
  });
});

describe('fulfillmentService with wallet', () => {
  beforeEach(() => jest.spyOn(walletClient, 'isEnabled').mockReturnValue(true));

  it('marks the order PAID after charging', async () => {
    const charge = jest.spyOn(walletClient, 'charge').mockResolvedValue({ status: 'PAID', transactionId: 'tx-1' });
    const created = await order([{ cardId: 'CARD-001', quantity: 1 }]);
    expect(created).toMatchObject({ paymentStatus: 'PAID', paymentRef: 'tx-1' });
    expect(charge).toHaveBeenCalledWith(userId, 50, created.id, { requestId: 'r' });
  });

  it('releases the cards and drops the order when the charge fails', async () => {
    jest.spyOn(walletClient, 'charge').mockRejectedValue(new AppError(402, 'INSUFFICIENT_BALANCE', 'no money'));
    await expect(order([{ cardId: 'CARD-001', quantity: 2 }])).rejects.toMatchObject({ status: 402 });
    expect(await available('CARD-001')).toBe(3);
    expect(store.data.orders).toEqual([]);
  });

  it('does not charge for free shipping', async () => {
    await give('CARD-003', 5);
    const charge = jest.spyOn(walletClient, 'charge');
    const created = await order([{ cardId: 'CARD-003', quantity: 5 }]);
    expect(created.paymentStatus).toBe('NOT_REQUIRED');
    expect(charge).not.toHaveBeenCalled();
  });

  it('refunds a PAID order on cancel', async () => {
    jest.spyOn(walletClient, 'charge').mockResolvedValue({ status: 'PAID', transactionId: 'tx-1' });
    const refund = jest.spyOn(walletClient, 'refund').mockResolvedValue({ status: 'REFUNDED', transactionId: 'tx-2' });
    const created = await order([{ cardId: 'CARD-001', quantity: 1 }]);
    const cancelled = await fulfillmentService.cancel(userId, created.id, {});
    expect(refund).toHaveBeenCalledWith(userId, 50, created.id, {});
    expect(cancelled).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
  });

  it('keeps the order unchanged when the refund fails', async () => {
    jest.spyOn(walletClient, 'charge').mockResolvedValue({ status: 'PAID', transactionId: 'tx-1' });
    jest.spyOn(walletClient, 'refund').mockRejectedValue(new AppError(503, 'WALLET_SERVICE_UNAVAILABLE', 'down'));
    const created = await order([{ cardId: 'CARD-001', quantity: 1 }]);
    await expect(fulfillmentService.cancel(userId, created.id, {})).rejects.toMatchObject({ status: 503 });
    expect((await fulfillmentService.getOwned(userId, created.id)).status).toBe('PENDING');
    expect(await available('CARD-001')).toBe(2);
  });
});

describe('fulfillmentService status changes', () => {
  it('returns the cards on cancel', async () => {
    const created = await order([{ cardId: 'CARD-001', quantity: 3 }]);
    expect(await available('CARD-001')).toBe(0);
    const cancelled = await fulfillmentService.cancel(userId, created.id, {});
    expect(cancelled.statusHistory.map((h) => h.status)).toEqual(['PENDING', 'CANCELLED']);
    expect(await available('CARD-001')).toBe(3);
  });

  it('hides another user\'s order', async () => {
    const created = await order([{ cardId: 'CARD-001', quantity: 1 }]);
    await expect(fulfillmentService.getOwned(crypto.randomUUID(), created.id)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects admin updates for an unknown order', async () => {
    await expect(fulfillmentService.adminUpdateStatus(crypto.randomUUID(), { status: 'PROCESSING' }, {}))
      .rejects.toMatchObject({ status: 404 });
  });

  it('rejects a status change that raced with another one', async () => {
    const created = await order([{ cardId: 'CARD-001', quantity: 1 }]);
    jest.spyOn(walletClient, 'refund').mockImplementation(async () => {
      await fulfillmentService.adminUpdateStatus(created.id, { status: 'PROCESSING' }, {});
      return { status: 'NOT_REQUIRED', transactionId: null };
    });
    store.data.orders[0].paymentStatus = 'PAID';
    await expect(fulfillmentService.cancel(userId, created.id, {})).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    expect(await available('CARD-001')).toBe(2);
  });
});
