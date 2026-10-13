const crypto = require('crypto');
const request = require('supertest');
const { serviceKey, bearer, sign } = require('./tokens');

const card = (cardId = 'CARD-001', overrides = {}) => ({
  pullId: crypto.randomUUID(),
  cardId,
  cardName: `Card ${cardId}`,
  cardRarity: 'RARE',
  cardImageUrl: `https://example.com/cards/${cardId}.png`,
  ...overrides,
});

// Gacha เพิ่มการ์ดผ่าน internal endpoint
const grant = (app, userId, cardId, quantity = 1, overrides = {}) =>
  request(app)
    .post(`/internal/collections/${userId}/cards`)
    .set(serviceKey())
    .send(card(cardId, { quantity, ...overrides }));

const validAddress = (overrides = {}) => ({
  recipientName: 'Somchai Jaidee',
  phone: '0812345678',
  line1: '99/1 Moo 3',
  district: 'Mueang',
  province: 'Chiang Mai',
  postalCode: '50000',
  ...overrides,
});

// สร้าง user ที่มีการ์ดตาม map { cardId: quantity }
async function userWithCards(app, cards = {}) {
  const userId = crypto.randomUUID();
  for (const [cardId, quantity] of Object.entries(cards)) {
    const res = await grant(app, userId, cardId, quantity);
    if (res.status !== 201) throw new Error(`grant failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const token = sign(userId);
  return { userId, token, auth: bearer(token) };
}

const createOrder = (app, auth, items, extra = { shippingAddress: validAddress() }) =>
  request(app).post('/fulfillments/orders').set(auth).send({ items, ...extra });

module.exports = { card, grant, validAddress, userWithCards, createOrder };
