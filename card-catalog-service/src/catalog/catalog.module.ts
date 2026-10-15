import { Module, type Provider, type Type } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
  CardRepository,
  InventoryStore,
  PackRepository,
  StockRepository,
} from './catalog.repositories';
import {
  JsonCardRepository,
  JsonInventoryStore,
  JsonPackRepository,
  JsonStockRepository,
} from './json/json.repositories';
import {
  PgCardRepository,
  PgInventoryStore,
  PgPackRepository,
  PgStockRepository,
} from './pg/pg.repositories';

/** DATABASE_URL set => PostgreSQL (Supabase); otherwise the JSON file store. */
function choose<T>(token: abstract new (...args: never[]) => T, json: Type<T>, pg: Type<T>): Provider {
  return {
    provide: token,
    inject: [APP_CONFIG, json, pg],
    useFactory: (config: AppConfig, jsonImpl: T, pgImpl: T) => (config.database ? pgImpl : jsonImpl),
  };
}

const IMPLEMENTATIONS = [
  JsonCardRepository,
  JsonPackRepository,
  JsonStockRepository,
  JsonInventoryStore,
  PgCardRepository,
  PgPackRepository,
  PgStockRepository,
  PgInventoryStore,
];

const PROVIDERS = [
  choose(CardRepository, JsonCardRepository, PgCardRepository),
  choose(PackRepository, JsonPackRepository, PgPackRepository),
  choose(StockRepository, JsonStockRepository, PgStockRepository),
  choose(InventoryStore, JsonInventoryStore, PgInventoryStore),
];

@Module({
  providers: [...IMPLEMENTATIONS, ...PROVIDERS],
  exports: [CardRepository, PackRepository, StockRepository, InventoryStore],
})
export class CatalogModule {}
