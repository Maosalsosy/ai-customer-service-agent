import { Injectable } from '@nestjs/common';
import type {
  CallbackInput,
  ConnectionSnapshot,
  NormalizedIncomingMessage,
  SendReplyInput,
  SendReplyResult,
  UrlVerifyResult,
  WeComAdapter,
} from './types.js';

@Injectable()
export class MockWeComAdapter implements WeComAdapter {
  async verifyUrl(): Promise<UrlVerifyResult> {
    return { ok: false, message: '模拟连接不提供企业微信 URL 验证' };
  }

  async verifyCallback(): Promise<boolean> {
    return false;
  }

  async normalizeEvent(
    input: CallbackInput,
    connection: ConnectionSnapshot,
  ): Promise<{ messages: NormalizedIncomingMessage[] }> {
    if (!input.rawBody) return { messages: [] };
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      return { messages: [] };
    }
    const content = String(body.content ?? '').trim();
    if (!content) return { messages: [] };
    const contactName = String(body.contactName ?? '模拟客户');
    const externalMessageId = String(
      body.externalMessageId ?? `mock-${Date.now()}`,
    );
    const externalConversationId = String(
      body.externalConversationId ?? `mock-conv-${contactName}`,
    );
    return { messages: [
      {
        tenantId: connection.tenantId,
        connectionId: connection.id,
        channelType: 'wecom_mock',
        capability: connection.capability,
        externalConversationId,
        externalMessageId,
        contactName,
        contactMeta: '外部联系人 · 模拟',
        senderType: 'customer',
        content,
        occurredAt: new Date().toISOString(),
        metadata: { source: 'mock_inject' },
      },
    ] };
  }

  async sendReply(input: SendReplyInput): Promise<SendReplyResult> {
    return {
      status: 'sent',
      simulated: true,
      externalMessageId: input.idempotencyKey,
    };
  }

}
