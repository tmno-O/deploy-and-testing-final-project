import { badRequest, conflict } from '../common/app-error';
import type { OrderStatus } from '../store/types';

/** Allowed next states; DELIVERED and CANCELLED are final. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export type Actor = 'user' | 'admin';

/** A user may only cancel a PENDING order; an admin may cancel up to PROCESSING. */
export function assertTransition(
  from: OrderStatus,
  to: OrderStatus,
  { actor = 'admin', trackingNumber }: { actor?: Actor; trackingNumber?: string } = {},
): void {
  const userBlocked = actor === 'user' && !(from === 'PENDING' && to === 'CANCELLED');
  if (!TRANSITIONS[from].includes(to) || userBlocked) {
    throw conflict('INVALID_STATUS_TRANSITION', `Cannot change order status from ${from} to ${to}`);
  }
  if (to === 'SHIPPED' && !trackingNumber) {
    throw badRequest('trackingNumber is required when status is SHIPPED', [
      { path: 'trackingNumber', message: 'Required' },
    ]);
  }
}
