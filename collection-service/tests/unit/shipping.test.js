const shipping = require('../../src/services/shipping');

const rules = { flatFee: 50, freeMinCards: 5, maxCardsPerOrder: 50 };
const items = (n) => [{ cardId: 'CARD-001', quantity: n }];

describe('shipping.calculate', () => {
  it.each([
    [1, 50],
    [4, 50],
    [5, 0],
    [6, 0],
    [50, 0],
  ])('%i cards → %i baht', (n, fee) => {
    expect(shipping.calculate(items(n), rules)).toEqual({ totalCards: n, shippingFee: fee });
  });

  it('sums quantities across items', () => {
    const result = shipping.calculate(
      [{ cardId: 'A', quantity: 2 }, { cardId: 'B', quantity: 3 }],
      rules
    );
    expect(result).toEqual({ totalCards: 5, shippingFee: 0 });
  });

  it.each([0, 51])('rejects %i cards', (n) => {
    expect(() => shipping.calculate(items(n), rules)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('rejects an empty item list', () => {
    expect(() => shipping.calculate([], rules)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('uses the configured values', () => {
    const custom = { flatFee: 80, freeMinCards: 10, maxCardsPerOrder: 20 };
    expect(shipping.calculate(items(9), custom).shippingFee).toBe(80);
    expect(shipping.calculate(items(10), custom).shippingFee).toBe(0);
    expect(() => shipping.calculate(items(21), custom)).toThrow();
  });
});
