import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../events/realtime.service.js';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import type { ReplyDraft } from '../store/types.js';
import { WecomDispatchService } from '../wecom/wecom-dispatch.service.js';

const SENDING_STALE_MS = 90_000;

@Injectable()
export class DraftsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DraftsService.name);
  private staleTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(APP_STORE) private readonly store: AppStore,
    private readonly wecomDispatch: WecomDispatchService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.staleTimer = setInterval(() => {
      void this.releaseStaleSends().catch((error: unknown) => {
        this.logger.warn(
          `release stale sends failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.staleTimer) clearInterval(this.staleTimer);
  }

  private async releaseStaleSends() {
    const olderThan = new Date(Date.now() - SENDING_STALE_MS).toISOString();
    const released = await this.store.releaseStaleSendingDrafts(olderThan);
    for (const row of released) {
      this.realtime.publish(row.tenantId, {
        type: 'draft.updated',
        conversationId: row.conversationId,
        draftId: row.id,
      });
    }
  }

  async update(tenantId: string, id: string, content: string, actorId?: string) {
    this.audit.record({
      tenantId,
      actorId,
      action: 'draft.update',
      targetType: 'reply_draft',
      targetId: id,
    });
    const draft = (await this.store.updateDraft(
      tenantId,
      id,
      content,
    )) as ReplyDraft;
    this.realtime.publish(tenantId, {
      type: 'draft.updated',
      conversationId: draft.conversationId,
      draftId: draft.id,
    });
    return draft;
  }

  async accept(tenantId: string, id: string, actorId?: string) {
    this.audit.record({
      tenantId,
      actorId,
      action: 'draft.accept',
      targetType: 'reply_draft',
      targetId: id,
    });
    const draft = (await this.store.reviewDraft(
      tenantId,
      id,
      'accepted',
    )) as ReplyDraft;
    this.realtime.publish(tenantId, {
      type: 'draft.updated',
      conversationId: draft.conversationId,
      draftId: draft.id,
    });
    return draft;
  }

  async reject(tenantId: string, id: string, actorId?: string) {
    this.audit.record({
      tenantId,
      actorId,
      action: 'draft.reject',
      targetType: 'reply_draft',
      targetId: id,
    });
    const draft = (await this.store.reviewDraft(
      tenantId,
      id,
      'rejected',
    )) as ReplyDraft;
    this.realtime.publish(tenantId, {
      type: 'draft.updated',
      conversationId: draft.conversationId,
      draftId: draft.id,
    });
    return draft;
  }

  async acceptAndSend(
    tenantId: string,
    id: string,
    content?: string,
    actorId?: string,
    automatic = false,
    expectedCustomerMessageId?: string,
  ) {
    const existing = await this.store.getDraft(tenantId, id);
    const conversation = await this.store.getConversation(tenantId, existing.conversationId);
    if (conversation.contactPolicy === 'blocked') {
      throw new BadRequestException('该联系人处于不回复名单，不能发送消息');
    }
    if (automatic && (conversation.contactPolicy !== 'ai' || conversation.handlingMode !== 'ai')) {
      throw new BadRequestException('联系人接待策略已变更，自动回复已取消');
    }
    if (automatic && !expectedCustomerMessageId) {
      throw new BadRequestException('自动回复缺少对应客户消息，已取消发送');
    }

    const draft = await this.store.claimDraftForSend(tenantId, id);
    if (automatic) {
      const [currentConversation, tenant, messages] = await Promise.all([
        this.store.getConversation(tenantId, existing.conversationId),
        this.store.getTenant(tenantId),
        this.store.messages(tenantId, existing.conversationId),
      ]);
      const latestInteraction = [...messages.items]
        .reverse()
        .find((message) => message.sender === 'customer' || message.sender === 'agent');
      const stillCurrent =
        tenant?.autoSendEnabled &&
        currentConversation.contactPolicy === 'ai' &&
        currentConversation.handlingMode === 'ai' &&
        latestInteraction?.sender === 'customer' &&
        latestInteraction.id === expectedCustomerMessageId;
      if (!stillCurrent) {
        await this.store.reviewDraft(tenantId, id, 'superseded');
        this.realtime.publish(tenantId, {
          type: 'draft.updated',
          conversationId: existing.conversationId,
          draftId: id,
        });
        throw new BadRequestException('会话策略或客户消息已变化，自动回复已取消');
      }
    }
    const text = (content ?? draft.content).trim();
    if (!text) {
      await this.store.reviewDraft(tenantId, id, 'send_failed');
      throw new BadRequestException('回复内容为空');
    }

    if (content !== undefined && content !== draft.content) {
      await this.store.updateDraft(tenantId, id, text);
      draft.content = text;
    }

    let delivery: Awaited<ReturnType<WecomDispatchService['sendReply']>>;
    try {
      delivery = await this.wecomDispatch.sendReply(
        tenantId,
        draft.conversationId,
        text,
        automatic
          ? { draftId: id, expectedCustomerMessageId: expectedCustomerMessageId! }
          : undefined,
      );
    } catch (error) {
      await this.store.reviewDraft(tenantId, id, 'send_failed');
      this.realtime.publish(tenantId, {
        type: 'draft.updated',
        conversationId: draft.conversationId,
        draftId: id,
      });
      throw error;
    }
    const ok = delivery.delivery.status === 'sent';

    if (delivery.delivery.status === 'superseded') {
      const superseded = await this.store.reviewDraft(tenantId, id, 'superseded');
      this.realtime.publish(tenantId, {
        type: 'draft.updated',
        conversationId: draft.conversationId,
        draftId: id,
      });
      return { draft: superseded as ReplyDraft, message: delivery.message, delivery: delivery.delivery };
    }

    if (!ok) {
      await this.store.reviewDraft(tenantId, id, 'send_failed');
      this.audit.record({
        tenantId,
        actorId,
        action: 'draft.accept_and_send',
        targetType: 'reply_draft',
        targetId: id,
        detail: {
          ok: false,
          deliveryStatus: delivery.delivery.status,
          errorMessage: delivery.delivery.errorMessage,
        },
      });
      this.realtime.publish(tenantId, {
        type: 'draft.updated',
        conversationId: draft.conversationId,
        draftId: id,
      });
      throw new BadRequestException(
        delivery.delivery.errorMessage ?? '渠道发送失败，草稿已标记为发送失败',
      );
    }

    const accepted = await this.store.reviewDraft(tenantId, id, 'accepted');
    this.audit.record({
      tenantId,
      actorId,
      action: 'draft.accept_and_send',
      targetType: 'reply_draft',
      targetId: id,
      detail: {
        ok: true,
        conversationId: draft.conversationId,
        deliveryStatus: delivery.delivery.status,
        simulated: delivery.delivery.simulated,
      },
    });
    this.realtime.publish(tenantId, {
      type: 'draft.updated',
      conversationId: draft.conversationId,
      draftId: id,
    });
    this.realtime.publish(tenantId, {
      type: 'message.created',
      conversationId: draft.conversationId,
      messageId: delivery.message.id,
    });
    this.realtime.publish(tenantId, {
      type: 'conversation.updated',
      conversationId: draft.conversationId,
    });
    return {
      draft: accepted as ReplyDraft,
      message: delivery.message,
      delivery: delivery.delivery,
    };
  }
}
