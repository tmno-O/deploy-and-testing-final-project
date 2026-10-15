import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter, bodyParserErrorHandler } from './common/all-exceptions.filter';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** Shared by main.ts and the e2e tests so both run with the same security middleware. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet());
    // X-Request-Id: use the caller's id or create one, return it, and forward it to other services
  app.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.headers['x-request-id'];
    const id = typeof header === 'string' && /^[\w.:-]{1,100}$/.test(header) ? header : randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  });
  app.enableCors({ origin: config.corsOrigin.includes('*') ? true : config.corsOrigin });
  app.useBodyParser('json', { limit: '10kb' });
  app.use(bodyParserErrorHandler);
  app.useGlobalFilters(new AllExceptionsFilter());
}
