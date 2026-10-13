const crypto = require('crypto');
const store = require('../store');
const { conflict } = require('../errors');

const toUser = (r) => ({
  id: r.id,
  email: r.email,
  firstName: r.firstName,
  lastName: r.lastName,
  displayName: r.displayName,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const emailTaken = () => conflict('EMAIL_TAKEN', 'Email is already registered');
const normalize = (email) => email.trim().toLowerCase();
const findRaw = (pred) => store.data.users.find(pred) || null;

async function create({ email, passwordHash, firstName, lastName, displayName }) {
  const normalized = normalize(email);
  if (findRaw((u) => u.email === normalized)) throw emailTaken();
  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    email: normalized,
    passwordHash,
    firstName,
    lastName,
    displayName,
    createdAt: now,
    updatedAt: now,
  };
  store.data.users.push(record);
  store.save();
  return toUser(record);
}

// คืน record ดิบ (มี passwordHash) ใช้เฉพาะตอน login / เปลี่ยนรหัสผ่าน
async function findCredentialsByEmail(email) {
  const normalized = normalize(email);
  return findRaw((u) => u.email === normalized);
}

async function findCredentialsById(id) {
  return findRaw((u) => u.id === id);
}

async function findById(id) {
  const record = findRaw((u) => u.id === id);
  return record ? toUser(record) : null;
}

async function update(id, { firstName, lastName, displayName, email }) {
  const record = findRaw((u) => u.id === id);
  if (!record) return null;

  if (email !== undefined) {
    const normalized = normalize(email);
    if (findRaw((u) => u.email === normalized && u.id !== id)) throw emailTaken();
    record.email = normalized;
  }
  if (firstName !== undefined) record.firstName = firstName;
  if (lastName !== undefined) record.lastName = lastName;
  if (displayName !== undefined) record.displayName = displayName;
  record.updatedAt = new Date().toISOString();
  store.save();
  return toUser(record);
}

async function updatePassword(id, passwordHash) {
  const record = findRaw((u) => u.id === id);
  if (!record) return;
  record.passwordHash = passwordHash;
  record.updatedAt = new Date().toISOString();
  store.save();
}

module.exports = {
  create,
  findCredentialsByEmail,
  findCredentialsById,
  findById,
  update,
  updatePassword,
};
