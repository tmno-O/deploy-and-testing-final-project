import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt-auth.guard';
import { parseOrThrow } from '../common/parse';
import { PullsService } from './pulls.service';
import { idempotencyKeySchema, openPullSchema, pageSchema, uuidSchema } from './pulls.schemas';
import { toView } from './views';

function requestIdOf(req: AuthedRequest): string | undefined {
  const header = req.headers['x-request-id'];
  return typeof header === 'string' ? header : undefined;
}

@Controller('gacha/pulls')
@UseGuards(JwtAuthGuard)
export class PullsController {
  constructor(private readonly pulls: PullsService) {}

  @Post()
  async open(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const { packId } = parseOrThrow(openPullSchema, body);
    const pullId = parseOrThrow(idempotencyKeySchema, req.headers['idempotency-key']);
    const { pull, replay } = await this.pulls.open(req.auth?.userId as string, packId, pullId, requestIdOf(req));
    res.status(replay ? 200 : 201);
    if (replay) res.setHeader('Idempotent-Replayed', 'true');
    return toView(pull);
  }

  @Get()
  list(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { page, limit } = parseOrThrow(pageSchema, query);
    const result = this.pulls.list(req.auth?.userId as string, page, limit);
    return { ...result, data: result.data.map(toView) };
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    parseOrThrow(uuidSchema, id);
    return toView(this.pulls.getOwn(req.auth?.userId as string, id));
  }
}