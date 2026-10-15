import { AppError } from '../../src/common/app-error';
import { assertTransition, TRANSITIONS } from '../../src/fulfillment/state-machine';
import { ORDER_STATUSES, type OrderStatus } from '../../src/store/types';

const pairs = ORDER_STATUSES.flatMap((from) => ORDER_STATUSES.map((to) => [from, to] as [OrderStatus, OrderStatus]));

describe('order state machine', () => {
  test.each(pairs)('admin %s -> %s follows TRANSITIONS', (from, to) => {
    const run = () => assertTransition(from, to, { trackingNumber: 'TH1' });
    if (TRANSITIONS[from].includes(to)) expect(run).not.toThrow();
    else expect(run).toThrow(AppError);
  });

  test('a user may only cancel a PENDING order', () => {
    expect(() => assertTransition('PENDING', 'CANCELLED', { actor: 'user' })).not.toThrow();
    expect(() => assertTransition('PROCESSING', 'CANCELLED', { actor: 'user' })).toThrow('PROCESSING to CANCELLED');
    expect(() => assertTransition('PENDING', 'PROCESSING', { actor: 'user' })).toThrow();
  });

  test('SHIPPED needs a tracking number', () => {
    expect(() => assertTransition('PROCESSING', 'SHIPPED')).toThrow('trackingNumber is required');
    try {
      assertTransition('PROCESSING', 'SHIPPED');
    } catch (err) {
      expect(err).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'trackingNumber', message: 'Required' }] });
    }
  });

  test('final states have no way out', () => {
    expect(TRANSITIONS.DELIVERED).toEqual([]);
    expect(TRANSITIONS.CANCELLED).toEqual([]);
  });
});
