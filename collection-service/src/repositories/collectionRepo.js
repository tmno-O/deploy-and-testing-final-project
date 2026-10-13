// ทุก method คืน Promise เพื่อให้สลับไปใช้ PostgreSQL/Supabase ได้โดยไม่แก้ service layer
// method ที่แก้ข้อมูลต้องถูกเรียกภายใน store.transaction()
const crypto = require('crypto');
const store = require('../store/jsonStore');

const toCard = (r) => ({
  cardId: r.cardId,
  cardName: r.cardName,
  cardRarity: r.cardRarity,
  cardImageUrl: r.cardImageUrl,
  quantity: r.quantity,
  redeemedQuantity: r.redeemedQuantity,
  availableQuantity: r.quantity - r.redeemedQuantity,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const findRecord = (userId, cardId) =>
  store.data.collections.find((c) => c.userId === userId && c.cardId === cardId) || null;

async function list(userId, { limit, offset, rarity }) {
  const mine = store.data.collections
    .filter((c) => c.userId === userId && (!rarity || c.cardRarity === rarity))
    .sort((a, b) => a.cardId.localeCompare(b.cardId));
  return { items: mine.slice(offset, offset + limit).map(toCard), total: mine.length };
}

async function find(userId, cardId) {
  const record = findRecord(userId, cardId);
  return record ? toCard(record) : null;
}

async function findPull(pullId) {
  return store.data.pulls.find((p) => p.pullId === pullId) || null;
}

// เพิ่มการ์ดจาก Gacha และบันทึก pullId กันเพิ่มซ้ำ
async function addFromPull(userId, card, quantity, pullId) {
  const now = new Date().toISOString();
  let record = findRecord(userId, card.cardId);
  if (!record) {
    record = {
      id: crypto.randomUUID(),
      userId,
      cardId: card.cardId,
      cardName: card.cardName,
      cardRarity: card.cardRarity,
      cardImageUrl: card.cardImageUrl,
      quantity: 0,
      redeemedQuantity: 0,
      createdAt: now,
    };
    store.data.collections.push(record);
  }
  record.quantity += quantity;
  record.updatedAt = now;
  store.data.pulls.push({ pullId, userId, cardId: card.cardId, quantity, createdAt: now });
  return toCard(record);
}

// เปลี่ยน redeemedQuantity ของหลายใบ: delta > 0 = จอง, < 0 = คืน
async function adjustRedeemed(userId, items, sign) {
  const now = new Date().toISOString();
  for (const item of items) {
    const record = findRecord(userId, item.cardId);
    record.redeemedQuantity += sign * item.quantity;
    record.updatedAt = now;
  }
}

module.exports = { list, find, findPull, addFromPull, adjustRedeemed };
