import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from './app-error';

const NAMES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  429: 'TOO_MANY_REQUESTS',
};

/** Renders every error as { error: { code, message, details? } } and never leaks internals on 500. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const send = (status: number, code: string, message: string, details?: unknown): void => {
      res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
    };

    if (err instanceof AppError) return send(err.getStatus(), err.code, err.message, err.details);

    if (err instanceof HttpException) {
      const status = err.getStatus();
      const message = status === 404 ? 'Route not found' : err.message;
      return send(status, NAMES[status] ?? 'ERROR', message);
    }

    if (process.env.NODE_ENV !== 'test') {
      const id = host.switchToHttp().getRequest<Request & { id?: string }>().id;
      this.logger.error(`[${id}] ${err instanceof Error ? err.stack : String(err)}`);
    }
    return send(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', 'Internal server error');
  }
}

/**
 * Nest turns body-parser failures into a generic BadRequestException and loses their `type`,
 * so this runs right after the JSON parser and answers malformed / oversized bodies itself.
 */
export function bodyParserErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
  } else if (type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
  } else {
    next(err);
  }
}
