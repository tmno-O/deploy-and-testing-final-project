import { z } from 'zod';
import { badRequest } from './app-error';

/** Validates untrusted input with a zod schema; failures become a 400 VALIDATION_ERROR with field details. */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      'Invalid request',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

/** Same id format the importer enforces; rejects anything else before it reaches a lookup. */
export const idSchema = z.string().regex(/^[A-Za-z0-9._-]{1,40}$/, 'Invalid id');

export const uuidSchema = (label: string) => z.string().uuid(`Invalid ${label}`);

/** Same page/limit query params and response envelope as card-catalog-service. */
export const paginationShape = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export interface Page<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(all: T[], { page, limit }: { page: number; limit: number }): Page<T> {
  const start = (page - 1) * limit;
  return { data: all.slice(start, start + limit), page, limit, total: all.length, totalPages: Math.ceil(all.length / limit) };
}
