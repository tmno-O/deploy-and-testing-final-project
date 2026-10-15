import { z } from 'zod';
import { idSchema } from '../common/parse';

export const openPullSchema = z.object({ packId: idSchema }).strict();

export const idempotencyKeySchema = z
  .string({ required_error: 'Idempotency-Key header is required (UUID v4)' })
  .uuid('Idempotency-Key must be a UUID');

export const uuidSchema = z.string().uuid('Invalid id');

export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});