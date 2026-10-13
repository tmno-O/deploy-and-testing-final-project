const password = require('../../src/services/password');

describe('password service', () => {
  it('hashes with argon2id and never stores plaintext', async () => {
    const hash = await password.hash('secret-pass-1');
    expect(hash).not.toContain('secret-pass-1');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('produces a different hash each time (random salt)', async () => {
    const [a, b] = await Promise.all([password.hash('same'), password.hash('same')]);
    expect(a).not.toBe(b);
  });

  it('verifies the correct password', async () => {
    const hash = await password.hash('correct horse');
    await expect(password.verify(hash, 'correct horse')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await password.hash('correct horse');
    await expect(password.verify(hash, 'wrong horse')).resolves.toBe(false);
  });

  it('returns false (not throw) for a malformed hash', async () => {
    await expect(password.verify('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('verifyDummy always returns false', async () => {
    await expect(password.verifyDummy('anything')).resolves.toBe(false);
  });
});
