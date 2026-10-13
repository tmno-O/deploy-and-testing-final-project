const { badRequest, conflict } = require('../errors');

// สถานะถัดไปที่อนุญาต; DELIVERED และ CANCELLED เป็นสถานะจบ
const TRANSITIONS = {
  PENDING: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

// ผู้ใช้ยกเลิกได้เฉพาะตอน PENDING; admin ยกเลิกได้ถึง PROCESSING
function assertTransition(from, to, { actor = 'admin', trackingNumber } = {}) {
  const allowed = TRANSITIONS[from] || [];
  const userBlocked = actor === 'user' && !(from === 'PENDING' && to === 'CANCELLED');
  if (!allowed.includes(to) || userBlocked) {
    throw conflict('INVALID_STATUS_TRANSITION', `Cannot change order status from ${from} to ${to}`);
  }
  if (to === 'SHIPPED' && !trackingNumber) {
    throw badRequest('trackingNumber is required when status is SHIPPED', [
      { field: 'trackingNumber', message: 'Required' },
    ]);
  }
}

module.exports = { TRANSITIONS, assertTransition };
