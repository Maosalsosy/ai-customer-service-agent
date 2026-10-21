import { Global, Module } from '@nestjs/common';
import { APP_STORE } from './app-store.js';
import { PrismaAppStore } from './prisma-app.store.js';

@Global()
@Module({
  providers: [
    PrismaAppStore,
    {
      provide: APP_STORE,
      useExisting: PrismaAppStore,
    },
  ],
  exports: [PrismaAppStore, APP_STORE],
})
export class StoreModule {}
