import { Global, Module } from '@nestjs/common';
import { EventsController } from './events.controller.js';
import { RealtimeService } from './realtime.service.js';

@Global()
@Module({
  controllers: [EventsController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class EventsModule {}
