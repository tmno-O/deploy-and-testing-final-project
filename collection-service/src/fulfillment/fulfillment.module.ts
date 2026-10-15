import { Module } from '@nestjs/common';
import { CollectionModule } from '../collection/collection.module';
import { AdminOrdersController, OrdersController } from './fulfillment.controller';
import { FulfillmentService } from './fulfillment.service';
import { OrderRepository } from './order.repository';

@Module({
  imports: [CollectionModule],
  controllers: [OrdersController, AdminOrdersController],
  providers: [FulfillmentService, OrderRepository],
})
export class FulfillmentModule {}
