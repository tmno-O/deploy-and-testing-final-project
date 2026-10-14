import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { StoreService } from '../store/store.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly store: StoreService) {}

  @Get()
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(@Res({ passthrough: true }) res: Response) {
    const ready = this.store.isReady();
    res.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ready ? 'ready' : 'unavailable' };
  }
}
