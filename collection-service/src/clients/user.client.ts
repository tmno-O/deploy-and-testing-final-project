import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError, unauthorized, unavailable, unprocessable } from '../common/app-error';
import type { CallContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { upstreamRequest } from './http-client';

const CODE = 'USER_SERVICE_UNAVAILABLE';

const addressSchema = z
  .object({
    recipientName: z.string(),
    phone: z.string(),
    line1: z.string(),
    line2: z.string().nullish(),
    subdistrict: z.string().nullish(),
    district: z.string(),
    province: z.string(),
    postalCode: z.string(),
  })
  .passthrough();

export type UserAddress = z.infer<typeof addressSchema>;

/** Reads the user's saved address from the User Service, forwarding their Bearer token (it checks ownership). */
@Injectable()
export class UserClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async getAddress(addressId: string, ctx: CallContext = {}): Promise<UserAddress> {
    const { status, body } = await upstreamRequest({
      baseUrl: this.config.userService.url,
      path: `/users/me/addresses/${encodeURIComponent(addressId)}`,
      headers: ctx.authorization ? { Authorization: ctx.authorization } : {},
      timeoutMs: this.config.userService.timeoutMs,
      requestId: ctx.requestId,
      unavailableCode: CODE,
    });

    if (status === 200) {
      const parsed = addressSchema.safeParse((body as { address?: unknown } | null)?.address);
      if (parsed.success) return parsed.data;
    }
    if (status === 404) throw unprocessable('ADDRESS_NOT_FOUND', 'Address not found');
    if (status === 401) throw unauthorized('User service rejected the token', 'INVALID_TOKEN');
    if (status === 400) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid address id');
    throw unavailable(CODE, `Unexpected response from user service (${status})`);
  }
}
