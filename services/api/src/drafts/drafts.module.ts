import { Module } from '@nestjs/common';
import { WecomModule } from '../wecom/wecom.module.js';
import { DraftsController } from './drafts.controller.js';
import { DraftsService } from './drafts.service.js';

@Module({
  imports: [WecomModule],
  controllers: [DraftsController],
  providers: [DraftsService],
  exports: [DraftsService],
})
export class DraftsModule {}
