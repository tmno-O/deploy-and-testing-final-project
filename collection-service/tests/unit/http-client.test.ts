import { upstreamRequest, type UpstreamRequest } from '../../src/clients/http-client';

const call = (overrides: Partial<UpstreamRequest> = {}) =>
  upstreamRequest({
    baseUrl: 'http://upstream.test',
    path: '/things/1',
    timeoutMs: 50,
    requestId: 'req-1',
    unavailableCode: 'THING_SERVICE_UNAVAILABLE',
    ...overrides,
  });

const respond = (status: number, body?: unknown) =>
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status }));

afterEach(() => jest.restoreAllMocks());

describe('upstreamRequest', () => {
  test('returns status and parsed body for 200', async () => {
    respond(200, { ok: true });
    await expect(call()).resolves.toEqual({ status: 200, body: { ok: true } });
  });

  test('returns 4xx to the caller instead of throwing', async () => {
    respond(404, { error: { code: 'NOT_FOUND' } });
    await expect(call()).resolves.toMatchObject({ status: 404 });
  });

  test('returns a null body for an empty response', async () => {
    respond(204);
    await expect(call()).resolves.toEqual({ status: 204, body: null });
  });

  test('maps 500 to 503 with the given code', async () => {
    respond(500, {});
    await expect(call()).rejects.toMatchObject({ code: 'THING_SERVICE_UNAVAILABLE' });
    respond(502, {});
    await expect(call()).rejects.toMatchObject({ status: 503 });
  });

  test('maps a connection error to 503', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(call()).rejects.toMatchObject({ status: 503, message: expect.stringContaining('unreachable') });
  });

  test('maps a timeout to 503', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    await expect(call({ timeoutMs: 10 })).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('timed out'),
    });
  });

  test('maps invalid JSON to 503', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(call()).rejects.toMatchObject({ status: 503 });
  });

  test('forwards X-Request-Id and sends a JSON body', async () => {
    const fetch = respond(201, { ok: true });
    await call({ method: 'POST', body: { a: 1 }, headers: { 'X-Internal-Key': 'k' } });
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('http://upstream.test/things/1');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toMatchObject({
      'X-Request-Id': 'req-1',
      'X-Internal-Key': 'k',
      'Content-Type': 'application/json',
    });
  });

  test('omits X-Request-Id when there is none', async () => {
    const fetch = respond(200, {});
    await call({ requestId: undefined });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Request-Id']).toBeUndefined();
    expect(init.method).toBe('GET');
  });
});
