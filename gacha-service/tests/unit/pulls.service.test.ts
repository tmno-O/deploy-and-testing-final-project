import type { PackPool, PoolCard } from '../../src/clients/types';
import { AppError } from '../../src/common/app-error';
import { PullsRepository } from '../../src/pulls/pulls.repository';
import { PullsService } from '../../src/pulls/pulls.service';
import type { StoreService } from '../../src/store/store.service';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '33333333-3333-4333-8333-333333333333';
const PULL = '22222222-2222-4222-8222-222222222222';

const card = (id: string): PoolCard => ({
  id,
  name: id,
  imageSmall: `https://img/${id}.png`,
  rarity: 'common',
  setId: 's',
  available: 5,
});

const pool: PackPool = {
  packId: 'starter',
  cardsPerPack: 2,
  rates: { common: 100, rare: 0, epic: 0, legendary: 0 },
  counts: { common: 2, rare: 0, epic: 0, legendary: 0 },
  pool: { common: [card('a'), card('b')], rare: [], epic: [], legendary: [] },
};

function setup() {
  const store = { data: { pulls: [] }, save: jest.fn() } as unknown as StoreService;
  const catalog = {
    getPool: jest.fn().mockResolvedValue(pool),
    reserve: jest.fn().mockResolvedValue({ id: 'res-1', status: 'reserved' }),
    commit: jest.fn().mockResolvedValue({ id: 'res-1', status: 'committed' }),
    release: jest.fn().mockResolvedValue({ id: 'res-1', status: 'released' }),
  };
  const wallet = {
    purchase: jest.fn().mockResolvedValue({
      transactionId: 'tx-1',
      balance: 0,
      transaction: { id: 'tx-1', amount: 100, type: 'purchase' },
    }),
    refund: jest.fn().mockResolvedValue({ transactionId: 'tx-2' }),
  };
  const collection = { addCard: jest.fn().mockResolvedValue({ pullId: 'x', created: true }) };
  const service = new PullsService(
    new PullsRepository(store),
    catalog as never,
    wallet as never,
    collection as never,
  );
  return { service, catalog, wallet, collection };
}

describe('PullsService.open', () => {
  it('completes a pull: reserve, pay, commit, deliver every card', async () => {
    const { service, catalog, wallet, collection } = setup();
    const { pull, replay } = await service.open(USER, 'starter', PULL);
    expect(replay).toBe(false);
    expect(pull.status).toBe('COMPLETED');
    expect(pull.price).toBe(100);
    expect(pull.cards).toHaveLength(2);
    expect(catalog.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.purchase).toHaveBeenCalledWith(USER, 'starter', PULL, undefined);
    expect(catalog.commit).toHaveBeenCalledWith('res-1', undefined);
    expect(collection.addCard).toHaveBeenCalledTimes(2);
  });

  it('releases the stock and marks FAILED when the balance is not enough', async () => {
    const { service, catalog, collection } = setup();
    const wallet = (service as unknown as { wallet: { purchase: jest.Mock } }).wallet;
    wallet.purchase.mockRejectedValue(new AppError(402, 'INSUFFICIENT_BALANCE', 'no credit'));

    await expect(service.open(USER, 'starter', PULL)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(catalog.release).toHaveBeenCalledWith('res-1', undefined);
    expect(collection.addCard).not.toHaveBeenCalled();
    expect(service.getOwn(USER, PULL).status).toBe('FAILED');
  });

  it('replays the same key without charging again', async () => {
    const { service, wallet } = setup();
    await service.open(USER, 'starter', PULL);
    const second = await service.open(USER, 'starter', PULL);
    expect(second.replay).toBe(true);
    expect(second.pull.status).toBe('COMPLETED');
    expect(wallet.purchase).toHaveBeenCalledTimes(1);
  });

  it('keeps PAID when the collection is down, then a retry delivers only the missing cards', async () => {
    const { service, wallet, collection } = setup();
    collection.addCard
      .mockResolvedValueOnce({ created: true })
      .mockRejectedValueOnce(new AppError(503, 'COLLECTION_SERVICE_UNAVAILABLE', 'down'));

    await expect(service.open(USER, 'starter', PULL)).rejects.toMatchObject({
      code: 'COLLECTION_SERVICE_UNAVAILABLE',
    });
    expect(service.getOwn(USER, PULL).status).toBe('PAID');

    const retry = await service.open(USER, 'starter', PULL);
    expect(retry.pull.status).toBe('COMPLETED');
    expect(wallet.purchase).toHaveBeenCalledTimes(1); // never charged twice
    expect(collection.addCard).toHaveBeenCalledTimes(3); // 1 ok + 1 failed + 1 retried (first card not sent again)
  });

  it('refunds when the reservation expired after payment', async () => {
    const { service, catalog, wallet } = setup();
    catalog.commit.mockRejectedValue(new AppError(410, 'RESERVATION_EXPIRED', 'expired'));

    await expect(service.open(USER, 'starter', PULL)).rejects.toMatchObject({ code: 'RESERVATION_EXPIRED' });
    expect(wallet.refund).toHaveBeenCalledWith(USER, 100, 'tx-1', `refund-${PULL}`, undefined);
    expect(service.getOwn(USER, PULL).status).toBe('FAILED');
  });

  it('rejects a key that belongs to another user', async () => {
    const { service } = setup();
    await service.open(USER, 'starter', PULL);
    await expect(service.open(OTHER_USER, 'starter', PULL)).rejects.toMatchObject({ code: 'PULL_ID_CONFLICT' });
  });
});