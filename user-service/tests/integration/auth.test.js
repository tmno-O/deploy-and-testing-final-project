const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetStore } = require('../helpers/store');
const { registerUser } = require('../helpers/factory');
const userRepo = require('../../src/repositories/userRepo');
const store = require('../../src/store');
const token = require('../../src/services/token');

const app = createApp();

beforeEach(resetStore);

describe('POST /auth/register', () => {
  it('creates a user and returns a token without exposing the password hash', async () => {
    const { res } = await registerUser(app, {
      email: 'New@Example.com',
      firstName: ' Somchai ',
      lastName: 'Jaidee',
      displayName: 'New',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: 'new@example.com',
      firstName: 'Somchai',
      lastName: 'Jaidee',
      displayName: 'New',
    });
    expect(res.body.user.id).toBeDefined();
    expect(res.body.tokenType).toBe('Bearer');
    expect(token.verify(res.body.accessToken).sub).toBe(res.body.user.id);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('stores an argon2id hash, not the plaintext password', async () => {
    await registerUser(app, { email: 'h@example.com', password: 'plain-text-pw' });
    const row = await userRepo.findCredentialsByEmail('h@example.com');
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain('plain-text-pw');
  });

  it('rejects a duplicate email (case-insensitive) with 409', async () => {
    await registerUser(app, { email: 'dup@example.com' });
    const { res } = await registerUser(app, { email: 'DUP@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects invalid input with 400 and field details', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'nope', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toEqual(
      expect.arrayContaining(['email', 'password', 'firstName', 'lastName', 'displayName'])
    );
  });

  it('rejects extra fields such as role', async () => {
    const { res } = await registerUser(app, { role: 'admin' });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('POST /auth/login', () => {
  it('logs in with correct credentials (email is case-insensitive)', async () => {
    await registerUser(app, { email: 'login@example.com', password: 'password123' });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'LOGIN@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.email).toBe('login@example.com');
  });

  it('returns the same error for wrong password and unknown email', async () => {
    await registerUser(app, { email: 'real@example.com', password: 'password123' });
    const wrongPw = await request(app)
      .post('/auth/login')
      .send({ email: 'real@example.com', password: 'wrong-password' });
    const unknown = await request(app)
      .post('/auth/login')
      .send({ email: 'ghost@example.com', password: 'password123' });

    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPw.body).toEqual(unknown.body);
    expect(wrongPw.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a missing password with 400', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'a@b.co' });
    expect(res.status).toBe(400);
  });
});

describe('health', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/ready reports the data store is loaded', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
  });

  it('unknown routes return a JSON 404', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('mock data (data/mock-data.json)', () => {
  it('seed user can log in with password123 and has first/last name', async () => {
    store.reset(store.loadSeed());
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'somchai@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ firstName: 'Somchai', lastName: 'Jaidee' });

    const addrs = await request(app)
      .get('/users/me/addresses')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(addrs.body.addresses).toHaveLength(2);
    expect(addrs.body.addresses[0].isDefault).toBe(true);
  });
});
