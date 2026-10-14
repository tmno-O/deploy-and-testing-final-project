import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { StoreService } from '../../src/store/store.service';

describe('health', () => {
  let app: INestApplication;
  let store: StoreService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const nestApp = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(nestApp);
    await nestApp.init();
    app = nestApp;
    store = app.get(StoreService);
  });

  afterEach(() => store.reset());
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  test('GET /health returns ok', async () => {
    const res = await http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('GET /health/ready returns ready when the store is loaded', async () => {
    const res = await http().get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  test('GET /health/ready returns 503 when the store is broken', async () => {
    (store.data as unknown as Record<string, unknown>).cards = null;
    const res = await http().get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });

  test('unknown route returns the standard error shape', async () => {
    const res = await http().get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('malformed JSON returns 400 without leaking internals', async () => {
    const res = await http().post('/health').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  test('oversized body returns 413', async () => {
    const res = await http().post('/health').send({ blob: 'x'.repeat(20000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('sets security headers and hides x-powered-by', async () => {
    const res = await http().get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
