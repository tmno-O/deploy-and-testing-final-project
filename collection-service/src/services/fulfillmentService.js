const crypto = require('crypto');
const config = require('../config');
const store = require('../store/jsonStore');
const collectionRepo = require('../repositories/collectionRepo');
const orderRepo = require('../repositories/orderRepo');
const userClient = require('../clients/userClient');
const walletClient = require('../clients/walletClient');
const shipping = require('./shipping');
const { assertTransition } = require('./stateMachine');
const { notFound, conflict } = require('../errors');

const ADDRESS_FIELDS = ['recipientName', 'phone', 'line1', 'line2', 'subdistrict', 'district', 'province', 'postalCode'];

// snapshot ที่อยู่ ณ ตอนสั่ง: ผู้ใช้แก้ที่อยู่ใน user-service ทีหลัง order ไม่เปลี่ยน
function snapshotAddress(address) {
  const out = {};
  for (const key of ADDRESS_FIELDS) {
    if (address[key] !== undefined && address[key] !== null) out[key] = address[key];
  }
  return out;
}

async function resolveAddress(body, ctx) {
  if (body.shippingAddress) return { addressId: null, shippingAddress: snapshotAddress(body.shippingAddress) };
  const address = await userClient.getAddress(body.addressId, ctx);
  return { addressId: body.addressId, shippingAddress: snapshotAddress(address) };
}

// ตรวจทุกใบก่อน แล้วค่อยจองทีเดียว: ใบไหนไม่พอ = ไม่จองเลย
async function reserveCards(userId, items) {
  const shortages = [];
  const lines = [];
  for (const item of items) {
    const card = await collectionRepo.find(userId, item.cardId);
    const available = card ? card.availableQuantity : 0;
    if (available < item.quantity) {
      shortages.push({ cardId: item.cardId, requested: item.quantity, available });
    } else {
      lines.push({ cardId: item.cardId, cardName: card.cardName, quantity: item.quantity });
    }
  }
  if (shortages.length) {
    throw conflict('INSUFFICIENT_QUANTITY', 'Not enough cards available to redeem', shortages);
  }
  await collectionRepo.adjustRedeemed(userId, items, +1);
  return lines;
}

async function create(userId, body, ctx) {
  const { shippingFee } = shipping.calculate(body.items, config.shipping);
  // ที่อยู่ก่อน: ถ้า user-service ล่มจะไม่แตะข้อมูลการ์ดเลย
  const address = await resolveAddress(body, ctx);

  const now = new Date().toISOString();
  const order = await store.transaction(async () => {
    const items = await reserveCards(userId, body.items);
    return orderRepo.create({
      id: crypto.randomUUID(),
      userId,
      items,
      ...address,
      shippingFee,
      status: 'PENDING',
      trackingNumber: null,
      paymentStatus: 'NOT_REQUIRED',
      paymentRef: null,
      statusHistory: [{ status: 'PENDING', at: now }],
      createdAt: now,
      updatedAt: now,
    });
  });

  if (shippingFee === 0 || !walletClient.isEnabled()) return order;

  // ตัดค่าส่งจาก Wallet; ไม่สำเร็จ (ยอดไม่พอ / Wallet ล่ม) → ยกเลิกการจองและลบ order
  try {
    const payment = await walletClient.charge(userId, shippingFee, order.id, ctx);
    return await store.transaction(() =>
      orderRepo.update(order.id, { paymentStatus: payment.status, paymentRef: payment.transactionId })
    );
  } catch (err) {
    await store.transaction(async () => {
      await collectionRepo.adjustRedeemed(userId, order.items, -1);
      await orderRepo.remove(order.id);
    });
    throw err;
  }
}

const page = ({ items, total }, { limit, offset }) => ({ data: items, total, limit, offset });

async function list(userId, query) {
  return page(await orderRepo.list(userId, query), query);
}

// order ของคนอื่นตอบ 404 เหมือนไม่มีอยู่ (ไม่บอกว่ามี)
async function getOwned(userId, id) {
  const order = await orderRepo.findById(id);
  if (!order || order.userId !== userId) throw notFound('Order not found');
  return order;
}

async function changeStatus(order, to, { actor, trackingNumber, ctx }) {
  assertTransition(order.status, to, { actor, trackingNumber });

  // คืนเงินก่อนเปลี่ยนสถานะ: ถ้า Wallet ล่ม order ยังเป็นสถานะเดิมและลองใหม่ได้ (idempotencyKey เดิม)
  let refund = null;
  if (to === 'CANCELLED' && order.paymentStatus === 'PAID') {
    refund = await walletClient.refund(order.userId, order.shippingFee, order.id, ctx);
  }

  return store.transaction(async () => {
    const current = await orderRepo.findById(order.id);
    assertTransition(current.status, to, { actor, trackingNumber }); // กันกรณีมีคนเปลี่ยนสถานะระหว่างรอ Wallet
    if (to === 'CANCELLED') await collectionRepo.adjustRedeemed(current.userId, current.items, -1);

    const changes = {
      status: to,
      statusHistory: [...current.statusHistory, { status: to, at: new Date().toISOString() }],
    };
    if (trackingNumber) changes.trackingNumber = trackingNumber;
    if (refund && refund.status === 'REFUNDED') changes.paymentStatus = 'REFUNDED';
    return orderRepo.update(current.id, changes);
  });
}

async function cancel(userId, id, ctx) {
  const order = await getOwned(userId, id);
  return changeStatus(order, 'CANCELLED', { actor: 'user', ctx });
}

async function adminUpdateStatus(id, { status, trackingNumber }, ctx) {
  const order = await orderRepo.findById(id);
  if (!order) throw notFound('Order not found');
  return changeStatus(order, status, { actor: 'admin', trackingNumber, ctx });
}

module.exports = { create, list, getOwned, cancel, adminUpdateStatus };
