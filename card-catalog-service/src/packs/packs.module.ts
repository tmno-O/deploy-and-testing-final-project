import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PacksController } from './packs.controller';
import { PacksService } from './packs.service';

@Module({ imports: [CatalogModule], controllers: [PacksController], providers: [PacksService] })
export class PacksModule {}
