import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { PullsController } from './pulls.controller';
import { PullsRepository } from './pulls.repository';
import { PullsService } from './pulls.service';

@Module({
  imports: [ClientsModule],
  controllers: [PullsController],
  providers: [PullsService, PullsRepository],
})
export class PullsModule {}