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
