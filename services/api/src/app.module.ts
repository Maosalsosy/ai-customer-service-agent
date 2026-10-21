import { Module } from '@nestjs/common';
import { HealthController } from './app.controller.js';
import { AiModule } from './ai/ai.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { DraftsModule } from './drafts/drafts.module.js';
import { EventsModule } from './events/events.module.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { SharedModule } from './common/shared.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { StoreModule } from './store/store.module.js';
import { WecomModule } from './wecom/wecom.module.js';

@Module({
  imports: [
    PrismaModule,
    SharedModule,
    StoreModule,
    EventsModule,
    AiModule,
    AuditModule,
    AuthModule,
    ConversationsModule,
    CustomerModule,
    DraftsModule,
    KnowledgeModule,
    WecomModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}



