import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConversationsService } from '../conversations/conversations.service.js';
import { RealtimeService } from '../events/realtime.service.js';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import type { NormalizedIncomingMessage } from './adapter/types.js';
import { currentRequestId } from '../common/request-context.js';

@Injectable()
export class WecomInboundService {
  private readonly logger = new Logger(WecomInboundService.name);
  constructor(
    @Inject(APP_STORE) private readonly store: AppStore,
    @Inject(forwardRef(() => ConversationsService))
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async getConnectionSnapshot(connectionId: string) {
    return this.store.getWecomSnapshot(connectionId);
  }

  async ingest(messages: NormalizedIncomingMessage[]) {
    const results = [];
    for (const message of messages) {
      results.push(await this.ingestOne(message));
    }
    return { items: results };
  }

  async ingestOne(msg: NormalizedIncomingMessage) {
    if (msg.channelType === 'wecom') {
      throw new BadRequestException(
        '真实企业微信私聊消息接收尚未实现；事件未入库。',
      );
    }
    if (!msg.content?.trim()) {
      throw new BadRequestException('消息内容为空');
    }
    const result = await this.store.ingestNormalizedMessage(msg);
    this.logger.log(JSON.stringify({
      event: 'wecom.inbound',
      requestId: currentRequestId() ?? null,
      correlationId: result.message.id,
      tenantId: msg.tenantId,
      connectionId: msg.connectionId,
      duplicated: result.duplicated,
    }));
    if (!result.duplicated && result.conversationId) {
      this.realtime.publish(msg.tenantId, {
        type: 'message.created',
        conversationId: result.conversationId,
        messageId: result.message.id,
      });
      this.realtime.publish(msg.tenantId, {
        type: 'conversation.updated',
        conversationId: result.conversationId,
      });
    }
    if (msg.senderType === 'customer' && msg.allowAutoDraft !== false && result.conversationId) {
      await this.conversations.scheduleAutoDraft(
        msg.tenantId,
        result.conversationId,
        result.message.content,
        result.message.id,
      );
    }
    return result;
  }
}
