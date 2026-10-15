import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user';
import { InternalKeyGuard } from '../auth/internal-key.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Ctx, type CallContext } from '../common/request-context';
import { CollectionService } from './collection.service';

/** The logged-in user's own collection. */
@Controller('collections/me')
@UseGuards(JwtAuthGuard)
export class MyCollectionController {
  constructor(private readonly collections: CollectionService) {}

  @Get()
  list(@CurrentUser() userId: string, @Query() query: Record<string, unknown>) {
    return this.collections.listMine(userId, query);
  }

  @Get(':cardId')
  get(@CurrentUser() userId: string, @Param('cardId') cardId: string) {
    return this.collections.getMine(userId, cardId);
  }
}

/** Service-to-service endpoints (Gacha, ...). Every route requires the X-Internal-Key header. */
@Controller('internal/collections')
@UseGuards(InternalKeyGuard)
export class InternalCollectionController {
  constructor(private readonly collections: CollectionService) {}

  @Post(':userId/cards')
  async add(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Ctx() ctx: CallContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.collections.addFromGacha(userId, body, ctx);
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Get(':userId')
  list(@Param('userId') userId: string, @Query() query: Record<string, unknown>) {
    return this.collections.list(userId, query);
  }
}
