import { Module } from '@nestjs/common';
import { InternalKeyGuard } from '../auth/internal-key.guard';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ReservationsController } from './reservations.controller';

@Module({
  imports: [CatalogModule],
  controllers: [InventoryController, ReservationsController],
  providers: [InventoryService, InternalKeyGuard],
  exports: [InventoryService],
})
export class InventoryModule {}
