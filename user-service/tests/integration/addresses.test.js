const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetStore } = require('../helpers/store');
const { registerUser, bearer, validAddress } = require('../helpers/factory');
const { MAX_ADDRESSES_PER_USER } = require('../../src/repositories/addressRepo');

const app = createApp();
const BASE = '/users/me/addresses';

const create = (token, overrides) =>
  request(app).post(BASE).set(bearer(token)).send(validAddress(overrides));

beforeEach(resetStore);

describe('addresses', () => {
  it('requires authentication', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it('makes the first address the default automatically', async () => {
    const { token } = await registerUser(app);
    const res = await create(token);
    expect(res.status).toBe(201);
    expect(res.body.address).toMatchObject({ isDefault: true, postalCode: '50000' });
  });

  it('keeps only one default when a new default is created', async () => {
    const { token } = await registerUser(app);
    const first = await create(token);
    const second = await create(token, { recipientName: 'Second', isDefault: true });
    const list = await request(app).get(BASE).set(bearer(token));

    expect(list.body.addresses).toHaveLength(2);
    expect(list.body.addresses.filter((a) => a.isDefault)).toHaveLength(1);
    expect(list.body.addresses[0].id).toBe(second.body.address.id);
    expect(list.body.addresses[1].id).toBe(first.body.address.id);
  });

  it('does not change the default when a non-default address is added', async () => {
    const { token } = await registerUser(app);
    const first = await create(token);
    const second = await create(token, { recipientName: 'Second' });
    expect(second.body.address.isDefault).toBe(false);
    const got = await request(app).get(`${BASE}/${first.body.address.id}`).set(bearer(token));
    expect(got.body.address.isDefault).toBe(true);
  });

  it('validates the body', async () => {
    const { token } = await registerUser(app);
    const res = await create(token, { postalCode: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('postalCode');
  });

  it('updates an address and can switch the default', async () => {
    const { token } = await registerUser(app);
    await create(token);
    const second = await create(token, { recipientName: 'Second' });
    const res = await request(app)
      .patch(`${BASE}/${second.body.address.id}`)
      .set(bearer(token))
      .send({ province: 'Bangkok', isDefault: true });
    expect(res.status).toBe(200);
    expect(res.body.address).toMatchObject({ province: 'Bangkok', isDefault: true });

    const list = await request(app).get(BASE).set(bearer(token));
    expect(list.body.addresses.filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('promotes another address to default when the default is deleted', async () => {
    const { token } = await registerUser(app);
    const first = await create(token);
    await create(token, { recipientName: 'Second' });
    const del = await request(app).delete(`${BASE}/${first.body.address.id}`).set(bearer(token));
    expect(del.status).toBe(204);

    const list = await request(app).get(BASE).set(bearer(token));
    expect(list.body.addresses).toHaveLength(1);
    expect(list.body.addresses[0].isDefault).toBe(true);
  });

  it('prevents access to another user\'s address (IDOR)', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const addr = await create(alice.token);
    const id = addr.body.address.id;

    expect((await request(app).get(`${BASE}/${id}`).set(bearer(bob.token))).status).toBe(404);
    expect(
      (await request(app).patch(`${BASE}/${id}`).set(bearer(bob.token)).send({ province: 'X' })).status
    ).toBe(404);
    expect((await request(app).delete(`${BASE}/${id}`).set(bearer(bob.token))).status).toBe(404);

    const still = await request(app).get(`${BASE}/${id}`).set(bearer(alice.token));
    expect(still.status).toBe(200);
  });

  it('returns 400 for a non-UUID id and 404 for an unknown UUID', async () => {
    const { token } = await registerUser(app);
    expect((await request(app).get(`${BASE}/abc`).set(bearer(token))).status).toBe(400);
    const res = await request(app)
      .get(`${BASE}/00000000-0000-4000-8000-000000000000`)
      .set(bearer(token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ADDRESS_NOT_FOUND');
  });

  it(`limits each user to ${MAX_ADDRESSES_PER_USER} addresses`, async () => {
    const { token } = await registerUser(app);
    for (let i = 0; i < MAX_ADDRESSES_PER_USER; i += 1) {
      expect((await create(token)).status).toBe(201);
    }
    const res = await create(token);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ADDRESS_LIMIT_REACHED');
  });
});
