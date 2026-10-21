import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AiClientService } from '../ai/ai-client.service.js';
import { AiSettingsService } from '../ai/ai-settings.service.js';
import { evaluateReplyPolicy } from '../common/reply-policy.js';
import { RealtimeService } from '../events/realtime.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { buildRetrieveQuery } from '../knowledge/knowledge-retrieve.js';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import type { ContactPolicy, ConversationStatus, ReplyDraft } from '../store/types.js';
import { DraftsService } from '../drafts/drafts.service.js';
import { WecomDispatchService } from '../wecom/wecom-dispatch.service.js';

@Injectable()
export class ConversationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConversationsService.name);
  private readonly autoDraftQueue = new Map<string, Promise<void>>();
  private autoDraftTimer: ReturnType<typeof setInterval> | undefined;
  private polling = false;

  constructor(
    @Inject(APP_STORE) private readonly store: AppStore,
    private readonly ai: AiClientService,
    private readonly aiSettings: AiSettingsService,
    private readonly knowledge: KnowledgeService,
    private readonly wecomDispatch: WecomDispatchService,
    private readonly drafts: DraftsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.autoDraftTimer = setInterval(() => void this.processAutoDraftJobs(), 1_000);
    void this.processAutoDraftJobs();
  }

  onModuleDestroy() {
    if (this.autoDraftTimer) clearInterval(this.autoDraftTimer);
  }

  list(tenantId: string, status?: ConversationStatus, q?: string) {
    return this.store.listConversations(tenantId, status, q);
  }

  get(tenantId: string, id: string) {
    return this.store.getConversation(tenantId, id);
  }

  listExternalContacts(tenantId: string, q?: string, policy?: ContactPolicy) {
    return this.store.listExternalContacts(tenantId, { q, policy });
  }

  async defaultContactPolicy(tenantId: string) {
    const tenant = await this.store.getTenant(tenantId);
    if (!tenant) throw new BadRequestException('租户不存在');
    return { policy: tenant.defaultContactPolicy };
  }

  async setDefaultContactPolicy(tenantId: string, policy: ContactPolicy, actorId: string) {
    this.assertContactPolicy(policy);
    const tenant = await this.store.setDefaultContactPolicy(tenantId, policy);
    this.audit.record({ tenantId, actorId, action: 'contact.default_policy.updated', targetType: 'tenant', targetId: tenantId, detail: { policy } });
    return { policy: tenant.defaultContactPolicy };
  }

  async setExternalContactPolicy(tenantId: string, id: string, policy: ContactPolicy, reason: string | undefined, actorId: string) {
    const result = await this.setExternalContactPolicies(tenantId, [id], policy, reason, actorId);
    if (!result.updated) throw new BadRequestException('联系人不存在');
    return (await this.store.listExternalContacts(tenantId)).items.find((item) => item.id === id);
  }

  async setExternalContactPolicies(tenantId: string, ids: string[], policy: ContactPolicy, reason: string | undefined, actorId: string) {
    this.assertContactPolicy(policy);
    const normalizedIds = [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
    if (!normalizedIds.length || normalizedIds.length > 100) throw new BadRequestException('请在 1 到 100 位联系人范围内操作');
    const normalizedReason = reason?.trim().slice(0, 500) ?? '';
    if (policy === 'blocked' && !normalizedReason) throw new BadRequestException('加入不回复名单时必须填写原因');
    const result = await this.store.setExternalContactPolicies(tenantId, normalizedIds, policy, normalizedReason, actorId);
    this.audit.record({ tenantId, actorId, action: 'contact.policy.bulk_updated', targetType: 'external_contact', detail: { policy, reason: normalizedReason, requested: normalizedIds.length, updated: result.updated } });
    for (const contact of (await this.store.listExternalContacts(tenantId)).items.filter((item) => normalizedIds.includes(item.id))) {
      this.realtime.publish(tenantId, { type: 'conversation.updated', conversationId: contact.id });
    }
    return result;
  }

  private assertContactPolicy(policy: ContactPolicy) {
    if (!policy || !['ai', 'human', 'paused', 'blocked'].includes(policy)) throw new BadRequestException('无效的联系人接待策略');
  }

  async setContactPolicy(
    tenantId: string,
    id: string,
    policy: ContactPolicy | undefined,
    reason: string | undefined,
    actorId: string,
  ) {
    if (!policy || !['ai', 'human', 'paused', 'blocked'].includes(policy)) {
      throw new BadRequestException('无效的联系人接待策略');
    }
    const normalizedReason = reason?.trim().slice(0, 500) ?? '';
    if (policy === 'blocked' && !normalizedReason) {
      throw new BadRequestException('加入不回复名单时必须填写原因');
    }
    const conversation = await this.store.setContactPolicy(
      tenantId,
      id,
      policy,
      normalizedReason,
      actorId,
    );
    await this.store.supersedePendingDrafts(tenantId, id);
    this.audit.record({
      tenantId,
      actorId,
      action: 'contact.policy.updated',
      targetType: 'conversation',
      targetId: id,
      detail: { policy, reason: normalizedReason },
    });
    this.realtime.publish(tenantId, {
      type: 'conversation.updated',
      conversationId: id,
    });
    if (policy === 'ai') this.enqueueAutoDraft(tenantId, id);
    return conversation;
  }

  messages(tenantId: string, conversationId: string) {
    return this.store.messages(tenantId, conversationId);
  }

  async draft(tenantId: string, conversationId: string) {
    const draft = await this.store.draft(tenantId, conversationId);
    if (!draft) return null;
    const citations = await Promise.all(draft.citations.map(async (citation) => {
      if (!citation.documentId) return citation;
      try {
        const current = await this.knowledge.get(tenantId, citation.documentId);
        return {
          ...citation,
          currentDocumentVersion: current.version,
          stale: current.status !== 'ready' || current.version !== citation.documentVersion,
        };
      } catch {
        return { ...citation, stale: true };
      }
    }));
    return { ...draft, citations };
  }

  async assign(
    tenantId: string,
    id: string,
    assignee: { userId: string; displayName: string },
  ) {
    return this.setHandlingMode(tenantId, id, 'human', assignee);
  }

  async setHandlingMode(
    tenantId: string,
    id: string,
    mode: 'ai' | 'human',
    assignee?: { userId: string; displayName: string },
    actorId?: string,
  ) {
    const conversation = await this.store.setHandlingMode(
      tenantId,
      id,
      mode,
      assignee,
    );
    this.audit.record({
      tenantId,
      actorId: actorId ?? assignee?.userId,
      action:
        mode === 'ai' ? 'conversation.mode_ai' : 'conversation.mode_human',
      targetType: 'conversation',
      targetId: id,
      detail: assignee ? { displayName: assignee.displayName } : {},
    });
    if (mode === 'human') {
      await this.store.supersedePendingDrafts(tenantId, id);
    }
    this.realtime.publish(tenantId, {
      type: 'conversation.updated',
      conversationId: id,
    });
    if (mode === 'ai') {
      this.enqueueAutoDraft(tenantId, id);
    }
    return conversation;
  }

  async escalate(
    tenantId: string,
    id: string,
    reason?: string,
    actorId?: string,
  ) {
    this.audit.record({
      tenantId,
      actorId,
      action: 'conversation.escalate',
      targetType: 'conversation',
      targetId: id,
      detail: { reason },
    });
    const conversation = await this.store.escalate(tenantId, id, reason);
    this.realtime.publish(tenantId, {
      type: 'conversation.updated',
      conversationId: id,
    });
    return conversation;
  }

  async markRead(tenantId: string, id: string) {
    const conversation = await this.store.markRead(tenantId, id);
    this.realtime.publish(tenantId, {
      type: 'conversation.updated',
      conversationId: id,
    });
    return conversation;
  }

  listDeadAutoDraftJobs(tenantId: string) {
    return this.store.listDeadAutoDraftJobs(tenantId, 100);
  }

  autoDraftJobMetrics(tenantId: string) {
    return this.store.autoDraftJobMetrics(tenantId);
  }

  async replayDeadAutoDraftJob(tenantId: string, id: string, actorId: string) {
    const requeued = await this.store.requeueDeadAutoDraftJob(tenantId, id);
    if (!requeued) {
      throw new BadRequestException('任务不存在或已被处理，请刷新列表');
    }
    this.audit.record({
      tenantId,
      actorId,
      action: 'auto_draft_job.replay',
      targetType: 'auto_draft_job',
      targetId: id,
    });
    void this.processAutoDraftJobs();
    return { requeued: true };
  }

  async sendReply(
    tenantId: string,
    id: string,
    content: string,
    actorId?: string,
  ) {
    const conversation = await this.store.getConversation(tenantId, id);
    if (conversation.contactPolicy === 'blocked') {
      throw new BadRequestException('该联系人处于不回复名单，不能发送消息');
    }
    const result = await this.wecomDispatch.sendReply(tenantId, id, content);
    this.audit.record({
      tenantId,
      actorId,
      action: 'conversation.reply',
      targetType: 'conversation',
      targetId: id,
      detail: {
        deliveryStatus: result.delivery.status,
        simulated: result.delivery.simulated,
        errorMessage: result.delivery.errorMessage,
      },
    });
    this.realtime.publish(tenantId, {
      type: 'message.created',
      conversationId: id,
      messageId: result.message.id,
    });
    this.realtime.publish(tenantId, {
      type: 'conversation.updated',
      conversationId: id,
    });
    if (result.delivery.status !== 'sent') {
      throw new BadRequestException(
        result.delivery.errorMessage ?? '渠道发送失败',
      );
    }
    return result;
  }

  /** 登记入站自动起草任务；任务通过 PostgreSQL 持久队列处理。 */
  scheduleAutoDraft(
    tenantId: string,
    conversationId: string,
    customerMessage: string,
    customerMessageId: string,
  ): Promise<void> {
    return Promise.resolve(
      this.store.enqueueAutoDraftJob({
        id: this.store.newId('autodraft'),
        tenantId,
        conversationId,
        customerMessageId,
      }),
    ).then((persistent) => {
      if (persistent) {
        void this.processAutoDraftJobs();
        return;
      }
      setImmediate(() => {
        void this.runScheduleAutoDraft(
          tenantId,
          conversationId,
          customerMessage,
        ).catch((error: unknown) =>
          this.logger.warn(
            `auto draft schedule failed: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          ),
        );
      });
    });
  }

  private async processAutoDraftJobs() {
    if (this.polling) return;
    this.polling = true;
    try {
      const jobs = await this.store.claimAutoDraftJobs(10, 300_000);
      await Promise.all(
        jobs.map(async (job) => {
          try {
          this.logger.log(JSON.stringify({
            event: 'auto_draft.started',
            correlationId: job.customerMessageId,
            jobId: job.id,
            tenantId: job.tenantId,
            attempt: job.attempts,
          }));
          await this.createAiDraft(job.tenantId, job.conversationId, undefined, {
            automatic: true,
            expectedMessageId: job.customerMessageId,
          });
            await this.store.completeAutoDraftJob(job.id, job.attemptId);
            this.logger.log(JSON.stringify({
              event: 'auto_draft.completed',
              correlationId: job.customerMessageId,
              jobId: job.id,
              tenantId: job.tenantId,
              attempt: job.attempts,
            }));
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown';
            this.logger.warn(JSON.stringify({
              event: 'auto_draft.failed',
              correlationId: job.customerMessageId,
              jobId: job.id,
              tenantId: job.tenantId,
              attempt: job.attempts,
              error: message,
            }));
            await this.store.retryAutoDraftJob(job.id, job.attemptId, job.attempts, message);
          }
        }),
      );
    } catch (error) {
      this.logger.warn(`auto draft poll failed: ${error instanceof Error ? error.message : 'unknown'}`);
    } finally {
      this.polling = false;
    }
  }

  private async runScheduleAutoDraft(
    tenantId: string,
    conversationId: string,
    customerMessage: string,
  ) {
    const conversation = await this.store.getConversation(
      tenantId,
      conversationId,
    );
    if (conversation.contactPolicy === 'blocked') {
      this.audit.record({
        tenantId,
        action: 'contact.reply.suppressed',
        targetType: 'conversation',
        targetId: conversationId,
        detail: { policy: 'blocked', source: 'inbound_message' },
      });
      return;
    }
    if (conversation.contactPolicy !== 'ai') return;
    const humanMode = conversation.handlingMode === 'human';
    const policy = evaluateReplyPolicy([customerMessage]);
    if (policy.needsHuman) {
      if (!humanMode) {
        await this.escalate(
          tenantId,
          conversationId,
          policy.reason ?? '策略要求转人工',
        );
      }
      if (policy.flags.includes('request_human') && !humanMode) return;
      await this.persistDraft(tenantId, conversationId, {
        content: policy.flags.includes('request_human')
          ? '客户要求人工服务，请尽快接手处理。'
          : '这个问题涉及敏感业务处理，建议由人工客服核实后回复。',
        status: 'needs_human',
        reason: policy.reason,
        citations: [],
        model: { provider: 'policy', name: 'reply-policy-v1' },
      });
      return;
    }

    this.enqueueAutoDraft(tenantId, conversationId);
  }

  /**
   * 同一会话的自动起草串行执行，后到的客户消息覆盖仍在排队的上一轮。
   * 执行时若最后一条客户消息已被坐席或上一轮自动回复覆盖，则跳过。
   */
  private enqueueAutoDraft(tenantId: string, conversationId: string) {
    const key = `${tenantId}:${conversationId}`;
    const prev = this.autoDraftQueue.get(key) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(() =>
        this.createAiDraft(tenantId, conversationId, undefined, {
          automatic: true,
        }),
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.warn(
          `auto draft failed for ${conversationId}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      });
    this.autoDraftQueue.set(key, next);
    void next.finally(() => {
      if (this.autoDraftQueue.get(key) === next) {
        this.autoDraftQueue.delete(key);
      }
    });
  }

  async createAiDraft(
    tenantId: string,
    conversationId: string,
    actorId?: string,
    options?: { automatic?: boolean; profileId?: string; expectedMessageId?: string },
  ) {
    const unanswered = await this.latestUnansweredCustomer(
      tenantId,
      conversationId,
    );
    if (options?.automatic && !unanswered) {
      this.logger.log(
        `skip auto draft for ${conversationId}: customer message already answered`,
      );
      return null;
    }
    if (options?.expectedMessageId && unanswered?.id !== options.expectedMessageId) {
      return null;
    }
    const lastCustomer =
      unanswered?.content ??
      (await this.lastCustomerMessage(tenantId, conversationId));
    const conversation = await this.store.getConversation(
      tenantId,
      conversationId,
    );
    const tenant = await this.store.getTenant(tenantId);
    if (conversation.contactPolicy === 'blocked') {
      if (options?.automatic) return null;
      throw new BadRequestException('该联系人处于不回复名单，不能生成 AI 回复');
    }
    if (options?.automatic && (conversation.handlingMode !== 'ai' || conversation.contactPolicy !== 'ai')) {
      return null;
    }
    const allowEscalate = conversation.handlingMode !== 'human';
    const allowAutoSend = Boolean(options?.automatic && tenant?.autoSendEnabled);
    const context = await this.conversationContext(tenantId, conversationId);
    this.audit.record({
      tenantId,
      actorId,
      action: 'conversation.ai_draft',
      targetType: 'conversation',
      targetId: conversationId,
    });

    const maybeEscalate = async (reason: string) => {
      if (!allowEscalate) return;
      await this.escalate(tenantId, conversationId, reason);
    };

    const policy = evaluateReplyPolicy([lastCustomer]);
    if (policy.needsHuman) {
      const draft = await this.persistDraft(tenantId, conversationId, {
        content: policy.flags.includes('request_human')
          ? '客户要求人工服务，请尽快接手处理。'
          : '这个问题涉及敏感业务处理，建议由人工客服核实后回复。',
        status: 'needs_human',
        reason: policy.reason,
        citations: [],
        model: { provider: 'policy', name: 'reply-policy-v1' },
      });
      await maybeEscalate(policy.reason ?? '策略要求转人工');
      return draft;
    }

    const retrieveQuery = buildRetrieveQuery(lastCustomer, context);
    const ranked = await this.knowledge.retrieve(tenantId, retrieveQuery, 3);
    const hits = ranked.map((hit) => ({
      documentId: hit.documentId,
      title: hit.title,
      excerpt: hit.excerpt,
    }));

    const saveNeedsHuman = async (content: string, reason: string) => {
      const draft = await this.persistDraft(tenantId, conversationId, {
        content,
        status: 'needs_human',
        reason,
        citations: [],
        model: { provider: 'local-rule', name: 'heuristic-v1' },
      });
      await maybeEscalate(reason);
      return draft;
    };

    if (!hits.length) {
      const customerMessage = [...(await this.store.messages(tenantId, conversationId)).items].reverse().find((message) => message.sender === 'customer' && message.content === lastCustomer);
      if (customerMessage) await this.store.recordKnowledgeGap({ tenantId, conversationId, customerMessageId: customerMessage.id, query: customerMessage.content });
      return saveNeedsHuman(
        '这项具体要求我还需要和商务同事核实，确认后尽快回复您。',
        '知识库未命中：没有足够相关的已发布资料',
      );
    }

    const ai = await this.ai.createReplyDraft({
      tenantId,
      conversationId,
      customerMessage: lastCustomer,
      conversationContext: context,
      knowledgeHits: hits,
      provider: await this.aiSettings.credentials(
        tenantId,
        options?.profileId,
      ),
    });

    if (ai && (ai.draft || ai.status === 'needs_human' || ai.status === 'failed')) {
      const citations = await Promise.all((ai.citations ?? []).map(async (c) => {
        const source = c.documentId ? await this.knowledge.get(tenantId, c.documentId) : null;
        return {
          documentTitle: c.documentTitle,
          quote: c.quote,
          documentId: c.documentId,
          documentVersion: source?.version,
        };
      }));
      const fromModel =
        Boolean(ai.model?.provider) &&
        ai.model?.provider !== 'local-rule' &&
        ai.model?.provider !== 'policy';
      const modelReady = ai.status === 'draft_ready' && Boolean(ai.draft);
      const missingEvidence = hits.length === 0;
      const missingCitation =
        hits.length > 0 && citations.length === 0;
      const canAutoSend =
        allowAutoSend &&
        modelReady &&
        fromModel &&
        !missingEvidence &&
        !missingCitation;
      const requiresHuman =
        !modelReady || missingEvidence || missingCitation || ai.status === 'needs_human';
      const status = requiresHuman ? ('needs_human' as const) : ('pending' as const);
      const draft = await this.persistDraft(tenantId, conversationId, {
        content: ai.draft ?? '大模型暂不可用，无法完成回复。',
        status,
        reason: canAutoSend
          ? ai.reason
          : missingEvidence
            ? '未检索到知识依据，需人工核实后发送'
            : modelReady && fromModel && missingCitation
              ? '模型回复缺少知识引用，需人工确认'
              : modelReady && options?.automatic && !tenant?.autoSendEnabled
                ? '租户自动发送已暂停，待客服审核后发送'
                : modelReady && !options?.automatic
                ? '本次为手动生成，待客服审核后发送'
                : modelReady && !fromModel
                  ? '模型未生成回复，已保留知识摘要，需人工确认后发送'
                  : ai.reason,
        citations,
        model: ai.model,
        autoSend: canAutoSend,
        answerToMessageId: unanswered?.id,
      });
      if (status === 'needs_human') {
        await maybeEscalate(ai.reason ?? 'AI 建议转人工');
      }
      return draft;
    }

    const top = hits[0];
    if (!top) {
      return saveNeedsHuman(
        '大模型暂不可用，无法回答知识库以外的问题。',
        '大模型暂不可用',
      );
    }

    return this.persistDraft(tenantId, conversationId, {
      content: top.excerpt.trim() || top.title,
      status: 'pending',
      reason: '模型未生成回复，已保留知识摘要，需人工确认后发送',
      citations: [{ documentTitle: top.title, quote: top.excerpt, documentId: top.documentId, documentVersion: (await this.knowledge.get(tenantId, top.documentId)).version }],
      model: { provider: 'local-rule', name: 'heuristic-v1' },
      autoSend: false,
      answerToMessageId: unanswered?.id,
    });
  }

  private async persistDraft(
    tenantId: string,
    conversationId: string,
    input: {
      content: string;
      status: 'pending' | 'needs_human';
      reason?: string;
      citations: { documentTitle: string; quote: string; documentId?: string; documentVersion?: number }[];
      model?: { provider: string; name: string };
      autoSend?: boolean;
      answerToMessageId?: string;
    },
  ): Promise<ReplyDraft> {
    await this.store.supersedePendingDrafts(tenantId, conversationId);
    const draft = await this.store.saveAiDraft(tenantId, conversationId, input);
    this.realtime.publish(tenantId, {
      type: 'draft.updated',
      conversationId,
      draftId: draft.id,
    });

    if (input.autoSend && input.status === 'pending') {
      const conversation = await this.store.getConversation(
        tenantId,
        conversationId,
      );
      const tenant = await this.store.getTenant(tenantId);
      const stillUnanswered = await this.latestUnansweredCustomer(
        tenantId,
        conversationId,
      );
      const sameTurn =
        !input.answerToMessageId ||
        stillUnanswered?.id === input.answerToMessageId;
      if (
        tenant?.autoSendEnabled &&
        conversation.handlingMode === 'ai' &&
        conversation.contactPolicy === 'ai' &&
        stillUnanswered &&
        sameTurn
      ) {
        try {
          await this.drafts.acceptAndSend(
            tenantId,
            draft.id,
            undefined,
            undefined,
            true,
            input.answerToMessageId,
          );
          this.logger.log(`AI auto-sent draft ${draft.id} for ${conversationId}`);
        } catch (error) {
          this.logger.warn(
            `AI auto-send failed for ${conversationId}: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }
    }

    return draft;
  }

  /** 最后一条客户或坐席消息来自客户时，返回该条消息。 */
  private async latestUnansweredCustomer(
    tenantId: string,
    conversationId: string,
  ) {
    const msgs = await this.store.messages(tenantId, conversationId);
    const last = [...msgs.items]
      .reverse()
      .find((m) => m.sender === 'customer' || m.sender === 'agent');
    if (!last || last.sender !== 'customer') return null;
    const content = last.content.trim();
    if (!content) return null;
    return { id: last.id, content };
  }

  private async lastCustomerMessage(tenantId: string, conversationId: string) {
    const msgs = await this.store.messages(tenantId, conversationId);
    return (
      [...msgs.items].reverse().find((m) => m.sender === 'customer')?.content ??
      ''
    );
  }

  private async conversationContext(tenantId: string, conversationId: string) {
    const msgs = await this.store.messages(tenantId, conversationId);
    return msgs.items
      .filter((m) => m.sender === 'customer' || m.sender === 'agent')
      .slice(-8)
      .map((m) => ({
        role: m.sender as 'customer' | 'agent',
        content: m.content,
      }));
  }
}
