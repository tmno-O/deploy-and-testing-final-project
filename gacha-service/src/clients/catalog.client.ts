import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { ServiceHttp } from './service-http';
import type { PackPool, Reservation } from './types';

@Injectable()
export class CatalogClient {
  private readonly http: ServiceHttp;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.http = new ServiceHttp('CATALOG', config.services.catalogUrl, config.services.timeoutMs, config.internalApiKey);
  }

  getPool(packId: string, requestId?: string): Promise<PackPool> {
    return this.http.call({ method: 'GET', path: `/packs/${encodeURIComponent(packId)}/pool`, requestId });
  }

  reserve(items: { cardId: string; qty: number }[], idempotencyKey: string, requestId?: string): Promise<Reservation> {
    return this.http.call({
      method: 'POST',
      path: '/inventory/reservations',
      body: { items },
      headers: { 'idempotency-key': idempotencyKey },
      internal: true,
      requestId,
    });
  }

  commit(reservationId: string, requestId?: string): Promise<Reservation> {
    return this.http.call({
      method: 'POST',
      path: `/inventory/reservations/${encodeURIComponent(reservationId)}/commit`,
      internal: true,
      requestId,
    });
  }

  release(reservationId: string, requestId?: string): Promise<Reservation> {
    return this.http.call({
      method: 'POST',
      path: `/inventory/reservations/${encodeURIComponent(reservationId)}/release`,
      internal: true,
      requestId,
    });
  }
}