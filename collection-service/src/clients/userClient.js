const config = require('../config');
const http = require('./httpClient');
const { AppError, unauthorized, unprocessable, unavailable } = require('../errors');

const CODE = 'USER_SERVICE_UNAVAILABLE';

// ดึงที่อยู่ของผู้ใช้จาก user-service โดยส่งต่อ Bearer ของผู้ใช้ (user-service เช็คความเป็นเจ้าของเอง)
async function getAddress(addressId, { authorization, requestId } = {}) {
  const { status, body } = await http.request({
    baseUrl: config.userService.url,
    path: `/users/me/addresses/${encodeURIComponent(addressId)}`,
    headers: authorization ? { Authorization: authorization } : {},
    timeoutMs: config.userService.timeoutMs,
    requestId,
    unavailableCode: CODE,
  });

  if (status === 200 && body && body.address) return body.address;
  if (status === 404) throw unprocessable('ADDRESS_NOT_FOUND', 'Address not found');
  if (status === 401) throw unauthorized('User service rejected the token', 'INVALID_TOKEN');
  if (status === 400) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid address id');
  throw unavailable(CODE, `Unexpected response from user service (${status})`);
}

module.exports = { getAddress };
