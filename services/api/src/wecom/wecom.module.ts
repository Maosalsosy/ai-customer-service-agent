import { Module, forwardRef } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { WeComAdapterFactory } from './adapter/adapter.factory.js';
import { MockWeComAdapter } from './adapter/mock.adapter.js';
import { RealWeComAdapter } from './adapter/real.adapter.js';
import { WeChatKfAdapter } from './adapter/wechat-kf.adapter.js';
import { WecomDispatchService } from './wecom-dispatch.service.js';
import { WecomInboundService } from './wecom-inbound.service.js';
import { WecomController } from './wecom.controller.js';
import { WecomService } from './wecom.service.js';

@Module({
  imports: [forwardRef(() => ConversationsModule)],
  controllers: [WecomController],
  providers: [
    WecomService,
    WecomInboundService,
    WecomDispatchService,
    WeComAdapterFactory,
    MockWeComAdapter,
    RealWeComAdapter,
    WeChatKfAdapter,
  ],
  exports: [
    WecomService,
    WecomDispatchService,
    WeComAdapterFactory,
    WecomInboundService,
  ],
})
export class WecomModule {}
