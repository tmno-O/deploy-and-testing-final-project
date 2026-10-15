import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface ProviderChargeRequest {
  userId: string;
  amount: number;
  method: string;
  /** passed to the provider as its own idempotency key, so a retry cannot take the money twice */
  idempotencyKey: string;
}

export interface ProviderChargeResult {
  providerRef: string;
}

/**
 * Where top-up money comes from. A real gateway (Omise, Stripe, ...) implements this interface;
 * `charge` must throw an AppError (402 PAYMENT_DECLINED / 503 PAYMENT_PROVIDER_UNAVAILABLE) when it fails.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly methods: readonly string[];
  charge(req: ProviderChargeRequest): Promise<ProviderChargeResult>;
}

/**
 * Development provider: every top-up succeeds and no real money moves.
 * The reference is derived from (user, key) so a retry gets the same reference back.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly methods = ['mock'] as const;

  async charge(req: ProviderChargeRequest): Promise<ProviderChargeResult> {
    const digest = createHash('sha256').update(`${req.userId}:${req.idempotencyKey}`).digest('hex');
    return { providerRef: `mock_${digest.slice(0, 24)}` };
  }
}

export function createPaymentProvider(config: AppConfig): PaymentProvider {
  // loadConfig() already rejected every other name
  const provider = new MockPaymentProvider();
  new Logger('Payments').warn(
    `PAYMENT_PROVIDER=${config.payment.provider}: top-ups are free test credits, no real payment is taken`,
  );
  return provider;
}
