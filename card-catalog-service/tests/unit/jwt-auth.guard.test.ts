import type { ExecutionContext } from '@nestjs/common';
import { AdminGuard, JwtAuthGuard } from '../../src/auth/jwt-auth.guard';
import { loadConfig } from '../../src/config/app-config';
import { signToken } from '../helpers/auth';

const config = loadConfig({
  NODE_ENV: 'test',
  JWT_SECRET: process.env.JWT_SECRET,
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
  ADMIN_USER_IDS: 'admin-1',
});

const ctx = (authorization?: string) => {
  const req: { headers: Record<string, string | undefined>; auth?: { userId: string } } = {
    headers: { authorization },
  };
  return { req, context: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext };
};

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(config);

  test('accepts a valid token and exposes the user id', () => {
    const { req, context } = ctx(`Bearer ${signToken('user-9')}`);
    expect(guard.canActivate(context)).toBe(true);
    expect(req.auth).toEqual({ userId: 'user-9' });
  });

  test('rejects missing and invalid tokens', () => {
    expect(() => guard.canActivate(ctx().context)).toThrow('Missing or malformed');
    expect(() => guard.canActivate(ctx('Bearer nope').context)).toThrow('Invalid token');
  });
});

describe('AdminGuard', () => {
  const guard = new AdminGuard(config);

  test('lets listed admins through and rejects other valid users', () => {
    expect(guard.canActivate(ctx(`Bearer ${signToken('admin-1')}`).context)).toBe(true);
    expect(() => guard.canActivate(ctx(`Bearer ${signToken('someone')}`).context)).toThrow('Admin access required');
  });
});
