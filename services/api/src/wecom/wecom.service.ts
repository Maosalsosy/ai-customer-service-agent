import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DEMO_CONNECTION_ID } from '../store/seed.js';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import type { WecomCapability } from '../store/types.js';
import { WeComAdapterFactory } from './adapter/adapter.factory.js';
import { encryptSecret } from '../common/secret-box.js';
import { decodeAesKey } from './adapter/crypto.js';
import { WeChatKfAdapter } from './adapter/wechat-kf.adapter.js';
import { WecomInboundService } from './wecom-inbound.service.js';

@Injectable()
export class WecomService {
  constructor(
    @Inject(APP_STORE) private readonly store: AppStore,
    private readonly adapters: WeComAdapterFactory,
    private readonly wechatKf: WeChatKfAdapter,
    private readonly inbound: WecomInboundService,
  ) {}

  list(tenantId: string) {
    return this.store.listWecom(tenantId);
  }

  async createMock(tenantId: string, displayName?: string, _knowledgeBaseIds?: string[]) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('生产环境已禁用企业微信模拟连接');
    }
    const knowledgeBaseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
    return this.store.createWecom(tenantId, {
      channelType: 'wecom_mock',
      capability: 'wechat_kf',
      displayName,
      knowledgeBaseId,
    });
  }

  async createPending(
    _tenantId: string,
    _input: {
      displayName: string;
      capability?: WecomCapability;
      corpId?: string;
      agentId?: string;
      knowledgeBaseId?: string;
      knowledgeBaseIds?: string[];
      config?: Record<string, unknown>;
    },
  ) {
    throw new BadRequestException(
      '此处不再创建旧的企业微信员工私聊连接。请配置微信客服账号连接。',
    );
  }

  listWechatKfAccounts(input: { corpId: string; appSecret: string }) {
    return this.wechatKf.listAccounts(input.corpId.trim(), input.appSecret.trim());
  }

  async createWechatKf(
    tenantId: string,
    input: {
      displayName?: string;
      corpId: string;
      appSecret: string;
      callbackToken: string;
      encodingAesKey: string;
      externalAccountId: string;
      knowledgeBaseId?: string;
      knowledgeBaseIds?: string[];
    },
  ) {
    const corpId = input.corpId.trim();
    const appSecret = input.appSecret.trim();
    const callbackToken = input.callbackToken.trim();
    const encodingAesKey = input.encodingAesKey.trim();
    const externalAccountId = input.externalAccountId.trim();
    if (!corpId || !appSecret || !callbackToken || !externalAccountId) {
      throw new BadRequestException('请完整填写企业 ID、应用 Secret、回调 Token 和客服账号');
    }
    try {
      decodeAesKey(encodingAesKey);
    } catch {
      throw new BadRequestException('EncodingAESKey 格式无效，应为企业微信后台生成的 43 位密钥');
    }
    const knowledgeBaseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
    const accounts = await this.wechatKf.listAccounts(corpId, appSecret);
    const selected = accounts.find((account) => account.open_kfid === externalAccountId);
    if (!selected) throw new BadRequestException('该微信客服账号不在当前企业授权账号列表中');
    const existing = await this.store.listWecom(tenantId);
    if (
      existing.items.some(
        (connection) =>
          connection.channelType === 'wechat_kf' &&
          connection.status !== 'disabled' &&
          connection.corpId === corpId &&
          connection.externalAccountId === externalAccountId,
      )
    ) {
      throw new BadRequestException('该微信客服账号已接入当前工作区');
    }

    return this.store.createWecom(tenantId, {
      channelType: 'wechat_kf',
      capability: 'wechat_kf',
      displayName: input.displayName?.trim() || selected.name,
      corpId,
      externalAccountId,
      knowledgeBaseId,
      config: {
        appSecret: encryptSecret(appSecret),
        callbackToken: encryptSecret(callbackToken),
        encodingAesKey: encryptSecret(encodingAesKey),
        syncCursor: '',
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: {
      displayName?: string;
      capability?: WecomCapability;
      corpId?: string;
      agentId?: string;
      config?: Record<string, unknown>;
      knowledgeBaseId?: string | null;
      knowledgeBaseIds?: string[];
    },
  ) {
    const snapshot = await this.inbound.getConnectionSnapshot(id);
    if (snapshot.tenantId !== tenantId) {
      throw new NotFoundException('WeCom connection not found');
    }
    if ((input.knowledgeBaseId !== undefined || input.knowledgeBaseIds !== undefined) && !input.displayName && !input.corpId && !input.config && !input.capability) {
      const knowledgeBaseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
      return this.store.updateWecom(tenantId, id, { knowledgeBaseId, knowledgeBaseIds: [knowledgeBaseId] });
    }
    if (snapshot.channelType === 'wecom') {
      throw new BadRequestException(
        '该历史连接属于旧的员工私聊通道，不能修改或重新启用；请创建微信客服账号连接。',
      );
    }
    if (snapshot.channelType === 'wechat_kf' && (input.knowledgeBaseId !== undefined || input.knowledgeBaseIds !== undefined)) {
      const knowledgeBaseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
      return this.store.updateWecom(tenantId, id, { knowledgeBaseId, knowledgeBaseIds: [knowledgeBaseId] });
    }
    throw new BadRequestException('模拟连接仅用于流程演示，不支持修改真实企业凭证');
  }

  disable(tenantId: string, id: string) {
    return this.store.disableWecom(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    const snapshot = await this.inbound.getConnectionSnapshot(id);
    if (snapshot.tenantId !== tenantId) {
      throw new NotFoundException('WeCom connection not found');
    }
    if (snapshot.channelType !== 'wecom_mock') {
      throw new BadRequestException(
        '真实微信客服连接及历史业务记录会保留；请停用连接，不支持删除。',
      );
    }
    return this.store.deleteWecom(tenantId, id);
  }

  async injectMockMessage(
    tenantId: string,
    input: {
      connectionId?: string;
      contactName: string;
      content: string;
      externalMessageId?: string;
      conversationId?: string;
      externalConversationId?: string;
    },
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('生产环境已禁用模拟消息注入');
    }
    const connectionId = input.connectionId ?? DEMO_CONNECTION_ID;
    const snapshot = await this.inbound.getConnectionSnapshot(connectionId);
    if (snapshot.tenantId !== tenantId) {
      throw new NotFoundException('WeCom connection not found');
    }
    if (snapshot.channelType !== 'wecom_mock') {
      throw new BadRequestException('仅模拟连接支持 inject');
    }
    if (snapshot.status === 'disabled') {
      throw new BadRequestException('连接已停用');
    }

    const externalMessageId =
      input.externalMessageId ??
      `mock-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const externalConversationId =
      input.externalConversationId ??
      (input.conversationId
        ? `conv-${input.conversationId}`
        : `mock-conv-${input.contactName}`);

    return this.inbound.ingestOne({
      tenantId,
      connectionId,
      channelType: 'wecom_mock',
      capability: snapshot.capability,
      externalConversationId,
      externalMessageId,
      contactName: input.contactName,
      contactMeta: '外部联系人 · 模拟',
      senderType: 'customer',
      content: input.content,
      occurredAt: new Date().toISOString(),
      metadata: {
        source: 'mock_inject',
        conversationId: input.conversationId,
      },
    });
  }

  async handleCallbackGet(
    connectionId: string,
    query: Record<string, string | undefined>,
  ) {
    const snapshot = await this.inbound.getConnectionSnapshot(connectionId);
    if (snapshot.channelType === 'wecom') {
      return {
        ok: false,
        message: '旧员工私聊通道已关闭。',
      };
    }
    const adapter = this.adapters.forConnection(snapshot);
    const result = await adapter.verifyUrl(
      { connectionId, method: 'GET', query },
      snapshot,
    );
    if (result.ok && snapshot.channelType === 'wechat_kf' && snapshot.status === 'pending_auth') {
      await this.store.updateWecom(snapshot.tenantId, snapshot.id, {
        status: 'connected',
        errorMessage: null,
      });
    }
    return result;
  }

  async handleCallbackPost(
    connectionId: string,
    query: Record<string, string | undefined>,
    rawBody: string,
    headers?: Record<string, string | undefined>,
  ) {
    const snapshot = await this.inbound.getConnectionSnapshot(connectionId);
    if (snapshot.channelType === 'wecom') {
      return {
        ok: false,
        ingested: 0,
        message: '旧员工私聊通道已关闭，事件未入库。',
      };
    }
    if (snapshot.channelType === 'wecom_mock') return { ok: false, ingested: 0, message: '模拟连接不接受真实回调' };
    const adapter = this.adapters.forConnection(snapshot);
    const input = {
      connectionId,
      method: 'POST' as const,
      query,
      rawBody,
      headers,
    };
    const ok = await adapter.verifyCallback(input, snapshot);
    if (!ok) {
      return { ok: false, message: '回调校验失败或尚未配置真实凭证' };
    }
    let targetSnapshot = snapshot;
    if (snapshot.channelType === 'wechat_kf') {
      const openKfId = this.wechatKf.eventOpenKfId(input, snapshot);
      if (openKfId) {
        const connections = await this.store.listWecom(snapshot.tenantId);
        const target = connections.items.find(
          (item) =>
            item.channelType === 'wechat_kf' &&
            item.status !== 'disabled' &&
            item.corpId === snapshot.corpId &&
            item.externalAccountId === openKfId,
        );
        if (!target) {
          return { ok: true, ingested: 0, message: '该客服账号未接入，事件已忽略' };
        }
        targetSnapshot = await this.inbound.getConnectionSnapshot(target.id);
      }
    }
    if (targetSnapshot.status === 'disabled') {
      return { ok: true, ingested: 0, message: '目标连接已停用，事件已忽略' };
    }
    const batch =
      snapshot.channelType === 'wechat_kf'
        ? await this.wechatKf.normalizeEvent(input, targetSnapshot, snapshot)
        : await adapter.normalizeEvent(input, targetSnapshot);
    const ingested = await this.inbound.ingest(batch.messages);
    await this.store.updateWecom(targetSnapshot.tenantId, targetSnapshot.id, {
      ...(batch.checkpoint ? { config: { ...(targetSnapshot.config ?? {}), ...batch.checkpoint } } : {}),
      status: 'connected',
      errorMessage: null,
    });
    return { ok: true, ingested: ingested.items.length };
  }
}
