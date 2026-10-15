import { Module } from '@nestjs/common';
import { CatalogClient } from './catalog.client';
import { CollectionClient } from './collection.client';
import { WalletClient } from './wallet.client';

@Module({
  providers: [CatalogClient, WalletClient, CollectionClient],
  exports: [CatalogClient, WalletClient, CollectionClient],
})
export class ClientsModule {}