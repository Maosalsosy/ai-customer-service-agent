import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import type { AutoSendGuard } from '../store/types.js';
import { RedisService } from '../common/redis.service.js';
import { WeComAdapterFactory } from './adapter/adapter.factory.js';

const RETRY_QUEUED_AFTER_MS = 15_000;
const FAIL_DISPATCHING_AFTER_MS = 90_000;
const WECHAT_KF_REPLY_WINDOW_MS = 48 * 60 * 60 * 1000;
const WECHAT_KF_REPLY_LIMIT = 5;
const WECHAT_KF_LOCK_TTL_MS = 30_000;
const RELEASE_LOCK_SCRIPT = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

type PreparedOutbound = {
  messageId: string;
  idempotencyKey: string;
  connectionId: string | null;
  externalConversationId?: string;
  content: string;
  autoSendGuard?: AutoSendGuard;
};

export function latestInteractionBeforePreparedReply(
  messages: { id: string; sender: string }[],
  preparedMessageId: string,
) {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.id !== preparedMessageId &&
        (message.sender === 'customer' || message.sender === 'agent'),
    );
}

@Injectable()
export class WecomDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WecomDispatchService.name);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(APP_STORE) private readonly store: AppStore,
    private readonly adapters: WeComAdapterFactory,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.sweepOutbox().catch((error: unknown) => {
        this.logger.warn(
          `outbox sweep failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
    }, 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sendReply(
    tenantId: string,
    conversationId: string,
    content: string,
    autoSendGuard?: AutoSendGuard,
  ) {
    const prepared = await this.store.prepareOutboundReply(
      tenantId,
      conversationId,
      content,
      autoSendGuard,
    );
    return this.dispatchPrepared(tenantId, conversationId, {
      messageId: prepared.messageId,
      idempotencyKey: prepared.idempotencyKey,
      connectionId: prepared.connectionId,
      externalConversationId: prepared.externalConversationId,
      content,
      autoSendGuard: prepared.autoSendGuard,
    });
  }

  private async sweepOutbox() {
    const queuedBefore = new Date(Date.now() - RETRY_QUEUED_AFTER_MS).toISOString();
    const queued = await this.store.listQueuedOutbound(queuedBefore);
    for (const row of queued) {
      try {
        await this.dispatchPrepared(row.tenantId, row.conversationId, row);
      } catch (error) {
        this.logger.warn(
          `outbound ${row.messageId} dispatch skipped: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
    const dispatchingBefore = new Date(
      Date.now() - FAIL_DISPATCHING_AFTER_MS,
    ).toISOString();
    const failed = await this.store.failStaleDispatching(dispatchingBefore);
    if (failed.length) {
      this.logger.warn(
        `marked ${failed.length} dispatching replies unknown; verify channel status before retry`,
      );
    }
  }

  private async dispatchPrepared(
    tenantId: string,
    conversationId: string,
    prepared: PreparedOutbound,
  ) {
    if (prepared.autoSendGuard) {
      const [conversation, tenant, messages] = await Promise.all([
        this.store.getConversation(tenantId, conversationId),
        this.store.getTenant(tenantId),
        this.store.messages(tenantId, conversationId),
      ]);
      const latestInteraction = latestInteractionBeforePreparedReply(
        messages.items,
        prepared.messageId,
      );
      const current = Boolean(
        tenant?.autoSendEnabled &&
        conversation.contactPolicy === 'ai' &&
        conversation.handlingMode === 'ai' &&
        latestInteraction?.sender === 'customer' &&
        latestInteraction.id === prepared.autoSendGuard.expectedCustomerMessageId,
      );
      if (!current) {
        const message = await this.store.finalizeOutboundReply(prepared.messageId, {
          status: 'superseded',
        });
        return {
          message,
          delivery: {
            channelType: 'wecom_mock' as const,
            status: 'superseded' as const,
            simulated: true,
            errorMessage: '自动发送条件已变化，已取消派发',
          },
        };
      }
    }
    const claimed = await this.store.markOutboundDispatching(prepared.messageId);
    if (!claimed) {
      throw new Error('出站消息已被其他工作进程领取');
    }
    const raw = prepared.connectionId
      ? await this.store.getWecomSnapshot(prepared.connectionId)
      : null;
    const snapshot = raw;
    if (!snapshot) {
      const message = await this.store.finalizeOutboundReply(prepared.messageId, {
        status: 'failed',
        externalMessageId: prepared.idempotencyKey,
      });
      return {
        message,
        delivery: {
          channelType: 'wecom_mock' as const,
          status: 'failed' as const,
          simulated: true,
          errorMessage: '会话未绑定企业微信连接',
        },
      };
    }

    if (snapshot.status !== 'connected') {
      const message = await this.store.finalizeOutboundReply(prepared.messageId, {
        status: 'failed',
      });
      return {
        message,
        delivery: {
          channelType: snapshot.channelType,
          status: 'failed' as const,
          simulated: snapshot.channelType === 'wecom_mock',
          errorMessage: '连接未处于已连接状态，消息未发送',
        },
      };
    }

    if (snapshot.channelType === 'wechat_kf') {
      return this.dispatchWechatKf(tenantId, conversationId, prepared, snapshot);
    }

    const adapter = this.adapters.forConnection(snapshot);
    const result = await adapter.sendReply(
      {
        tenantId,
        connectionId: snapshot.id,
        conversationId,
        externalConversationId: prepared.externalConversationId,
        content: prepared.content,
        idempotencyKey: prepared.idempotencyKey,
      },
      snapshot,
    );
    const message = await this.store.finalizeOutboundReply(prepared.messageId, {
      status: result.status,
      externalMessageId: result.externalMessageId ?? prepared.idempotencyKey,
    });
    return {
      message,
      delivery: {
        channelType: snapshot.channelType,
        status: result.status,
        simulated: result.simulated,
        errorMessage: result.errorMessage,
      },
    };
  }

  private async dispatchWechatKf(
    tenantId: string,
    conversationId: string,
    prepared: PreparedOutbound,
    snapshot: NonNullable<Awaited<ReturnType<AppStore['getWecomSnapshot']>>>,
  ) {
    const redis = this.redisService.getClient();
    if (!redis) {
      const message = await this.store.finalizeOutboundReply(prepared.messageId, { status: 'failed' });
      return {
        message,
        delivery: {
          channelType: 'wechat_kf' as const,
          status: 'failed' as const,
          simulated: false,
          errorMessage: 'Redis 不可用，已暂停发送以保护微信客服回复上限',
        },
      };
    }

    const key = `aikefu:wechat-kf:reply:${snapshot.id}:${prepared.externalConversationId ?? conversationId}`;
    const lockToken = randomUUID();
    let locked: string | null;
    try {
      locked = await redis.set(key, lockToken, 'PX', WECHAT_KF_LOCK_TTL_MS, 'NX');
    } catch (error) {
      const message = await this.store.finalizeOutboundReply(prepared.messageId, { status: 'failed' });
      return {
        message,
        delivery: {
          channelType: 'wechat_kf' as const,
          status: 'failed' as const,
          simulated: false,
          errorMessage: `Redis 发送锁不可用，消息未发送：${error instanceof Error ? error.message : 'unknown'}`,
        },
      };
    }
    if (locked !== 'OK') {
      const message = await this.store.finalizeOutboundReply(prepared.messageId, { status: 'failed' });
      return {
        message,
        delivery: {
          channelType: 'wechat_kf' as const,
          status: 'failed' as const,
          simulated: false,
          errorMessage: '该客户正在处理另一条回复，请稍后重试',
        },
      };
    }

    try {
      const messages = (await this.store.messages(tenantId, conversationId)).items;
      const timestampOf = (message: { createdAtMs?: number; createdAt: string }) =>
        message.createdAtMs ?? Date.parse(message.createdAt);
      const latestCustomer = messages
        .filter((message) => message.sender === 'customer')
        .map((message) => timestampOf(message))
        .filter(Number.isFinite)
        .reduce<number | undefined>((latest, at) => latest === undefined || at > latest ? at : latest, undefined);
      let limitError: string | undefined;
      if (latestCustomer === undefined || Date.now() - latestCustomer > WECHAT_KF_REPLY_WINDOW_MS) {
        limitError = '客户最近一次发言已超过 48 小时，微信客服接口不允许继续回复';
      } else {
        const sentSinceCustomer = messages.filter((message) => {
          if (message.id === prepared.messageId || message.sender !== 'agent') return false;
          const at = timestampOf(message);
          if (!Number.isFinite(at) || at < latestCustomer) return false;
          return message.deliveryStatus !== 'failed' && message.deliveryStatus !== 'superseded';
        }).length;
        if (sentSinceCustomer >= WECHAT_KF_REPLY_LIMIT) limitError = '客户本轮 48 小时会话已达到 5 条回复上限';
      }
      if (limitError) {
        const message = await this.store.finalizeOutboundReply(prepared.messageId, { status: 'failed' });
        return {
          message,
          delivery: {
            channelType: 'wechat_kf' as const,
            status: 'failed' as const,
            simulated: false,
            errorMessage: limitError,
          },
        };
      }

      const result = await this.adapters.forConnection(snapshot).sendReply({
        tenantId,
        connectionId: snapshot.id,
        conversationId,
        externalConversationId: prepared.externalConversationId,
        content: prepared.content,
        idempotencyKey: prepared.idempotencyKey,
      }, snapshot);
      const message = await this.store.finalizeOutboundReply(prepared.messageId, {
        status: result.status,
        externalMessageId: result.externalMessageId ?? prepared.idempotencyKey,
      });
      return {
        message,
        delivery: {
          channelType: 'wechat_kf' as const,
          status: result.status,
          simulated: false,
          errorMessage: result.errorMessage,
        },
      };
    } finally {
      try {
        await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, lockToken);
      } catch (error) {
        this.logger.warn(`微信客服发送锁释放失败: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
  }
}
