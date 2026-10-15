import { Global, Module } from '@nestjs/common';
import { CatalogClient } from './catalog.client';

@Global()
@Module({ providers: [CatalogClient], exports: [CatalogClient] })
export class ClientsModule {}
