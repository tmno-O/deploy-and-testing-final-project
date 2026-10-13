const { TRANSITIONS, assertTransition } = require('../../src/services/stateMachine');

const STATUSES = Object.keys(TRANSITIONS);
const allowed = Object.entries(TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => [from, to]));
const blocked = STATUSES.flatMap((from) =>
  STATUSES.filter((to) => !TRANSITIONS[from].includes(to)).map((to) => [from, to])
);

describe('order state machine', () => {
  it.each(allowed)('admin can move %s → %s', (from, to) => {
    expect(() => assertTransition(from, to, { trackingNumber: 'TH123' })).not.toThrow();
  });

  it.each(blocked)('rejects %s → %s', (from, to) => {
    expect(() => assertTransition(from, to, { trackingNumber: 'TH123' })).toThrow(
      expect.objectContaining({ status: 409, code: 'INVALID_STATUS_TRANSITION' })
    );
  });

  it('treats DELIVERED and CANCELLED as final', () => {
    expect(TRANSITIONS.DELIVERED).toEqual([]);
    expect(TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('requires a tracking number for SHIPPED', () => {
    expect(() => assertTransition('PROCESSING', 'SHIPPED')).toThrow(
      expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR' })
    );
  });

  it('lets a user cancel only while PENDING', () => {
    expect(() => assertTransition('PENDING', 'CANCELLED', { actor: 'user' })).not.toThrow();
    expect(() => assertTransition('PROCESSING', 'CANCELLED', { actor: 'user' })).toThrow(
      expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' })
    );
    expect(() => assertTransition('PENDING', 'PROCESSING', { actor: 'user' })).toThrow();
  });

  it('rejects an unknown current status', () => {
    expect(() => assertTransition('LOST', 'PENDING')).toThrow(expect.objectContaining({ status: 409 }));
  });
});
