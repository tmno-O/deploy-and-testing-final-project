import { loadConfig } from '../../src/config/app-config';
import { createPaymentProvider, MockPaymentProvider } from '../../src/payments/payment-provider';

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();
  const req = { userId: 'u1', amount: 100, method: 'mock', idempotencyKey: 'key-12345678' };

  test('supports only the mock method', () => {
    expect(provider.name).toBe('mock');
    expect(provider.methods).toEqual(['mock']);
  });

  test('succeeds and gives the same reference for the same user + key', async () => {
    const a = await provider.charge(req);
    const b = await provider.charge({ ...req, amount: 999 });
    expect(a.providerRef).toMatch(/^mock_[0-9a-f]{24}$/);
    expect(b).toEqual(a);
  });

  test('a different key or user gets a different reference', async () => {
    const a = await provider.charge(req);
    expect((await provider.charge({ ...req, idempotencyKey: 'key-87654321' })).providerRef).not.toBe(a.providerRef);
    expect((await provider.charge({ ...req, userId: 'u2' })).providerRef).not.toBe(a.providerRef);
  });

  test('the factory builds the mock provider from config', () => {
    const config = loadConfig({ JWT_SECRET: 'x'.repeat(32), INTERNAL_API_KEY: 'y'.repeat(32) });
    expect(createPaymentProvider(config)).toBeInstanceOf(MockPaymentProvider);
  });
});
