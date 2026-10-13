const config = require('../config');
const http = require('./httpClient');
const { AppError, unavailable } = require('../errors');

const CODE = 'WALLET_SERVICE_UNAVAILABLE';

// ปิดอยู่จนกว่าจะตั้ง WALLET_ENABLED=true → ไม่เรียก Wallet เลยและถือว่าไม่ต้องจ่าย
const isEnabled = () => config.wallet.enabled;

async function call(path, body, requestId) {
  const { status, body: res } = await http.request({
    baseUrl: config.wallet.url,
    path,
    method: 'POST',
    headers: { 'X-Service-Key': config.serviceApiKey },
    body,
    timeoutMs: config.wallet.timeoutMs,
    requestId,
    unavailableCode: CODE,
  });
  if ((status === 200 || status === 201) && res && res.transactionId) return res.transactionId;
  if (status === 402) throw new AppError(402, 'INSUFFICIENT_BALANCE', 'Not enough wallet balance to pay the shipping fee');
  throw unavailable(CODE, `Unexpected response from wallet service (${status})`);
}

// idempotencyKey = orderId ทำให้ retry ได้โดยไม่ตัดเงินซ้ำ
async function charge(userId, amount, orderId, { requestId } = {}) {
  if (!isEnabled()) return { status: 'NOT_REQUIRED', transactionId: null };
  const transactionId = await call(
    `/internal/wallets/${encodeURIComponent(userId)}/charge`,
    { amount, reason: `Shipping fee for order ${orderId}`, idempotencyKey: orderId },
    requestId
  );
  return { status: 'PAID', transactionId };
}

async function refund(userId, amount, orderId, { requestId } = {}) {
  if (!isEnabled()) return { status: 'NOT_REQUIRED', transactionId: null };
  const transactionId = await call(
    `/internal/wallets/${encodeURIComponent(userId)}/refund`,
    { amount, idempotencyKey: `refund-${orderId}` },
    requestId
  );
  return { status: 'REFUNDED', transactionId };
}

module.exports = { isEnabled, charge, refund };
