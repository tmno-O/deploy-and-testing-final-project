import { signToken } from './auth';

export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
export const PULL_ID = '22222222-2222-4222-8222-222222222222';
export const RESERVATION_ID = '44444444-4444-4444-8444-444444444444';

export const SERVICE_URLS = {
  catalog: 'http://localhost:3003',
  wallet: 'http://localhost:3002',
  collection: 'http://localhost:3005',
};

const card = (id: string) => ({
  id,
  name: `Card ${id}`,
  imageSmall: `https://images.test/${id}.png`,
  rarity: 'common',
  setId: 'test-set',
  available: 5,
});

export const packPool = {
  packId: 'starter',
  cardsPerPack: 2,
  rates: { common: 100, rare: 0, epic: 0, legendary: 0 },
  counts: { common: 2, rare: 0, epic: 0, legendary: 0 },
  pool: { common: [card('card-1'), card('card-2')], rare: [], epic: [], legendary: [] },
};

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

type FetchHandler = (url: string, init: RequestInit) => Promise<Response>;

export function mockUpstreams(handler: FetchHandler) {
  return jest.spyOn(global, 'fetch').mockImplementation((input, init = {}) => handler(String(input), init));
}

export function requestHeaders(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

export const bearer = (userId = USER_ID) => ({ Authorization: `Bearer ${signToken(userId)}` });