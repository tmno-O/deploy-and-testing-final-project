import { badRequest } from '../common/app-error';

export interface ShippingRules {
  flatFee: number;
  freeMinCards: number;
  maxCardsPerOrder: number;
}

/** Flat fee in whole baht; free from `freeMinCards` cards. */
export function calculateShipping(items: { quantity: number }[], rules: ShippingRules) {
  const totalCards = items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalCards < 1) throw badRequest('An order must contain at least 1 card');
  if (totalCards > rules.maxCardsPerOrder) {
    throw badRequest(`An order can contain at most ${rules.maxCardsPerOrder} cards`);
  }
  return { totalCards, shippingFee: totalCards >= rules.freeMinCards ? 0 : rules.flatFee };
}
