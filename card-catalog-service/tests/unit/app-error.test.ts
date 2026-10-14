import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../src/common/app-error';

describe('AppError factories', () => {
  test.each([
    [badRequest('bad', { f: 1 }), 400, 'VALIDATION_ERROR'],
    [unauthorized(), 401, 'UNAUTHORIZED'],
    [forbidden(), 403, 'FORBIDDEN'],
    [notFound(), 404, 'NOT_FOUND'],
    [conflict('INSUFFICIENT_STOCK', 'no'), 409, 'INSUFFICIENT_STOCK'],
  ])('%#', (err, status, code) => {
    expect(err.getStatus()).toBe(status);
    expect(err.code).toBe(code);
  });
});
