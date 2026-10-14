import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { InventoryService } from './inventory.service';

/** Public, read-only stock information (same data the catalog already exposes as `available`). */
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post('check')
  @HttpCode(200)
  check(@Body() body: unknown) {
    return this.inventory.check(body);
  }

  @Get(':cardId')
  get(@Param('cardId') cardId: string) {
    return this.inventory.getStock(cardId);
  }
}
