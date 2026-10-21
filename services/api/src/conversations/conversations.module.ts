import { Module, forwardRef } from '@nestjs/common';
import { RateLimitGuard } from '../common/rate-limit.guard.js';
import { DraftsModule } from '../drafts/drafts.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { WecomModule } from '../wecom/wecom.module.js';
import { ConversationsController } from './conversations.controller.js';
import { AutoDraftJobsController } from './auto-draft-jobs.controller.js';
import { ConversationsService } from './conversations.service.js';

@Module({
  imports: [KnowledgeModule, DraftsModule, forwardRef(() => WecomModule)],
  controllers: [ConversationsController, AutoDraftJobsController],
  providers: [ConversationsService, RateLimitGuard],
  exports: [ConversationsService],
})
export class ConversationsModule {}
