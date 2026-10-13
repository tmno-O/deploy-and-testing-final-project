const { z } = require('zod');
const config = require('../config');
const http = require('./httpClient');
const { unprocessable, unavailable } = require('../errors');
const { RARITIES } = require('../schemas');

const CODE = 'CATALOG_SERVICE_UNAVAILABLE';

const catalogCard = z.object({
  cardId: z.string(),
  name: z.string().min(1),
  rarity: z.enum(RARITIES),
  imageUrl: z.string().url(),
});

// ปิดอยู่ถ้าไม่ได้ตั้ง CATALOG_SERVICE_URL → ใช้ข้อมูลการ์ดที่ Gacha ส่งมาแทน
const isEnabled = () => Boolean(config.catalog.url);

async function getCard(cardId, { requestId } = {}) {
  const { status, body } = await http.request({
    baseUrl: config.catalog.url,
    path: `/cards/${encodeURIComponent(cardId)}`,
    timeoutMs: config.catalog.timeoutMs,
    requestId,
    unavailableCode: CODE,
  });

  if (status === 404) throw unprocessable('CARD_NOT_FOUND', `Card ${cardId} does not exist in the catalog`);
  const parsed = status === 200 ? catalogCard.safeParse(body && (body.card || body)) : null;
  if (!parsed || !parsed.success) {
    throw unavailable(CODE, `Unexpected response from catalog service (${status})`);
  }
  return { cardName: parsed.data.name, cardRarity: parsed.data.rarity, cardImageUrl: parsed.data.imageUrl };
}

module.exports = { isEnabled, getCard };
