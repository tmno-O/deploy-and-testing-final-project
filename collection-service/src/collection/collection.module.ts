import { Module } from '@nestjs/common';
import { InternalKeyGuard } from '../auth/internal-key.guard';
import { InternalCollectionController, MyCollectionController } from './collection.controller';
import { CollectionRepository } from './collection.repository';
import { CollectionService } from './collection.service';

@Module({
  controllers: [MyCollectionController, InternalCollectionController],
  providers: [CollectionService, CollectionRepository, InternalKeyGuard],
  exports: [CollectionRepository],
})
export class CollectionModule {}
