const schemas = require('../../src/schemas');

describe('request schemas', () => {
  it('normalizes email to lowercase and trims whitespace', () => {
    const r = schemas.register.parse({
      email: '  Test@Example.COM ',
      password: 'password123',
      firstName: '  Somchai ',
      lastName: ' Jaidee  ',
      displayName: '  Gg  ',
    });
    expect(r.email).toBe('test@example.com');
    expect(r.firstName).toBe('Somchai');
    expect(r.lastName).toBe('Jaidee');
    expect(r.displayName).toBe('Gg');
  });

  it('requires first name and last name', () => {
    const base = { email: 'a@b.co', password: 'password123', displayName: 'x' };
    expect(schemas.register.safeParse(base).success).toBe(false);
    expect(schemas.register.safeParse({ ...base, firstName: 'a' }).success).toBe(false);
    expect(schemas.register.safeParse({ ...base, firstName: 'a', lastName: '  ' }).success).toBe(false);
    expect(schemas.register.safeParse({ ...base, firstName: 'a', lastName: 'b' }).success).toBe(true);
  });

  it('rejects short passwords', () => {
    const r = schemas.register.safeParse({ email: 'a@b.co', password: '1234567', firstName: 'a', lastName: 'b', displayName: 'x' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown fields (prevents mass assignment)', () => {
    const r = schemas.register.safeParse({
      email: 'a@b.co',
      password: 'password123',
      firstName: 'a',
      lastName: 'b',
      displayName: 'x',
      role: 'admin',
    });
    expect(r.success).toBe(false);
  });

  it('requires at least one field for profile update', () => {
    expect(schemas.updateProfile.safeParse({}).success).toBe(false);
    expect(schemas.updateProfile.safeParse({ displayName: 'New' }).success).toBe(true);
    expect(schemas.updateProfile.safeParse({ firstName: 'A', lastName: 'B' }).success).toBe(true);
  });

  it('validates a Thai 5-digit postal code', () => {
    const base = {
      recipientName: 'A',
      phone: '0812345678',
      line1: 'x',
      district: 'd',
      province: 'p',
    };
    expect(schemas.createAddress.safeParse({ ...base, postalCode: '50000' }).success).toBe(true);
    expect(schemas.createAddress.safeParse({ ...base, postalCode: '5000' }).success).toBe(false);
  });

  it('only allows isDefault=true when updating an address', () => {
    expect(schemas.updateAddress.safeParse({ isDefault: false }).success).toBe(false);
    expect(schemas.updateAddress.safeParse({ isDefault: true }).success).toBe(true);
  });
});
