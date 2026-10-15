import { ServiceHttp } from '../../src/clients/service-http';
import type { AppError } from '../../src/common/app-error';

const http = new ServiceHttp('WALLET', 'http://wallet:3002', 3000, 'secret-key');
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    return err as AppError;
  }
  throw new Error('expected the call to fail');
}

describe('ServiceHttp', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the body on 2xx and sends the internal key and request id', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(reply(201, { ok: true }));
    const result = await http.call({ method: 'POST', path: '/x', body: { a: 1 }, internal: true, requestId: 'req-1' });
    expect(result).toEqual({ ok: true });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ 'x-internal-key': 'secret-key', 'x-request-id': 'req-1' });
  });

  it('keeps the status and code of a business error (402)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(reply(402, { error: { code: 'INSUFFICIENT_BALANCE', message: 'no' } }));
    const err = await failure(http.call({ method: 'POST', path: '/x' }));
    expect(err.getStatus()).toBe(402);
    expect(err.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('turns 5xx into 503 <SERVICE>_SERVICE_UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(reply(500, { error: { code: 'X', message: 'x' } }));
    const err = await failure(http.call({ method: 'GET', path: '/x' }));
    expect(err.getStatus()).toBe(503);
    expect(err.code).toBe('WALLET_SERVICE_UNAVAILABLE');
  });

  it('turns a network failure or timeout into 503', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED'));
    const err = await failure(http.call({ method: 'GET', path: '/x' }));
    expect(err.getStatus()).toBe(503);
  });

  it('turns 401 (our credentials are wrong) into 502 UPSTREAM_ERROR', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(reply(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }));
    const err = await failure(http.call({ method: 'GET', path: '/x' }));
    expect(err.getStatus()).toBe(502);
    expect(err.code).toBe('UPSTREAM_ERROR');
  });
});