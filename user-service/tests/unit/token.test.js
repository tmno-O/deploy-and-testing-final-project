const jwt = require('jsonwebtoken');
const token = require('../../src/services/token');

const SECRET = process.env.JWT_SECRET;
const USER_ID = '7d0f2c1e-3f5a-4f7e-9a53-0d1c2b3a4e5f';

describe('token service', () => {
  it('signs a token whose subject is the user id and verifies it', () => {
    const { token: t, expiresIn } = token.sign(USER_ID);
    const payload = token.verify(t);
    expect(payload.sub).toBe(USER_ID);
    expect(payload.iss).toBe('user-service');
    expect(expiresIn).toBe(3600);
  });

  it('does not put sensitive data in the payload', () => {
    const { token: t } = token.sign(USER_ID);
    expect(Object.keys(jwt.decode(t)).sort()).toEqual(['exp', 'iat', 'iss', 'sub']);
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({}, SECRET, {
      subject: USER_ID,
      issuer: 'user-service',
      expiresIn: -10,
    });
    expect(() => token.verify(expired)).toThrow(/expired/i);
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({}, 'another-secret', { subject: USER_ID, issuer: 'user-service' });
    expect(() => token.verify(forged)).toThrow();
  });

  it('rejects a token with a different issuer', () => {
    const other = jwt.sign({}, SECRET, { subject: USER_ID, issuer: 'someone-else' });
    expect(() => token.verify(other)).toThrow();
  });

  it('rejects alg=none tokens', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: USER_ID, iss: 'user-service' })).toString('base64url');
    expect(() => token.verify(`${header}.${body}.`)).toThrow();
  });

  it('rejects a tampered token', () => {
    const { token: t } = token.sign(USER_ID);
    const [h, , s] = t.split('.');
    const evil = Buffer.from(JSON.stringify({ sub: 'someone-else', iss: 'user-service' })).toString('base64url');
    expect(() => token.verify(`${h}.${evil}.${s}`)).toThrow();
  });
});
