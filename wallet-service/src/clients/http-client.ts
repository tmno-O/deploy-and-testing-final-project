import { unavailable } from '../common/app-error';

export interface UpstreamRequest {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  requestId?: string;
  /** error code used for the 503 when the upstream is down, e.g. USER_SERVICE_UNAVAILABLE */
  unavailableCode: string;
}

export interface UpstreamResponse {
  status: number;
  body: unknown;
}

/**
 * Every call to another service goes through here: timeout, X-Request-Id forwarding, and error mapping.
 * A response < 500 is returned for the caller to interpret; 5xx / timeout / unreachable becomes a 503.
 */
export async function upstreamRequest(req: UpstreamRequest): Promise<UpstreamResponse> {
  const headers: Record<string, string> = { Accept: 'application/json', ...req.headers };
  if (req.requestId) headers['X-Request-Id'] = req.requestId;
  if (req.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(new URL(req.path, req.baseUrl), {
      method: req.method ?? 'GET',
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(req.timeoutMs),
    });
  } catch (err) {
    const reason =
      (err as { name?: string } | null)?.name === 'TimeoutError' ? `timed out after ${req.timeoutMs}ms` : 'is unreachable';
    throw unavailable(req.unavailableCode, `Upstream service ${reason}`);
  }

  if (res.status >= 500) throw unavailable(req.unavailableCode, `Upstream service responded with ${res.status}`);

  const text = await res.text();
  if (!text) return { status: res.status, body: null };
  try {
    return { status: res.status, body: JSON.parse(text) as unknown };
  } catch {
    throw unavailable(req.unavailableCode, 'Upstream service returned invalid JSON');
  }
}
