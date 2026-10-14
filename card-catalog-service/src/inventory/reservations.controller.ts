import { Body, Controller, Headers, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { InternalKeyGuard } from '../auth/internal-key.guard';
import { InventoryService, toReservationView } from './inventory.service';

/** Service-to-service endpoints (Gacha / Collection). Every route requires the X-Internal-Key header. */
@Controller('inventory/reservations')
@UseGuards(InternalKeyGuard)
export class ReservationsController {
  constructor(private readonly inventory: InventoryService) {}

  @Post()
  create(
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { reservation, replayed } = this.inventory.reserve(key, body);
    res.status(replayed ? 200 : 201);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return toReservationView(reservation);
  }

  @Post(':id/commit')
  @HttpCode(200)
  commit(@Param('id') id: string) {
    return toReservationView(this.inventory.commit(id));
  }

  @Post(':id/release')
  @HttpCode(200)
  release(@Param('id') id: string) {
    return toReservationView(this.inventory.release(id));
  }
}
