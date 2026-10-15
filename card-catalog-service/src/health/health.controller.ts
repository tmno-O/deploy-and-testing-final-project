import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { StoreService } from '../store/store.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly store: StoreService,
    private readonly db: DatabaseService,
  ) {}

  @Get()
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const ready = this.db.enabled ? await this.db.ping() : this.store.isReady();
    res.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ready ? 'ready' : 'unavailable' };
  }
}
