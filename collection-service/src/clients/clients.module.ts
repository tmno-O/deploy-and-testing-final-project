import { Global, Module } from '@nestjs/common';
import { CatalogClient } from './catalog.client';
import { UserClient } from './user.client';
import { WalletClient } from './wallet.client';

const CLIENTS = [UserClient, CatalogClient, WalletClient];

@Global()
@Module({ providers: CLIENTS, exports: CLIENTS })
export class ClientsModule {}
