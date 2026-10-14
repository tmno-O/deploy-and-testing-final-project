import { Controller, Get, Param } from '@nestjs/common';
import { PacksService } from './packs.service';

@Controller('packs')
export class PacksController {
  constructor(private readonly packs: PacksService) {}

  @Get()
  list() {
    return this.packs.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.packs.get(id);
  }

  @Get(':id/pool')
  pool(@Param('id') id: string) {
    return this.packs.pool(id);
  }
}
