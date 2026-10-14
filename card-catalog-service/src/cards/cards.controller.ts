import { Controller, Get, Param, Query } from '@nestjs/common';
import { CardsService } from './cards.service';

@Controller('cards')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.cards.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.cards.get(id);
  }
}
