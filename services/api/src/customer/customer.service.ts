import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import {
  DEMO_CONNECTION_ID,
  DEMO_CUSTOMER_EXTERNAL_ID,
} from '../store/seed.js';
import type { User } from '../store/types.js';
import { WecomInboundService } from '../wecom/wecom-inbound.service.js';

@Injectable()
export class CustomerService {
  constructor(
    @Inject(APP_STORE) private readonly store: AppStore,
    private readonly inbound: WecomInboundService,
  ) {}

  private externalId(user: User) {
    return `${DEMO_CUSTOMER_EXTERNAL_ID}:${user.id}`;
  }

  async thread(tenantId: string, user: User) {
    const listed = await this.store.listConversations(tenantId);
    const externalId = this.externalId(user);
    const conversation =
      listed.items.find((row) => row.externalConversationId === externalId) ??
      null;

    if (!conversation) {
      return {
        conversation: null,
        messages: [] as {
          id: string;
          sender: string;
          content: string;
          createdAt: string;
        }[],
      };
    }

    const msgs = await this.store.messages(tenantId, conversation.id);
    return {
      conversation,
      messages: msgs.items,
    };
  }

  async sendMessage(tenantId: string, user: User, content: string) {
    const text = content.trim();
    if (!text) throw new BadRequestException('消息内容为空');
    const conn = await this.resolveConnection(tenantId);

    const result = await this.inbound.ingestOne({
      tenantId,
      connectionId: conn.id,
      channelType: conn.channelType === 'wecom' ? 'wecom' : 'wecom_mock',
      capability: conn.capability || 'internal_app',
      externalConversationId: this.externalId(user),
      externalMessageId: `demo-cust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      contactName: user.displayName,
      contactMeta: '演示客户门户',
      senderType: 'customer',
      content: text,
      occurredAt: new Date().toISOString(),
    });

    const conversationId = result.conversationId;
    if (!conversationId) {
      throw new BadRequestException('未能创建会话');
    }
    const conversation = await this.store.getConversation(
      tenantId,
      conversationId,
    );
    const msgs = await this.store.messages(tenantId, conversationId);
    return {
      conversation,
      message: result.message,
      messages: msgs.items,
      duplicated: result.duplicated,
    };
  }

  private async resolveConnection(tenantId: string) {
    const listed = await this.store.listWecom(tenantId);
    const preferred = listed.items.find(
      (item) =>
        item.id === DEMO_CONNECTION_ID &&
        item.channelType === 'wecom_mock' &&
        item.status !== 'disabled',
    );
    const fallback = listed.items.find(
      (item) =>
        item.status !== 'disabled' &&
        item.channelType === 'wecom_mock',
    );
    const conn = preferred ?? fallback;
    if (!conn) {
      throw new NotFoundException(
        '没有可用的模拟渠道。演示客户门户只使用模拟连接；请重启本地演示 API 以恢复默认模拟连接。',
      );
    }
    return conn;
  }
}
