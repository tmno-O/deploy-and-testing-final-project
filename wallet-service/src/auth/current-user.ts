import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from './jwt-auth.guard';

/** The `sub` of the verified JWT. Only valid on routes behind JwtAuthGuard / AdminGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const userId = context.switchToHttp().getRequest<AuthedRequest>().auth?.userId;
  if (!userId) throw new Error('CurrentUser used on a route without JwtAuthGuard');
  return userId;
});
