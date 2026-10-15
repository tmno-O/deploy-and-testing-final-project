import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user';
import { AdminGuard, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Ctx, type CallContext } from '../common/request-context';
import { FulfillmentService } from './fulfillment.service';

/** The logged-in user's delivery orders. */
@Controller('fulfillments/orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() body: unknown, @Ctx() ctx: CallContext) {
    return this.fulfillment.create(userId, body, ctx);
  }

  @Get()
  list(@CurrentUser() userId: string, @Query() query: Record<string, unknown>) {
    return this.fulfillment.list(userId, query);
  }

  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.fulfillment.getOwned(userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() userId: string, @Param('id') id: string, @Ctx() ctx: CallContext) {
    return this.fulfillment.cancel(userId, id, ctx);
  }
}

/** Requires a JWT whose `sub` is listed in ADMIN_USER_IDS. */
@Controller('admin/fulfillments/orders')
@UseGuards(AdminGuard)
export class AdminOrdersController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.fulfillment.adminList(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.fulfillment.adminGet(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: unknown, @Ctx() ctx: CallContext) {
    return this.fulfillment.adminUpdateStatus(id, body, ctx);
  }
}
