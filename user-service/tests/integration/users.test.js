const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../src/app');
const { resetStore } = require('../helpers/store');
const { registerUser, bearer } = require('../helpers/factory');

const app = createApp();

beforeEach(resetStore);

describe('authentication guard', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed token', async () => {
    const res = await request(app).get('/users/me').set(bearer('garbage'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('reports an expired token distinctly', async () => {
    const { user } = await registerUser(app);
    const expired = jwt.sign({}, process.env.JWT_SECRET, {
      subject: user.id,
      issuer: 'user-service',
      expiresIn: -5,
    });
    const res = await request(app).get('/users/me').set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a valid token whose user no longer exists', async () => {
    const { token } = await registerUser(app);
    resetStore();
    const res = await request(app).get('/users/me').set(bearer(token));
    expect(res.status).toBe(401);
  });
});

describe('GET /users/me', () => {
  it('returns the current profile', async () => {
    const { token, user } = await registerUser(app, {
      firstName: 'Somchai',
      lastName: 'Jaidee',
      displayName: 'Gg',
    });
    const res = await request(app).get('/users/me').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: user.id,
      firstName: 'Somchai',
      lastName: 'Jaidee',
      displayName: 'Gg',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });
});

describe('PATCH /users/me', () => {
  it('updates first name and last name', async () => {
    const { token } = await registerUser(app);
    const res = await request(app)
      .patch('/users/me')
      .set(bearer(token))
      .send({ firstName: '  Somying ', lastName: 'Rakdee' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ firstName: 'Somying', lastName: 'Rakdee' });

    const me = await request(app).get('/users/me').set(bearer(token));
    expect(me.body.user).toMatchObject({ firstName: 'Somying', lastName: 'Rakdee' });
  });

  it('rejects an empty first name', async () => {
    const { token } = await registerUser(app);
    const res = await request(app).patch('/users/me').set(bearer(token)).send({ firstName: '   ' });
    expect(res.status).toBe(400);
  });

  it('updates display name and email', async () => {
    const { token } = await registerUser(app);
    const res = await request(app)
      .patch('/users/me')
      .set(bearer(token))
      .send({ displayName: 'Renamed', email: 'Renamed@Example.com' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ displayName: 'Renamed', email: 'renamed@example.com' });
  });

  it('rejects an email already used by someone else', async () => {
    await registerUser(app, { email: 'taken@example.com' });
    const { token } = await registerUser(app);
    const res = await request(app).patch('/users/me').set(bearer(token)).send({ email: 'taken@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects an empty body and unknown fields', async () => {
    const { token } = await registerUser(app);
    expect((await request(app).patch('/users/me').set(bearer(token)).send({})).status).toBe(400);
    expect(
      (await request(app).patch('/users/me').set(bearer(token)).send({ id: 'x' })).status
    ).toBe(400);
  });
});

describe('PUT /users/me/password', () => {
  it('changes the password; old one stops working, new one works', async () => {
    const { token, body } = await registerUser(app, { password: 'old-password-1' });
    const res = await request(app)
      .put('/users/me/password')
      .set(bearer(token))
      .send({ currentPassword: 'old-password-1', newPassword: 'new-password-2' });
    expect(res.status).toBe(204);

    const oldLogin = await request(app).post('/auth/login').send({ email: body.email, password: 'old-password-1' });
    const newLogin = await request(app).post('/auth/login').send({ email: body.email, password: 'new-password-2' });
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  });

  it('rejects when the current password is wrong', async () => {
    const { token } = await registerUser(app);
    const res = await request(app)
      .put('/users/me/password')
      .set(bearer(token))
      .send({ currentPassword: 'not-correct', newPassword: 'new-password-2' });
    expect(res.status).toBe(401);
  });
});
