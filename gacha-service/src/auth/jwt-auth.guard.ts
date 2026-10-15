import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { forbidden, unauthorized } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export interface AuthedRequest extends Request {
  auth?: { userId: string };
}

const ALGORITHM = 'HS256';

/**
 * Verifies the Bearer JWT issued by the User Service (HS256, same secret + issuer) and sets `req.auth.userId`.
 * The token only carries `sub`, so roles are not in the token (see AdminGuard).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) protected readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    this.authenticate(req);
    return true;
  }

  protected authenticate(req: AuthedRequest): string {
    const [scheme, token, ...rest] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token || rest.length > 0) {
      throw unauthorized('Missing or malformed Authorization header');
    }
    try {
      // pin the algorithm so "alg: none" / algorithm-confusion tokens are rejected
      const payload = jwt.verify(token, this.config.jwt.secret, {
        algorithms: [ALGORITHM],
        issuer: this.config.jwt.issuer,
      });
      const sub = typeof payload === 'object' ? payload.sub : undefined;
      if (typeof sub !== 'string' || sub.length === 0) throw new jwt.JsonWebTokenError('missing subject');
      req.auth = { userId: sub };
      return sub;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) throw unauthorized('Token expired', 'TOKEN_EXPIRED');
      throw unauthorized('Invalid token', 'INVALID_TOKEN');
    }
  }
}

/** Authenticated AND listed in ADMIN_USER_IDS. An empty list means nobody is admin (deny by default). */
@Injectable()
export class AdminGuard extends JwtAuthGuard {
  override canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const userId = this.authenticate(req);
    if (!this.config.adminUserIds.includes(userId)) throw forbidden('Admin access required');
    return true;
  }
}
