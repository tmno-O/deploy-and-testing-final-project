const crypto = require('crypto');
const store = require('../store');
const { AppError, unauthorized } = require('../errors');

const MAX_ADDRESSES_PER_USER = 10;

const FIELDS = [
  'recipientName',
  'phone',
  'line1',
  'line2',
  'subdistrict',
  'district',
  'province',
  'postalCode',
];

const toAddress = (r) => ({
  id: r.id,
  recipientName: r.recipientName,
  phone: r.phone,
  line1: r.line1,
  line2: r.line2,
  subdistrict: r.subdistrict,
  district: r.district,
  province: r.province,
  postalCode: r.postalCode,
  isDefault: r.isDefault,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// ลำดับใน array = ลำดับที่สร้าง (เก่าสุดก่อน)
const ofUser = (userId) => store.data.addresses.filter((a) => a.userId === userId);
const findOwned = (userId, id) =>
  store.data.addresses.find((a) => a.id === id && a.userId === userId) || null;

async function list(userId) {
  return ofUser(userId)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault)) // sort เสถียร: default ขึ้นก่อน ที่เหลือเรียงตามที่สร้าง
    .map(toAddress);
}

async function findById(userId, id) {
  const record = findOwned(userId, id);
  return record ? toAddress(record) : null;
}

async function create(userId, data) {
  if (!store.data.users.some((u) => u.id === userId)) {
    throw unauthorized('User no longer exists', 'INVALID_TOKEN');
  }
  const mine = ofUser(userId);
  if (mine.length >= MAX_ADDRESSES_PER_USER) {
    throw new AppError(422, 'ADDRESS_LIMIT_REACHED', `At most ${MAX_ADDRESSES_PER_USER} addresses allowed`);
  }
  const makeDefault = data.isDefault === true || mine.length === 0;
  if (makeDefault) mine.forEach((a) => { a.isDefault = false; });

  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    userId,
    recipientName: data.recipientName,
    phone: data.phone,
    line1: data.line1,
    line2: data.line2 ?? null,
    subdistrict: data.subdistrict ?? null,
    district: data.district,
    province: data.province,
    postalCode: data.postalCode,
    isDefault: makeDefault,
    createdAt: now,
    updatedAt: now,
  };
  store.data.addresses.push(record);
  store.save();
  return toAddress(record);
}

async function update(userId, id, data) {
  const record = findOwned(userId, id);
  if (!record) return null;

  if (data.isDefault === true) {
    ofUser(userId).forEach((a) => { a.isDefault = a.id === id; });
  }
  for (const key of FIELDS) {
    if (data[key] !== undefined) record[key] = data[key];
  }
  record.updatedAt = new Date().toISOString();
  store.save();
  return toAddress(record);
}

async function remove(userId, id) {
  const index = store.data.addresses.findIndex((a) => a.id === id && a.userId === userId);
  if (index === -1) return false;
  const [removed] = store.data.addresses.splice(index, 1);
  // ถ้าลบอันที่เป็น default ให้เลื่อนอันเก่าสุดที่เหลือขึ้นมาเป็น default
  if (removed.isDefault) {
    const oldest = ofUser(userId)[0];
    if (oldest) oldest.isDefault = true;
  }
  store.save();
  return true;
}

module.exports = { list, findById, create, update, remove, MAX_ADDRESSES_PER_USER };
