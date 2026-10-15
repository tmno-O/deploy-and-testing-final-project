import { Module } from '@nestjs/common';
import {
  CardRepository,
  PackRepository,
  ReservationRepository,
  StockRepository,
  StockWriter,
} from './catalog.repositories';

const PROVIDERS = [CardRepository, PackRepository, StockRepository, StockWriter, ReservationRepository];

@Module({ providers: PROVIDERS, exports: PROVIDERS })
export class CatalogModule {}
