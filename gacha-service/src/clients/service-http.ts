import { AppError } from '../common/app-error';

export interface CallOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** forwarded to the other service (X-Request-Id) */
  requestId?: string;
  /** send X-Internal-Key (only for /internal/* and /inventory/reservations*) */
  internal?: boolean;
}

function errorBody(json: unknown): { code?: unknown; message?: unknown; details?: unknown } {
  if (typeof json === 'object' && json !== null && 'error' in json) {
    const err = (json as { error?: unknown }).error;
    if (typeof err === 'object' && err !== null) return err as Record<string, unknown>;
  }
  return {};
}

/** One HTTP call to another service, with the team rules applied in a single place. */
export class ServiceHttp {
  constructor(
    private readonly service: string, // e.g. 'CATALOG' -> CATALOG_SERVICE_UNAVAILABLE
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly internalKey: string,
  ) {}

  private unavailable(reason: string): AppError {
    return new AppError(503, `${this.service}_SERVICE_UNAVAILABLE`, `${this.service} service ${reason}`);
  }

  async call<T>(opts: CallOptions): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.requestId) headers['x-request-id'] = opts.requestId;
    if (opts.internal) headers['x-internal-key'] = this.internalKey;

    let status: number;
    let text: string;
    try {
      const res = await fetch(`${this.baseUrl}${opts.path}`, {
        method: opts.method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      status = res.status;
      text = await res.text();
    } catch {
      throw this.unavailable('is unreachable or timed out');
    }

    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (status >= 200 && status < 300) {
      if (json === null) throw this.unavailable('sent an invalid response');
      return json as T;
    }
    if (status >= 500) throw this.unavailable(`responded with ${status}`);

    const err = errorBody(json);
    // our own mistake (bad request / credentials): the user cannot fix it
    if (status === 400 || status === 401 || status === 403) {
      const upstream = typeof err.code === 'string' ? err.code : String(status);
      throw new AppError(502, 'UPSTREAM_ERROR', `${this.service} service rejected the request (${upstream})`);
    }
    // business error (402, 404, 409, 410, 422 ...): keep status + code so callers can react to it
    throw new AppError(
      status,
      typeof err.code === 'string' ? err.code : 'UPSTREAM_ERROR',
      typeof err.message === 'string' ? err.message : `${this.service} request failed`,
      err.details,
    );
  }
}