import { createParamDecorator, ExecutionContext, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';
const VALID_ID = /^[A-Za-z0-9._-]{1,128}$/;

export type RequestWithId = Request & { id?: string };

/** What must be forwarded when this service calls another one. */
export interface CallContext {
  requestId?: string;
  authorization?: string;
}

const logger = new Logger('HTTP');

/** Accepts the caller's X-Request-Id (if well-formed) or creates one, echoes it and logs each request with it. */
export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.id);

  if (process.env.NODE_ENV !== 'test') {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.log(`[${req.id}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
  }
  next();
}

/** Controller parameter: `@Ctx() ctx: CallContext`. */
export const Ctx = createParamDecorator((_data: unknown, context: ExecutionContext): CallContext => {
  const req = context.switchToHttp().getRequest<RequestWithId>();
  return { requestId: req.id, authorization: req.header('authorization') };
});
