const request = require('supertest');

let counter = 0;

async function registerUser(app, overrides = {}) {
  counter += 1;
  const body = {
    email: `user${counter}@example.com`,
    password: 'password123',
    firstName: 'Somchai',
    lastName: `Jaidee${counter}`,
    displayName: `User ${counter}`,
    ...overrides,
  };
  const res = await request(app).post('/auth/register').send(body);
  return { res, body, token: res.body.accessToken, user: res.body.user };
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

const validAddress = (overrides = {}) => ({
  recipientName: 'Somchai Jaidee',
  phone: '0812345678',
  line1: '99/1 Moo 3',
  district: 'Mueang',
  province: 'Chiang Mai',
  postalCode: '50000',
  ...overrides,
});

module.exports = { registerUser, bearer, validAddress };
