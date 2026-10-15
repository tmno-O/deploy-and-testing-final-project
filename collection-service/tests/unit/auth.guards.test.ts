import type { ExecutionContext } from '@nestjs/common';
import { InternalKeyGuard } from '../../src/auth/internal-key.guard';
import { AdminGuard, JwtAuthGuard } from '../../src/auth/jwt-auth.guard';
import { loadConfig } from '../../src/config/app-config';
import { signToken } from '../helpers/auth';

const config = loadConfig({
  NODE_ENV: 'test',
  JWT_SECRET: process.env.JWT_SECRET,
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
  ADMIN_USER_IDS: 'admin-1',
});

const ctx = (headers: Record<string, string | string[] | undefined>) => {
  const req: { headers: typeof headers; auth?: { userId: string } } = { headers };
  return { req, context: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext };
};

describe('JwtAuthGuard / AdminGuard', () => {
  test('sets req.auth for a valid token', () => {
    const { req, context } = ctx({ authorization: `Bearer ${signToken('user-9')}` });
    expect(new JwtAuthGuard(config).canActivate(context)).toBe(true);
    expect(req.auth).toEqual({ userId: 'user-9' });
  });

  test('AdminGuard needs the user id in ADMIN_USER_IDS', () => {
    const guard = new AdminGuard(config);
    expect(guard.canActivate(ctx({ authorization: `Bearer ${signToken('admin-1')}` }).context)).toBe(true);
    expect(() => guard.canActivate(ctx({ authorization: `Bearer ${signToken('user-9')}` }).context)).toThrow(
      'Admin access required',
    );
  });
});

describe('InternalKeyGuard', () => {
  const guard = new InternalKeyGuard(config);

  test('accepts the configured key', () => {
    expect(guard.canActivate(ctx({ 'x-internal-key': process.env.INTERNAL_API_KEY }).context)).toBe(true);
  });

  test.each([
    ['missing', undefined],
    ['empty', ''],
    ['wrong', 'nope'],
    ['a prefix of the key', (process.env.INTERNAL_API_KEY as string).slice(0, 10)],
    ['sent twice', [process.env.INTERNAL_API_KEY as string, 'x']],
  ])('rejects a %s key', (_label, value) => {
    expect(() => guard.canActivate(ctx({ 'x-internal-key': value }).context)).toThrow('Invalid or missing internal key');
  });
});
