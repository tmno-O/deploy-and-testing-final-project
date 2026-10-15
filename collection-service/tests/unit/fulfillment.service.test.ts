import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { WalletClient } from '../../src/clients/wallet.client';
import { CollectionService } from '../../src/collection/collection.service';
import { FulfillmentService } from '../../src/fulfillment/fulfillment.service';
import type { StoreService } from '../../src/store/store.service';
import { createTestApp } from '../helpers/app';
import { cardBody, validAddress } from '../helpers/fixtures';

describe('FulfillmentService', () => {
  let app: INestApplication;
  let store: StoreService;
  let fulfillment: FulfillmentService;
  let collections: CollectionService;
  let wallet: WalletClient;
  let userId: string;

  beforeAll(async () => {
    ({ app, store } = await createTestApp());
    fulfillment = app.get(FulfillmentService);
    collections = app.get(CollectionService);
    wallet = app.get(WalletClient);
  });
  beforeEach(async () => {
    store.reset();
    userId = randomUUID();
    await collections.addFromGacha(userId, cardBody('base1-1', { quantity: 3 }), {});
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  const available = (cardId: string) => collections.getMine(userId, cardId).availableQuantity;
  const order = (quantity = 1) =>
    fulfillment.create(userId, { items: [{ cardId: 'base1-1', quantity }], shippingAddress: validAddress() }, {});

  test('returns the cards on cancel', async () => {
    const created = await order(3);
    expect(available('base1-1')).toBe(0);
    const cancelled = await fulfillment.cancel(userId, created.id, {});
    expect(cancelled.statusHistory.map((h) => h.status)).toEqual(['PENDING', 'CANCELLED']);
    expect(available('base1-1')).toBe(3);
  });

  test('passes the call context to the wallet', async () => {
    jest.spyOn(wallet, 'isEnabled').mockReturnValue(true);
    const charge = jest.spyOn(wallet, 'charge').mockResolvedValue({ status: 'PAID', transactionId: 'tx-1' });
    const created = await fulfillment.create(
      userId,
      { items: [{ cardId: 'base1-1', quantity: 1 }], shippingAddress: validAddress() },
      { requestId: 'r' },
    );
    expect(charge).toHaveBeenCalledWith(userId, 50, created.id, { requestId: 'r' });
  });

  test('rejects a status change that raced with another one', async () => {
    const created = await order();
    store.data.orders[0].paymentStatus = 'PAID';
    jest.spyOn(wallet, 'refund').mockImplementation(async () => {
      // an admin moves the order on while we wait for the wallet
      await fulfillment.adminUpdateStatus(created.id, { status: 'PROCESSING' }, {});
      return { status: 'REFUNDED', transactionId: 'tx-2' };
    });
    await expect(fulfillment.cancel(userId, created.id, {})).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    expect(available('base1-1')).toBe(2);
    expect(store.data.orders[0].status).toBe('PROCESSING');
  });

  test('parallel orders never redeem more cards than owned', async () => {
    const results = await Promise.allSettled([order(2), order(2), order(1)]);
    const created = results.filter((r) => r.status === 'fulfilled');
    expect(created).toHaveLength(2);
    expect(available('base1-1')).toBe(0);
  });

  test('parallel retries of the same pull add the card once', async () => {
    const body = cardBody('base1-2');
    const results = await Promise.all([1, 2, 3].map(() => collections.addFromGacha(userId, body, {})));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(collections.getMine(userId, 'base1-2').quantity).toBe(1);
  });
});
