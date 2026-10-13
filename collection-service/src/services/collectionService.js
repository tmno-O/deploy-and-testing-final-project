const store = require('../store/jsonStore');
const collectionRepo = require('../repositories/collectionRepo');
const catalogClient = require('../clients/catalogClient');
const { badRequest, notFound, conflict } = require('../errors');

const page = ({ items, total }, { limit, offset }) => ({ data: items, total, limit, offset });

async function list(userId, query) {
  return page(await collectionRepo.list(userId, query), query);
}

async function get(userId, cardId) {
  const card = await collectionRepo.find(userId, cardId);
  if (!card) throw notFound('Card not in collection');
  return card;
}

const CARD_FIELDS = ['cardName', 'cardRarity', 'cardImageUrl'];

async function resolveCard(body, ctx) {
  if (catalogClient.isEnabled()) {
    return { cardId: body.cardId, ...(await catalogClient.getCard(body.cardId, ctx)) };
  }
  const missing = CARD_FIELDS.filter((f) => body[f] === undefined);
  if (missing.length) {
    throw badRequest(
      'Card details are required while the catalog service is disabled',
      missing.map((field) => ({ field, message: 'Required' }))
    );
  }
  return { cardId: body.cardId, cardName: body.cardName, cardRarity: body.cardRarity, cardImageUrl: body.cardImageUrl };
}

function sameResult(pull, userId, cardId, card) {
  if (pull.userId !== userId || pull.cardId !== cardId) {
    throw conflict('PULL_ID_CONFLICT', 'pullId was already used for a different user or card');
  }
  return { created: false, card };
}

// Gacha เพิ่มการ์ดให้ผู้ใช้; pullId ซ้ำ = retry → คืนผลเดิมไม่เพิ่มซ้ำ
async function addFromGacha(userId, body, ctx) {
  const existing = await collectionRepo.findPull(body.pullId);
  if (existing) return sameResult(existing, userId, body.cardId, await collectionRepo.find(userId, body.cardId));

  // เรียก Catalog นอก transaction เพื่อไม่ถือ lock ระหว่างรอ network
  const card = await resolveCard(body, ctx);

  return store.transaction(async () => {
    const raced = await collectionRepo.findPull(body.pullId);
    if (raced) return sameResult(raced, userId, body.cardId, await collectionRepo.find(userId, body.cardId));
    return { created: true, card: await collectionRepo.addFromPull(userId, card, body.quantity, body.pullId) };
  });
}

module.exports = { list, get, addFromGacha };
