import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';

@Module({ imports: [CatalogModule], controllers: [CardsController], providers: [CardsService] })
export class CardsModule {}
