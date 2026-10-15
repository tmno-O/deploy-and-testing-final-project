import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter, bodyParserErrorHandler } from './common/all-exceptions.filter';
import { REQUEST_ID_HEADER } from './common/request-context';
import { APP_CONFIG, type AppConfig } from './config/app-config';

/** Shared by main.ts and the e2e tests so both run with the same security middleware. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet());
  app.enableCors({
    origin: config.corsOrigin.includes('*') ? true : config.corsOrigin,
    exposedHeaders: [REQUEST_ID_HEADER],
  });
  app.useBodyParser('json', { limit: '10kb' });
  app.use(bodyParserErrorHandler);
  app.useGlobalFilters(new AllExceptionsFilter());
}
