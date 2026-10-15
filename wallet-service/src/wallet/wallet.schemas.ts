import { z } from 'zod';
import { badRequest } from '../common/app-error';
import { idSchema, paginationShape } from '../common/parse';

/** Same shape card-catalog-service accepts for its Idempotency-Key. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
const keySchema = z.string().regex(IDEMPOTENCY_KEY_PATTERN, 'Must be 8-100 characters of A-Z a-z 0-9 . _ : -');

/** Whole credits only (money is stored as integers). Range limits that depend on config are checked in the service. */
const amount = z.number().int('Must be a whole number').min(1, 'Must be at least 1').max(Number.MAX_SAFE_INTEGER);
const reason = z.string().trim().min(1).max(200);

/** Same id format the other services use for user ids in paths. */
export const userIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, 'Invalid user id');

export const topupSchema = z
  .object({ amount, method: z.string().min(1).max(30).optional(), idempotencyKey: keySchema.optional() })
  .strict();

export const chargeSchema = z.object({ amount, reason: reason.optional(), idempotencyKey: keySchema.optional() }).strict();

export const purchaseSchema = z.object({ packId: idSchema, idempotencyKey: keySchema.optional() }).strict();

export const refundSchema = z
  .object({
    amount,
    /** the charge/purchase being refunded; when sent, the refund can never exceed what that charge took */
    transactionId: z.string().uuid().optional(),
    reason: reason.optional(),
    idempotencyKey: keySchema.optional(),
  })
  .strict();

export const TRANSACTION_TYPES = ['topup', 'purchase', 'charge', 'refund'] as const;

export const transactionsQuerySchema = z.object({
  ...paginationShape,
  type: z.enum(TRANSACTION_TYPES).optional(),
});

/**
 * The key may come in the `Idempotency-Key` header (what card-catalog-service uses) or in the body as
 * `idempotencyKey` (what collection-service sends). One of them is required; if both are sent they must match.
 */
export function resolveIdempotencyKey(header: string | undefined, body: string | undefined): string {
  const check = (value: string, path: string): string => {
    const result = keySchema.safeParse(value);
    if (!result.success) throw badRequest('Invalid request', [{ path, message: result.error.issues[0].message }]);
    return result.data;
  };
  const fromHeader = header === undefined ? undefined : check(header, 'Idempotency-Key');
  const fromBody = body === undefined ? undefined : check(body, 'idempotencyKey');
  if (fromHeader && fromBody && fromHeader !== fromBody) {
    throw badRequest('Invalid request', [
      { path: 'idempotencyKey', message: 'Does not match the Idempotency-Key header' },
    ]);
  }
  const key = fromHeader ?? fromBody;
  if (!key) {
    throw badRequest('Invalid request', [
      { path: 'Idempotency-Key', message: 'Required (send the Idempotency-Key header or idempotencyKey in the body)' },
    ]);
  }
  return key;
}
