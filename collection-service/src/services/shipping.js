const { badRequest } = require('../errors');

// ค่าส่งแบบเหมา: ครบ freeMinCards ใบส่งฟรี ไม่ครบคิด flatFee บาท (จำนวนเต็ม)
function calculate(items, { flatFee, freeMinCards, maxCardsPerOrder }) {
  const totalCards = items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalCards < 1) throw badRequest('An order must contain at least 1 card');
  if (totalCards > maxCardsPerOrder) {
    throw badRequest(`An order can contain at most ${maxCardsPerOrder} cards`);
  }
  return { totalCards, shippingFee: totalCards >= freeMinCards ? 0 : flatFee };
}

module.exports = { calculate };
