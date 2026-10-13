// ทุก method คืน Promise; method ที่แก้ข้อมูลต้องถูกเรียกภายใน store.transaction()
const store = require('../store/jsonStore');

const clone = (value) => JSON.parse(JSON.stringify(value));
const findRecord = (id) => store.data.orders.find((o) => o.id === id) || null;

async function create(order) {
  store.data.orders.push(clone(order));
  return clone(order);
}

async function findById(id) {
  const record = findRecord(id);
  return record ? clone(record) : null;
}

async function list(userId, { limit, offset, status }) {
  const mine = store.data.orders
    .filter((o) => o.userId === userId && (!status || o.status === status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // ใหม่สุดก่อน
  return { items: mine.slice(offset, offset + limit).map(clone), total: mine.length };
}

async function update(id, changes) {
  const record = findRecord(id);
  Object.assign(record, clone(changes), { updatedAt: new Date().toISOString() });
  return clone(record);
}

async function remove(id) {
  store.data.orders = store.data.orders.filter((o) => o.id !== id);
}

module.exports = { create, findById, list, update, remove };
