import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter, bodyParserErrorHandler } from '../../src/common/all-exceptions.filter';
import { AppError, unavailable } from '../../src/common/app-error';

const host = () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const h = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 'req-1' }) }),
  } as unknown as ArgumentsHost;
  return { res, h };
};

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  test('renders AppError with its code and details', () => {
    const { res, h } = host();
    filter.catch(new AppError(409, 'X', 'msg', [{ a: 1 }]), h);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'X', message: 'msg', details: [{ a: 1 }] } });
  });

  test('maps Nest HttpExceptions to the standard shape', () => {
    const { res, h } = host();
    filter.catch(new BadRequestException('bad'), h);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'VALIDATION_ERROR', message: 'bad' } });
  });

  test('hides internals of unknown errors', () => {
    const { res, h } = host();
    filter.catch(new Error('db password is hunter2'), h);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  test('helpers build the right status', () => {
    expect(unavailable('S_UNAVAILABLE', 'down').getStatus()).toBe(503);
  });
});

describe('bodyParserErrorHandler', () => {
  test('passes other errors on', () => {
    const next = jest.fn();
    const err = new Error('x');
    bodyParserErrorHandler(err, {} as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
