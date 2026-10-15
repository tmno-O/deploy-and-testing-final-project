import { z } from 'zod';
import { idSchema } from '../common/parse';

export const MAX_ITEMS = 50;
export const MAX_QTY = 100;

const itemSchema = z.object({
  cardId: idSchema,
  qty: z.number().int().min(1).max(MAX_QTY),
});

/** Duplicate cardIds are summed and the list is sorted, so equal requests always normalise identically. */
export const itemsBodySchema = z
  .object({ items: z.array(itemSchema).min(1).max(MAX_ITEMS) })
  .strict()
  .transform(({ items }) => {
    const merged = new Map<string, number>();
    for (const { cardId, qty } of items) merged.set(cardId, (merged.get(cardId) ?? 0) + qty);
    return [...merged.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cardId, qty]) => ({ cardId, qty }));
  })
  .refine((items) => items.every((i) => i.qty <= MAX_QTY), `qty per card must be <= ${MAX_QTY}`);

export const idempotencyKeySchema = z
  .string({ required_error: 'Idempotency-Key header is required' })
  .regex(/^[A-Za-z0-9._:-]{8,100}$/, 'Idempotency-Key must be 8-100 chars of A-Z a-z 0-9 . _ : -');

export const reservationIdSchema = z.string().uuid();
