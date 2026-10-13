const schemas = require('../../src/schemas');
const { validAddress } = require('../helpers/factory');

const order = (overrides = {}) => ({
  items: [{ cardId: 'CARD-001', quantity: 1 }],
  shippingAddress: validAddress(),
  ...overrides,
});
const fields = (result) => result.error.issues.map((i) => i.path.join('.'));

describe('schemas.createOrder', () => {
  it('accepts a manual shipping address', () => {
    expect(schemas.createOrder.safeParse(order()).success).toBe(true);
  });

  it('accepts an addressId instead', () => {
    const body = order({ shippingAddress: undefined, addressId: '00000000-0000-4000-8000-000000000000' });
    expect(schemas.createOrder.safeParse(body).success).toBe(true);
  });

  it.each([
    ['phone', { phone: 'abc' }],
    ['postalCode', { postalCode: '1234' }],
    ['recipientName', { recipientName: '' }],
  ])('rejects an invalid %s', (field, overrides) => {
    const result = schemas.createOrder.safeParse(order({ shippingAddress: validAddress(overrides) }));
    expect(result.success).toBe(false);
    expect(fields(result)).toContain(`shippingAddress.${field}`);
  });

  it('rejects empty items', () => {
    const result = schemas.createOrder.safeParse(order({ items: [] }));
    expect(fields(result)).toContain('items');
  });

  it('rejects a duplicate cardId', () => {
    const items = [{ cardId: 'CARD-001', quantity: 1 }, { cardId: 'CARD-001', quantity: 2 }];
    const result = schemas.createOrder.safeParse(order({ items }));
    expect(fields(result)).toContain('items.1.cardId');
  });

  it.each([0, -1, 1.5])('rejects quantity %p', (quantity) => {
    expect(schemas.createOrder.safeParse(order({ items: [{ cardId: 'CARD-001', quantity }] })).success).toBe(false);
  });

  it('rejects both addressId and shippingAddress', () => {
    const result = schemas.createOrder.safeParse(order({ addressId: '00000000-0000-4000-8000-000000000000' }));
    expect(fields(result)).toContain('addressId');
  });

  it('rejects neither addressId nor shippingAddress', () => {
    const result = schemas.createOrder.safeParse(order({ shippingAddress: undefined }));
    expect(fields(result)).toContain('addressId');
  });

  it('rejects unknown fields', () => {
    expect(schemas.createOrder.safeParse(order({ userId: 'x' })).success).toBe(false);
  });
});

describe('schemas.addCard', () => {
  const base = { pullId: '00000000-0000-4000-8000-000000000000', cardId: 'CARD-001' };

  it('defaults quantity to 1', () => {
    expect(schemas.addCard.parse(base).quantity).toBe(1);
  });

  it('requires a UUID pullId', () => {
    expect(schemas.addCard.safeParse({ ...base, pullId: 'pull-1' }).success).toBe(false);
  });

  it('rejects an unknown rarity and unsafe cardId', () => {
    expect(schemas.addCard.safeParse({ ...base, cardRarity: 'LEGENDARY' }).success).toBe(false);
    expect(schemas.addCard.safeParse({ ...base, cardId: '../etc' }).success).toBe(false);
  });
});

describe('schemas.listCollection', () => {
  it('coerces and defaults pagination', () => {
    expect(schemas.listCollection.parse({ limit: '5' })).toEqual({ limit: 5, offset: 0 });
  });

  it('caps limit at 100', () => {
    expect(schemas.listCollection.safeParse({ limit: '101' }).success).toBe(false);
  });
});
