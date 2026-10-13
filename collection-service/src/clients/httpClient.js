// ทุกการเรียก service อื่นผ่านที่นี่: ใส่ timeout, ส่งต่อ X-Request-Id และแปลง error ฝั่งปลายทางเป็น AppError
// - ได้ response < 500 → คืน { status, body } ให้ client แต่ละตัวตีความเอง
// - 5xx / timeout / ต่อไม่ติด → โยน 503 `${code}`
const { unavailable } = require('../errors');

async function request({ baseUrl, path, method = 'GET', headers = {}, body, timeoutMs, requestId, unavailableCode }) {
  const finalHeaders = { Accept: 'application/json', ...headers };
  if (requestId) finalHeaders['X-Request-Id'] = requestId;
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(new URL(path, baseUrl), {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : 'is unreachable';
    throw unavailable(unavailableCode, `Upstream service ${reason}`);
  }

  if (res.status >= 500) {
    throw unavailable(unavailableCode, `Upstream service responded with ${res.status}`);
  }

  let parsed = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw unavailable(unavailableCode, 'Upstream service returned invalid JSON');
    }
  }
  return { status: res.status, body: parsed };
}

module.exports = { request };
