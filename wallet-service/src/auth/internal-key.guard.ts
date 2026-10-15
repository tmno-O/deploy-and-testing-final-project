import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { unauthorized } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** Service-to-service auth: the caller must send `X-Internal-Key` equal to INTERNAL_API_KEY. */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.expected = sha256(config.internalApiKey);
  }

  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<Request>().headers['x-internal-key'];
    const provided = typeof header === 'string' ? header : '';
    // hash both sides so the comparison is constant-time regardless of length
    if (!provided || !timingSafeEqual(sha256(provided), this.expected)) {
      throw unauthorized('Invalid or missing internal key');
    }
    return true;
  }
}
