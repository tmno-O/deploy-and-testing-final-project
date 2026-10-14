import { HttpException } from '@nestjs/common';

/** Domain error carrying a stable machine-readable `code`; rendered as { error: { code, message, details } }. */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);
export const forbidden = (message = 'Forbidden', code = 'FORBIDDEN') => new AppError(403, code, message);
export const notFound = (message = 'Resource not found', code = 'NOT_FOUND') =>
  new AppError(404, code, message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
