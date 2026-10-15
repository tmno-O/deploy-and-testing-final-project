import { calculateShipping } from '../../src/fulfillment/shipping';

const rules = { flatFee: 50, freeMinCards: 5, maxCardsPerOrder: 50 };
const items = (...quantities: number[]) => quantities.map((quantity) => ({ quantity }));

describe('calculateShipping', () => {
  test.each([
    [[1], 50],
    [[4], 50],
    [[5], 0],
    [[2, 3], 0],
    [[50], 0],
  ])('%j cards -> fee %d', (quantities, fee) => {
    expect(calculateShipping(items(...quantities), rules)).toEqual({
      totalCards: quantities.reduce((a, b) => a + b, 0),
      shippingFee: fee,
    });
  });

  test('rejects an empty order and more than maxCardsPerOrder', () => {
    expect(() => calculateShipping([], rules)).toThrow('at least 1 card');
    expect(() => calculateShipping(items(30, 21), rules)).toThrow('at most 50 cards');
  });

  test('uses the configured values', () => {
    expect(calculateShipping(items(2), { flatFee: 80, freeMinCards: 2, maxCardsPerOrder: 3 }).shippingFee).toBe(0);
    expect(calculateShipping(items(1), { flatFee: 80, freeMinCards: 2, maxCardsPerOrder: 3 }).shippingFee).toBe(80);
  });
});
