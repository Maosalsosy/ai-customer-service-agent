import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  statusAfterAgentReply,
  statusAfterCustomerInbound,
  statusAfterNeedsHuman,
} from '../common/conversation-status.js';
import { evaluateReplyPolicy } from '../common/reply-policy.js';
import type { NormalizedIncomingMessage } from '../wecom/adapter/types.js';
import type {
  AiProviderRecord,
  AppStore,
  AuditLogRow,
  AuditLogQuery,
  AuthAccount,
  TenantMemberRow,
  TenantMembership,
} from './app-store.js';
import { MemoryStore } from './memory.store.js';
import { cosine } from '../knowledge/embed.js';
import {
  createSeedWecomConnections,
  DEMO_AGENT,
  DEMO_CONNECTION_ID,
  DEMO_CUSTOMERS,
  DEMO_TENANT,
  DEMO_USER,
} from './seed.js';
import {
  buildSupportAnalytics,
} from '../analytics/build-support-analytics.js';
import type { AnalyticsPeriod } from '../analytics/analytics-range.js';
import type {
  Conversation,
  ConversationStatus,
  ContactPolicy,
  ExternalContact,
  DocStatus,
  KnowledgeDoc,
  Message,
  ReplyDraft,
  Tenant,
  KnowledgeGap,
  WecomCapability,
  WecomConnection,
  WecomStatus,
} from './types.js';

/** 把演示时钟文案（如 11:38 / 昨天 18:20）转成可用 Date */
function parseDemoInstant(raw: string | undefined, fallback = new Date()): Date {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? fallback : d;
  }
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
    0,
    0,
  );
  if (trimmed === '昨天' || trimmed.startsWith('昨天')) {
    const base = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const hm = trimmed.match(/(\d{1,2}):(\d{2})/);
    if (hm) {
      base.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
    }
    return base;
  }
  const hm = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const d = new Date(today);
    d.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
    return d;
  }
  return fallback;
}

@Injectable()
export class MemoryAppStore implements AppStore {
  constructor(private readonly memory: MemoryStore) {}

  listConversations(
    tenantId: string,
    status?: ConversationStatus,
    q?: string,
    opts?: { limit?: number; offset?: number },
  ) {
    let items = this.memory.conversations.filter((c) => c.tenantId === tenantId);
    if (status) items = items.filter((c) => c.status === status);
    if (q?.trim()) {
      const keyword = q.trim();
      items = items.filter(
        (c) =>
          c.contactName.includes(keyword) ||
          c.preview.includes(keyword) ||
          (c.contactMeta?.includes(keyword) ?? false),
      );
    }
    const total = items.length;
    const offset = Math.max(0, opts?.offset ?? 0);
    const limit =
      opts?.limit != null && Number.isFinite(opts.limit)
        ? Math.min(200, Math.max(1, Math.floor(opts.limit)))
        : undefined;
    if (limit != null) items = items.slice(offset, offset + limit);
    return { items, total };
  }

  getConversation(tenantId: string, id: string): Conversation {
    const conversation = this.memory.conversations.find(
      (c) => c.id === id && c.tenantId === tenantId,
    );
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  messages(tenantId: string, conversationId: string) {
    this.getConversation(tenantId, conversationId);
    const items = this.memory.messages.filter(
      (m) => m.conversationId === conversationId && m.tenantId === tenantId,
    );
    return { items };
  }

  draft(tenantId: string, conversationId: string) {
    this.getConversation(tenantId, conversationId);
    return (
      [...this.memory.drafts]
        .reverse()
        .find(
          (d) =>
            d.conversationId === conversationId &&
            d.tenantId === tenantId &&
            (d.reviewStatus === 'pending' ||
              d.reviewStatus === 'send_failed' ||
              d.reviewStatus === 'sending'),
        ) ?? null
    );
  }

  getDraft(tenantId: string, id: string): ReplyDraft {
    const draft = this.memory.drafts.find(
      (d) => d.id === id && d.tenantId === tenantId,
    );
    if (!draft) throw new NotFoundException('Reply draft not found');
    return draft;
  }

  assign(
    tenantId: string,
    id: string,
    assignee: { userId: string; displayName: string },
  ) {
    return this.setHandlingMode(tenantId, id, 'human', assignee);
  }

  setHandlingMode(
    tenantId: string,
    id: string,
    mode: 'ai' | 'human',
    assignee?: { userId: string; displayName: string },
  ) {
    const conversation = this.getConversation(tenantId, id);
    const previous = conversation.handlingMode;
    conversation.handlingMode = mode;
    conversation.contactPolicy = mode;
    conversation.contactPolicyReason = undefined;
    conversation.contactPolicyUpdatedAt = new Date().toISOString();
    conversation.updatedAt = this.memory.nowClock();
    if (mode === 'human') {
      if (assignee) {
        void assignee.userId;
        conversation.assignee = assignee.displayName || DEMO_USER.displayName;
      }
      if (conversation.status === 'open' || conversation.status === 'waiting_human') {
        conversation.status = 'in_progress';
      }
    } else {
      conversation.assignee = null;
      if (conversation.status === 'waiting_human') {
        conversation.status = 'in_progress';
      }
    }
    if (previous !== mode) {
      this.memory.messages.push({
        id: this.memory.newId('m'),
        tenantId,
        conversationId: id,
        sender: 'system',
        content:
          mode === 'ai'
            ? '已切换为 AI 接管。未回复的客户消息会自动回复'
            : '已切换为人工接管',
        createdAt: this.memory.nowClock(),
      });
    }
    return conversation;
  }

  setContactPolicy(
    tenantId: string,
    id: string,
    policy: ContactPolicy,
    reason: string,
    actorId: string,
  ) {
    const conversation = this.getConversation(tenantId, id);
    conversation.contactPolicy = policy;
    conversation.contactPolicyReason = reason || undefined;
    conversation.contactPolicyActorId = actorId;
    conversation.contactPolicyUpdatedAt = new Date().toISOString();
    conversation.handlingMode = policy === 'ai' ? 'ai' : 'human';
    if (policy === 'human') {
      conversation.assignee =
        this.memory.accounts.find((account) => account.id === actorId)?.displayName ??
        DEMO_USER.displayName;
    }
    if (policy !== 'human') conversation.assignee = null;
    conversation.updatedAt = this.memory.nowClock();
    this.memory.messages.push({
      id: this.memory.newId('m'),
      tenantId,
      conversationId: id,
      sender: 'system',
      content: `接待策略已更新：${policy}${reason ? `；原因：${reason}` : ''}`,
      createdAt: this.memory.nowClock(),
    });
    return conversation;
  }

  listExternalContacts(
    tenantId: string,
    input?: { q?: string; policy?: ContactPolicy },
  ) {
    const q = input?.q?.trim().toLocaleLowerCase();
    const items = this.memory.externalContacts
      .filter((contact) => contact.tenantId === tenantId)
      .filter((contact) => !input?.policy || contact.policy === input.policy)
      .filter((contact) => !q || `${contact.displayName} ${contact.externalUserId}`.toLocaleLowerCase().includes(q))
      .map((contact) => {
        const conversations = this.memory.conversations.filter((conversation) => conversation.externalContactId === contact.id && conversation.tenantId === tenantId);
        const last = conversations.map((conversation) => conversation.updatedAt).sort().at(-1);
        return { ...contact, conversationCount: conversations.length, lastMessageAt: last ?? contact.policyUpdatedAt };
      })
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)) as ExternalContact[];
    return { items };
  }

  setDefaultContactPolicy(tenantId: string, policy: ContactPolicy) {
    if (this.memory.tenant.id !== tenantId) throw new NotFoundException('Tenant not found');
    this.memory.tenant.defaultContactPolicy = policy;
    return { ...this.memory.tenant };
  }

  setExternalContactPolicies(
    tenantId: string,
    ids: string[],
    policy: ContactPolicy,
    reason: string,
    actorId: string,
  ) {
    const contacts = this.memory.externalContacts.filter((contact) => contact.tenantId === tenantId && ids.includes(contact.id));
    for (const contact of contacts) {
      contact.policy = policy;
      contact.policyReason = reason || undefined;
      contact.policyActorId = actorId;
      contact.policyUpdatedAt = new Date().toISOString();
      for (const conversation of this.memory.conversations.filter((item) => item.externalContactId === contact.id && item.tenantId === tenantId)) {
        conversation.contactPolicy = policy;
        conversation.contactPolicyReason = contact.policyReason;
        conversation.contactPolicyActorId = actorId;
        conversation.contactPolicyUpdatedAt = contact.policyUpdatedAt;
        conversation.handlingMode = policy === 'ai' ? 'ai' : 'human';
        conversation.assignee = policy === 'human'
          ? this.memory.accounts.find((account) => account.id === actorId)?.displayName ?? DEMO_USER.displayName
          : null;
        this.supersedePendingDrafts(tenantId, conversation.id);
        this.memory.messages.push({
          id: this.memory.newId('m'), tenantId, conversationId: conversation.id, sender: 'system',
          content: `联系人接待策略已更新：${policy}${reason ? `；原因：${reason}` : ''}`,
          createdAt: this.memory.nowClock(),
        });
      }
    }
    return { updated: contacts.length };
  }

  escalate(tenantId: string, id: string, reason?: string) {
    const conversation = this.getConversation(tenantId, id);
    const alreadyWaiting = conversation.status === 'waiting_human';
    conversation.status = statusAfterNeedsHuman();
    conversation.handlingMode = 'human';
    conversation.contactPolicy = 'human';
    conversation.contactPolicyReason = reason;
    conversation.contactPolicyUpdatedAt = this.memory.nowClock();
    conversation.updatedAt = this.memory.nowClock();
    if (!alreadyWaiting) {
      this.memory.messages.push({
        id: this.memory.newId('m'),
        tenantId,
        conversationId: id,
        sender: 'system',
        content: `已转人工${reason ? `：${reason}` : ''}`,
        createdAt: this.memory.nowClock(),
      });
    }
    return conversation;
  }

  close(tenantId: string, id: string): never {
    this.getConversation(tenantId, id);
    throw new BadRequestException(
      '企业微信会话由客户发消息维持，不能在工作台结束',
    );
  }

  markRead(tenantId: string, id: string) {
    const conversation = this.getConversation(tenantId, id);
    conversation.unread = false;
    return conversation;
  }

  supersedePendingDrafts(tenantId: string, conversationId: string) {
    for (const old of this.memory.drafts) {
      if (
        old.tenantId === tenantId &&
        old.conversationId === conversationId &&
        (old.reviewStatus === 'pending' || old.reviewStatus === 'send_failed')
      ) {
        old.reviewStatus = 'superseded';
      }
    }
  }

  saveAiDraft(
    tenantId: string,
    conversationId: string,
    input: {
      content: string;
      status: 'pending' | 'needs_human';
      reason?: string;
      citations: { documentTitle: string; quote: string; documentId?: string; documentVersion?: number }[];
      model?: { provider: string; name: string };
    },
  ) {
    this.getConversation(tenantId, conversationId);
    this.supersedePendingDrafts(tenantId, conversationId);
    const draft: ReplyDraft = {
      id: this.memory.newId('d'),
      tenantId,
      conversationId,
      status: input.status,
      reviewStatus: 'pending',
      reason: input.reason,
      content: input.content,
      citations: input.citations,
      model: input.model,
    };
    this.memory.drafts.push(draft);
    return draft;
  }

  updateDraft(tenantId: string, id: string, content: string) {
    const draft = this.memory.drafts.find(
      (d) => d.id === id && d.tenantId === tenantId,
    );
    if (!draft) throw new NotFoundException('Reply draft not found');
    draft.content = content;
    return draft;
  }

  claimDraftForSend(tenantId: string, id: string): ReplyDraft {
    const draft = this.memory.drafts.find(
      (d) => d.id === id && d.tenantId === tenantId,
    );
    if (!draft) throw new NotFoundException('Reply draft not found');
    if (draft.reviewStatus === 'sending') {
      throw new BadRequestException('草稿正在发送中，请勿重复操作');
    }
    if (draft.reviewStatus === 'accepted') {
      throw new BadRequestException('草稿已发送，请勿重复操作');
    }
    if (
      draft.reviewStatus !== 'pending' &&
      draft.reviewStatus !== 'send_failed'
    ) {
      throw new BadRequestException('草稿状态不可发送');
    }
    draft.reviewStatus = 'sending';
    draft.sendingStartedAt = new Date().toISOString();
    return draft;
  }

  releaseStaleSendingDrafts(olderThanIso: string) {
    const cutoff = Date.parse(olderThanIso);
    const released: { id: string; tenantId: string; conversationId: string }[] =
      [];
    for (const draft of this.memory.drafts) {
      if (draft.reviewStatus !== 'sending') continue;
      const started = Date.parse(draft.sendingStartedAt ?? '');
      if (!Number.isFinite(started) || started > cutoff) continue;
      draft.reviewStatus = 'send_failed';
      draft.sendingStartedAt = undefined;
      released.push({
        id: draft.id,
        tenantId: draft.tenantId,
        conversationId: draft.conversationId,
      });
    }
    return released;
  }

  reviewDraft(
    tenantId: string,
    id: string,
    reviewStatus: 'accepted' | 'rejected' | 'superseded' | 'send_failed',
  ) {
    const draft = this.memory.drafts.find(
      (d) => d.id === id && d.tenantId === tenantId,
    );
    if (!draft) throw new NotFoundException('Reply draft not found');
    draft.reviewStatus = reviewStatus;
    return draft;
  }

  createAuditLog(row: AuditLogRow) {
    this.memory.auditLogs.unshift(row);
    if (this.memory.auditLogs.length > 200) {
      this.memory.auditLogs.length = 200;
    }
  }

  listAuditLogs(tenantId: string, query: AuditLogQuery) {
    const from = query.from ? new Date(`${query.from}T00:00:00.000Z`).getTime() : undefined;
    const to = query.to ? new Date(`${query.to}T23:59:59.999Z`).getTime() : undefined;
    const q = query.q?.toLocaleLowerCase();
    const actor = query.actor?.toLocaleLowerCase();
    const filtered = this.memory.auditLogs
      .filter((row) => row.tenantId === tenantId)
      .map((row) => ({
        ...row,
        actorName: this.memory.accounts.find((account) => account.id === row.actorId)?.displayName ?? null,
      }))
      .filter((row) => {
        const time = new Date(row.createdAt).getTime();
        if (query.action && row.action !== query.action) return false;
        if (from !== undefined && time < from) return false;
        if (to !== undefined && time > to) return false;
        if (actor && !`${row.actorName ?? ''} ${row.actorId ?? ''}`.toLocaleLowerCase().includes(actor)) return false;
        if (q && !`${row.action} ${row.targetType} ${row.targetId ?? ''} ${row.actorName ?? ''} ${JSON.stringify(row.detail)}`.toLocaleLowerCase().includes(q)) return false;
        return true;
      });
    const start = (query.page - 1) * query.pageSize;
    return { items: filtered.slice(start, start + query.pageSize), total: filtered.length };
  }

  newId(prefix: string) {
    return this.memory.newId(prefix);
  }

  listKnowledge(
    tenantId: string,
    q?: string,
    categoryId?: string,
    knowledgeBaseId?: string,
    opts?: { limit?: number; offset?: number; status?: DocStatus },
  ) {
    let items = this.memory.knowledge.filter((d) => d.tenantId === tenantId && (!knowledgeBaseId || d.knowledgeBaseId === knowledgeBaseId));
    if (categoryId) items = items.filter((doc) => doc.categoryId === categoryId);
    if (opts?.status) items = items.filter((doc) => doc.status === opts.status);
    if (q?.trim()) {
      const keyword = q.trim().toLowerCase();
      items = items.filter(
        (d) =>
          d.title.toLowerCase().includes(keyword) ||
          d.excerpt.toLowerCase().includes(keyword) ||
          d.body.toLowerCase().includes(keyword),
      );
    }
    const total = items.length;
    const offset = Math.max(0, opts?.offset ?? 0);
    const limit =
      opts?.limit != null && Number.isFinite(opts.limit)
        ? Math.min(200, Math.max(1, Math.floor(opts.limit)))
        : undefined;
    if (limit != null) items = items.slice(offset, offset + limit);
    return {
      items: items.map((doc) => ({
        ...this.toKnowledgeListItem(doc),
        categoryName: this.memory.knowledgeCategories.find((item) => item.id === doc.categoryId)?.name ?? null,
      })),
      total,
    };
  }

  getKnowledge(tenantId: string, id: string): KnowledgeDoc {
    const doc = this.memory.knowledge.find(
      (d) => d.id === id && d.tenantId === tenantId,
    );
    if (!doc) throw new NotFoundException('Document not found');
    doc.version ??= 1;
    return doc;
  }

  createKnowledge(
    tenantId: string,
    input: {
      title: string;
      sourceType: 'faq' | 'markdown';
      body: string;
      categoryId?: string | null;
      knowledgeBaseId?: string;
      status?: DocStatus;
    },
  ) {
    const knowledgeBaseId = input.knowledgeBaseId ?? this.getDefaultKnowledgeBase(tenantId).id;
    if (!this.memory.knowledgeBases.some((base) => base.id === knowledgeBaseId && base.tenantId === tenantId)) {
      throw new BadRequestException('知识库不存在');
    }
    if (input.categoryId && !this.memory.knowledgeCategories.some((category) => category.id === input.categoryId && category.tenantId === tenantId && category.knowledgeBaseId === knowledgeBaseId)) {
      throw new BadRequestException('文件夹不属于当前知识库');
    }
    const doc: KnowledgeDoc = {
      id: this.memory.newId('k'),
      tenantId,
      knowledgeBaseId,
      categoryId: input.categoryId ?? null,
      title: input.title,
      sourceType: input.sourceType,
      status: input.status ?? 'draft',
      updatedAt: new Date().toISOString().slice(0, 10),
      excerpt: input.body.slice(0, 40) + (input.body.length > 40 ? '…' : ''),
      reviewNote: null,
      version: 1,
      body: input.body,
    };
    this.memory.knowledge.unshift(doc);
    return this.toKnowledgeListItem(doc);
  }

  publishKnowledge(tenantId: string, id: string) {
    const doc = this.getKnowledge(tenantId, id);
    doc.status = 'ready';
    doc.reviewNote = null;
    doc.updatedAt = new Date().toISOString().slice(0, 10);
    return this.toKnowledgeListItem(doc);
  }

  updateKnowledge(
    tenantId: string,
    id: string,
    input: {
      title: string;
      sourceType: 'faq' | 'markdown';
      body: string;
      categoryId?: string | null;
      knowledgeBaseId?: string;
      status?: DocStatus;
      reviewNote?: string | null;
    },
  ) {
    const doc = this.getKnowledge(tenantId, id);
    const knowledgeBaseId = input.knowledgeBaseId ?? doc.knowledgeBaseId ?? this.getDefaultKnowledgeBase(tenantId).id;
    if (!this.memory.knowledgeBases.some((base) => base.id === knowledgeBaseId && base.tenantId === tenantId)) {
      throw new BadRequestException('知识库不存在');
    }
    if (input.categoryId && !this.memory.knowledgeCategories.some((category) => category.id === input.categoryId && category.tenantId === tenantId && category.knowledgeBaseId === knowledgeBaseId)) {
      throw new BadRequestException('文件夹不属于当前知识库');
    }
    doc.title = input.title;
    doc.sourceType = input.sourceType;
    doc.body = input.body;
    doc.categoryId = input.categoryId ?? null;
    doc.knowledgeBaseId = knowledgeBaseId;
    doc.version = (doc.version ?? 1) + 1;
    doc.excerpt =
      input.body.slice(0, 40) + (input.body.length > 40 ? '…' : '');
    doc.status = input.status ?? 'draft';
    if (input.reviewNote !== undefined) doc.reviewNote = input.reviewNote;
    doc.updatedAt = new Date().toISOString().slice(0, 10);
    return this.toKnowledgeListItem(doc);
  }

  rejectKnowledge(tenantId: string, id: string, reviewNote?: string | null) {
    const doc = this.getKnowledge(tenantId, id);
    doc.status = 'rejected';
    doc.reviewNote = reviewNote?.trim() || null;
    doc.updatedAt = new Date().toISOString().slice(0, 10);
    return this.toKnowledgeListItem(doc);
  }

  archiveKnowledge(tenantId: string, id: string) {
    const doc = this.getKnowledge(tenantId, id);
    doc.status = 'archived';
    doc.updatedAt = new Date().toISOString().slice(0, 10);
    return this.toKnowledgeListItem(doc);
  }

  deleteKnowledge(tenantId: string, id: string) {
    const exists = this.memory.knowledge.some(
      (doc) => doc.id === id && doc.tenantId === tenantId,
    );
    if (!exists) throw new NotFoundException('Document not found');
    this.memory.knowledge = this.memory.knowledge.filter(
      (doc) => doc.id !== id || doc.tenantId !== tenantId,
    );
    this.memory.knowledgeChunks = this.memory.knowledgeChunks.filter(
      (chunk) => chunk.documentId !== id || chunk.tenantId !== tenantId,
    );
  }

  private toKnowledgeListItem(doc: KnowledgeDoc) {
    return {
      id: doc.id,
      title: doc.title,
      sourceType: doc.sourceType,
      status: doc.status,
      updatedAt: doc.updatedAt,
      excerpt: doc.excerpt,
      reviewNote: doc.reviewNote ?? null,
      version: doc.version ?? 1,
      knowledgeBaseId: doc.knowledgeBaseId,
      categoryId: doc.categoryId ?? null,
      categoryName: this.memory.knowledgeCategories.find((item) => item.id === doc.categoryId)?.name ?? null,
    };
  }

  listKnowledgeBases(tenantId: string) {
    return this.memory.knowledgeBases.filter((item) => item.tenantId === tenantId).map((base) => ({ ...base, documentCount: this.memory.knowledge.filter((doc) => doc.knowledgeBaseId === base.id).length, connectionCount: this.memory.wecomConnections.filter((conn) => conn.knowledgeBaseIds?.includes(base.id) || conn.knowledgeBaseId === base.id).length }));
  }

  getDefaultKnowledgeBase(tenantId: string) {
    const base = this.memory.knowledgeBases.find((item) => item.tenantId === tenantId && item.isDefault) ?? this.memory.knowledgeBases.find((item) => item.tenantId === tenantId);
    if (!base) throw new NotFoundException('Knowledge base not found');
    return base;
  }

  createKnowledgeBase(tenantId: string, name: string) {
    if (this.memory.knowledgeBases.some((item) => item.tenantId === tenantId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new BadRequestException('知识库名称已存在');
    const row = { id: this.memory.newId('kb'), tenantId, name, isDefault: !this.memory.knowledgeBases.some((item) => item.tenantId === tenantId) };
    this.memory.knowledgeBases.push(row);
    return row;
  }

  updateKnowledgeBase(tenantId: string, id: string, name: string) {
    const row = this.memory.knowledgeBases.find((item) => item.tenantId === tenantId && item.id === id);
    if (!row) throw new NotFoundException('Knowledge base not found');
    if (this.memory.knowledgeBases.some((item) => item.tenantId === tenantId && item.id !== id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new BadRequestException('知识库名称已存在');
    row.name = name;
    return row;
  }

  deleteKnowledgeBase(tenantId: string, id: string) {
    const row = this.memory.knowledgeBases.find((item) => item.tenantId === tenantId && item.id === id);
    if (!row) throw new NotFoundException('Knowledge base not found');
    if (row.isDefault) throw new BadRequestException('默认知识库不能删除');
    if (this.memory.wecomConnections.some((conn) => conn.tenantId === tenantId && (conn.knowledgeBaseIds?.includes(id) || conn.knowledgeBaseId === id))) throw new BadRequestException('该知识库仍绑定企业微信连接，请先解除绑定');
    const deletedDocumentIds = new Set(this.memory.knowledge.filter((doc) => doc.tenantId === tenantId && doc.knowledgeBaseId === id).map((doc) => doc.id));
    this.memory.knowledgeBases = this.memory.knowledgeBases.filter((item) => item.tenantId !== tenantId || item.id !== id);
    this.memory.knowledge = this.memory.knowledge.filter((doc) => doc.knowledgeBaseId !== id);
    this.memory.knowledgeChunks = this.memory.knowledgeChunks.filter((chunk) => !deletedDocumentIds.has(chunk.documentId));
    this.memory.knowledgeCategories = this.memory.knowledgeCategories.filter((item) => item.knowledgeBaseId !== id);
  }

  listKnowledgeCategories(tenantId: string, knowledgeBaseId: string) {
    return this.memory.knowledgeCategories
      .filter((item) => item.tenantId === tenantId && item.knowledgeBaseId === knowledgeBaseId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((item) => ({
        ...item,
        documentCount: this.memory.knowledge.filter((doc) => doc.categoryId === item.id).length,
      }));
  }

  recordKnowledgeGap(input: { tenantId: string; conversationId: string; customerMessageId: string; query: string; knowledgeBaseId?: string }) {
    const current = this.memory.knowledgeGaps.find((item) => item.customerMessageId === input.customerMessageId && item.tenantId === input.tenantId);
    const now = new Date().toISOString();
    if (current) {
      current.occurrences += 1;
      current.lastSeenAt = now;
      current.knowledgeBaseId ??= this.getDefaultKnowledgeBase(input.tenantId).id;
      return;
    }
    const conversation = this.getConversation(input.tenantId, input.conversationId);
    this.memory.knowledgeGaps.unshift({
      id: this.memory.newId('kg'), ...input,
      knowledgeBaseId: input.knowledgeBaseId ?? this.getDefaultKnowledgeBase(input.tenantId).id,
      status: 'open', occurrences: 1,
      firstSeenAt: now, lastSeenAt: now, contactName: conversation.contactName,
    });
  }

  listKnowledgeGaps(tenantId: string) {
    return this.memory.knowledgeGaps.filter((item) => item.tenantId === tenantId);
  }

  getKnowledgeGap(tenantId: string, id: string) {
    const row = this.memory.knowledgeGaps.find((item) => item.tenantId === tenantId && item.id === id);
    if (!row) throw new NotFoundException('Knowledge gap not found');
    return row;
  }

  updateKnowledgeGap(tenantId: string, id: string, status: KnowledgeGap['status']) {
    const row = this.memory.knowledgeGaps.find((item) => item.tenantId === tenantId && item.id === id);
    if (!row) throw new NotFoundException('Knowledge gap not found');
    row.status = status;
    return row;
  }

  readyKnowledgeForRetrieve(tenantId: string, knowledgeBaseSelection?: string | string[]) {
    const ids = knowledgeBaseSelection === undefined ? undefined : new Set(Array.isArray(knowledgeBaseSelection) ? knowledgeBaseSelection : [knowledgeBaseSelection]);
    return this.memory.knowledge
      .filter((d) => d.tenantId === tenantId && d.status === 'ready' && (!ids || ids.has(d.knowledgeBaseId ?? '')))
      .map((d) => ({
        id: d.id,
        title: d.title,
        excerpt: d.excerpt,
        body: d.body,
      }));
  }

  indexedKnowledgeDocumentIds(tenantId: string, knowledgeBaseSelection?: string | string[]) {
    const baseIds = knowledgeBaseSelection === undefined ? undefined : new Set(Array.isArray(knowledgeBaseSelection) ? knowledgeBaseSelection : [knowledgeBaseSelection]);
    const ids = new Set(this.memory.knowledge.filter((doc) => doc.tenantId === tenantId && (!baseIds || baseIds.has(doc.knowledgeBaseId ?? ''))).map((doc) => doc.id));
    return [
      ...new Set(
        this.memory.knowledgeChunks
          .filter((chunk) => chunk.tenantId === tenantId && ids.has(chunk.documentId))
          .map((chunk) => chunk.documentId),
      ),
    ];
  }

  replaceKnowledgeChunks(
    tenantId: string,
    documentId: string,
    chunks: {
      id: string;
      ordinal: number;
      title: string;
      content: string;
      embedding: number[];
    }[],
  ) {
    this.memory.knowledgeChunks = this.memory.knowledgeChunks.filter(
      (chunk) => chunk.documentId !== documentId || chunk.tenantId !== tenantId,
    );
    for (const row of chunks) {
      this.memory.knowledgeChunks.push({
        ...row,
        tenantId,
        documentId,
      });
    }
  }

  searchKnowledgeChunks(tenantId: string, knowledgeBaseIds: string[], queryEmbedding: number[], limit: number) {
    const documentIds = new Set(this.memory.knowledge
      .filter((doc) => doc.tenantId === tenantId && knowledgeBaseIds.includes(doc.knowledgeBaseId ?? '') && doc.status === 'ready')
      .map((doc) => doc.id));
    const titles = new Map(this.memory.knowledge.filter((doc) => documentIds.has(doc.id)).map((doc) => [doc.id, doc.title]));
    return this.memory.knowledgeChunks
      .filter((chunk) => chunk.tenantId === tenantId && documentIds.has(chunk.documentId) && chunk.embedding.length === queryEmbedding.length)
      .map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        title: titles.get(chunk.documentId) ?? '',
        content: chunk.content,
        vectorScore: cosine(queryEmbedding, chunk.embedding),
      }))
      .sort((a, b) => b.vectorScore - a.vectorScore)
      .slice(0, limit);
  }

  getKnowledgeIndexSettings(tenantId: string) {
    return (
      this.memory.knowledgeIndexSettings.get(tenantId) ?? {
        chunkSize: 480,
        chunkOverlap: 80,
        maxChunksPerDoc: 40,
      }
    );
  }

  saveKnowledgeIndexSettings(
    tenantId: string,
    input: {
      chunkSize: number;
      chunkOverlap: number;
      maxChunksPerDoc: number;
    },
  ) {
    this.memory.knowledgeIndexSettings.set(tenantId, { ...input });
    return { ...input };
  }

  listWecom(tenantId: string) {
    return {
      items: this.memory.wecomConnections
        .filter((c) => c.tenantId === tenantId)
        .map((c) => this.toWecomListItem(c)),
    };
  }

  createWecom(
    tenantId: string,
    input: {
      channelType?: 'wecom' | 'wecom_mock' | 'wechat_kf';
      displayName?: string;
      capability?: WecomCapability;
      corpId?: string;
      agentId?: string;
      externalAccountId?: string;
      knowledgeBaseId?: string;
      knowledgeBaseIds?: string[];
      config?: Record<string, unknown>;
    },
  ): WecomConnection {
    const channelType = input.channelType ?? 'wecom_mock';
    const mock = channelType === 'wecom_mock';
    const knowledgeBaseIds = [...new Set(input.knowledgeBaseIds?.length ? input.knowledgeBaseIds : input.knowledgeBaseId ? [input.knowledgeBaseId] : [this.getDefaultKnowledgeBase(tenantId).id])];
    if (knowledgeBaseIds.some((id) => !this.memory.knowledgeBases.some((base) => base.id === id && base.tenantId === tenantId))) {
      throw new BadRequestException('知识库不存在');
    }
    const connection: WecomConnection = {
      id: this.memory.newId('conn'),
      tenantId,
      displayName: input.displayName ?? (mock ? '开发模拟连接' : '企业微信连接'),
      channelType,
      capability: input.capability ?? (channelType === 'wechat_kf' ? 'wechat_kf' : 'internal_app'),
      status: mock ? 'connected' : 'pending_auth',
      knowledgeBaseId: knowledgeBaseIds[0] ?? null,
      knowledgeBaseIds,
      lastEventAt: null,
    };
    this.memory.wecomConnections.unshift(connection);
    this.memory.wecomExtras.set(connection.id, {
      corpId: input.corpId ?? null,
      agentId: input.agentId ?? null,
      externalAccountId: input.externalAccountId ?? null,
      config: input.config ?? null,
    });
    return this.toWecomListItem(connection);
  }

  disableWecom(tenantId: string, id: string): WecomConnection {
    const connection = this.memory.wecomConnections.find(
      (c) => c.id === id && c.tenantId === tenantId,
    );
    if (!connection) throw new NotFoundException('WeCom connection not found');
    connection.status = 'disabled';
    return this.toWecomListItem(connection);
  }

  updateWecom(
    tenantId: string,
    id: string,
    input: {
      displayName?: string;
      capability?: WecomCapability;
      corpId?: string | null;
      agentId?: string | null;
      externalAccountId?: string | null;
      config?: Record<string, unknown> | null;
      status?: WecomStatus;
      errorMessage?: string | null;
      knowledgeBaseId?: string | null;
      knowledgeBaseIds?: string[];
    },
  ): WecomConnection {
    const connection = this.memory.wecomConnections.find(
      (c) => c.id === id && c.tenantId === tenantId,
    );
    if (!connection) throw new NotFoundException('WeCom connection not found');
    const knowledgeBaseIds = input.knowledgeBaseIds === undefined ? undefined : [...new Set(input.knowledgeBaseIds)];
    if (knowledgeBaseIds?.some((baseId) => !this.memory.knowledgeBases.some((base) => base.id === baseId && base.tenantId === tenantId))) {
      throw new BadRequestException('知识库不存在');
    }
    if (input.displayName !== undefined) connection.displayName = input.displayName;
    if (input.capability !== undefined) connection.capability = input.capability;
    if (input.status !== undefined) connection.status = input.status;
    if (input.knowledgeBaseId !== undefined) {
      connection.knowledgeBaseId = input.knowledgeBaseId;
      if (knowledgeBaseIds === undefined) connection.knowledgeBaseIds = input.knowledgeBaseId ? [input.knowledgeBaseId] : [];
    }
    if (knowledgeBaseIds !== undefined) {
      connection.knowledgeBaseIds = knowledgeBaseIds;
      connection.knowledgeBaseId = knowledgeBaseIds[0] ?? null;
    }
    if (input.errorMessage !== undefined) {
      connection.errorMessage = input.errorMessage ?? undefined;
    }
    const extras = this.memory.wecomExtras.get(id) ?? {
      corpId: null,
      agentId: null,
      externalAccountId: null,
      config: null,
    };
    if (input.corpId !== undefined) extras.corpId = input.corpId;
    if (input.agentId !== undefined) extras.agentId = input.agentId;
    if (input.externalAccountId !== undefined) extras.externalAccountId = input.externalAccountId;
    if (input.config !== undefined) extras.config = input.config;
    this.memory.wecomExtras.set(id, extras);
    return this.toWecomListItem(connection);
  }

  deleteWecom(tenantId: string, id: string): void {
    const index = this.memory.wecomConnections.findIndex(
      (c) => c.id === id && c.tenantId === tenantId,
    );
    if (index < 0) throw new NotFoundException('WeCom connection not found');
    if (id === DEMO_CONNECTION_ID) {
      throw new BadRequestException('演示用模拟连接不可取消');
    }
    for (const conversation of this.memory.conversations) {
      if (conversation.tenantId === tenantId && conversation.connectionId === id) {
        conversation.connectionId = '';
      }
    }
    this.memory.wecomConnections.splice(index, 1);
    this.memory.wecomExtras.delete(id);
  }

  getWecomSnapshot(connectionId: string) {
    const connection = this.memory.wecomConnections.find((c) => c.id === connectionId);
    if (!connection) throw new NotFoundException('WeCom connection not found');
    const extras = this.memory.wecomExtras.get(connectionId);
    return {
      id: connection.id,
      tenantId: connection.tenantId,
      channelType: connection.channelType,
      capability: connection.capability,
      status: connection.status,
      displayName: connection.displayName,
      corpId: extras?.corpId ?? null,
      agentId: extras?.agentId ?? null,
      externalAccountId: extras?.externalAccountId ?? null,
      knowledgeBaseId: connection.knowledgeBaseId ?? null,
      knowledgeBaseIds: connection.knowledgeBaseIds ?? (connection.knowledgeBaseId ? [connection.knowledgeBaseId] : []),
      config: extras?.config ?? null,
      errorMessage: connection.errorMessage ?? null,
    };
  }

  private toWecomListItem(connection: WecomConnection): WecomConnection {
    const extras = this.memory.wecomExtras.get(connection.id);
    return {
      ...connection,
      corpId: extras?.corpId ?? null,
      agentId: extras?.agentId ?? null,
      externalAccountId: extras?.externalAccountId ?? null,
      knowledgeBaseIds: connection.knowledgeBaseIds ?? (connection.knowledgeBaseId ? [connection.knowledgeBaseId] : []),
    };
  }

  ingestNormalizedMessage(msg: NormalizedIncomingMessage) {
    if (!msg.content?.trim()) throw new BadRequestException('消息内容为空');
    const connection = this.memory.wecomConnections.find(
      (c) => c.id === msg.connectionId && c.tenantId === msg.tenantId,
    );
    if (!connection) throw new NotFoundException('WeCom connection not found');
    if (connection.status === 'disabled') {
      throw new BadRequestException('连接已停用');
    }
    const duplicate = this.memory.messages.find(
      (m) =>
        m.tenantId === msg.tenantId &&
        m.externalMessageId === msg.externalMessageId &&
        this.memory.conversations.some(
          (c) => c.id === m.conversationId && c.connectionId === msg.connectionId,
        ),
    );
    if (duplicate) {
      return {
        duplicated: true,
        conversationId: duplicate.conversationId,
        message: {
          id: duplicate.id,
          conversationId: duplicate.conversationId,
          sender: duplicate.sender,
          content: duplicate.content,
          createdAt: duplicate.createdAt,
        },
      };
    }

    let conversation =
      this.memory.conversations.find(
        (c) =>
          c.tenantId === msg.tenantId &&
          c.connectionId === msg.connectionId &&
          c.externalConversationId === msg.externalConversationId &&
          c.status !== 'closed',
      ) ??
      this.memory.conversations.find(
        (c) =>
          c.tenantId === msg.tenantId &&
          c.connectionId === msg.connectionId &&
          c.externalConversationId === msg.externalConversationId,
      ) ??
      this.memory.conversations.find(
        (c) =>
          c.tenantId === msg.tenantId &&
          c.connectionId === msg.connectionId &&
          c.contactName === msg.contactName &&
          c.status !== 'closed',
      );
    const clock = this.memory.nowClock();
    const occurredAtMs = Date.parse(msg.occurredAt);
    const externalUserId = msg.externalConversationId;
    let externalContact = this.memory.externalContacts.find(
      (contact) => contact.tenantId === msg.tenantId && contact.connectionId === msg.connectionId && contact.externalUserId === externalUserId,
    );
    if (!externalContact) {
      const tenant = this.getTenant(msg.tenantId);
      externalContact = {
        id: this.memory.newId('contact'), tenantId: msg.tenantId, connectionId: msg.connectionId,
        externalUserId, displayName: msg.contactName, source: connection.capability,
        policy: tenant?.defaultContactPolicy ?? 'ai', policyUpdatedAt: new Date().toISOString(),
        conversationCount: 0, lastMessageAt: clock,
      };
      this.memory.externalContacts.push(externalContact);
    } else {
      externalContact.displayName = msg.contactName;
    }
    if (!externalContact) throw new NotFoundException('External contact not found');
    const wantHuman =
      msg.senderType === 'customer' &&
      evaluateReplyPolicy([msg.content]).needsHuman;
    if (!conversation) {
      conversation = {
        id: this.memory.newId('c'),
        tenantId: msg.tenantId,
        connectionId: msg.connectionId,
        externalConversationId: msg.externalConversationId,
        externalContactId: externalContact.id,
        contactName: msg.contactName,
        contactMeta: msg.contactMeta ?? '外部联系人',
        preview: msg.content,
        status: statusAfterCustomerInbound('open', { requestHuman: wantHuman }),
        handlingMode: wantHuman ? 'human' : 'ai',
        contactPolicy: externalContact.policy,
        assignee: null,
        updatedAt: clock,
        unread: true,
      };
      this.memory.conversations.unshift(conversation);
      this.memory.messages.push({
        id: this.memory.newId('m'),
        tenantId: msg.tenantId,
        conversationId: conversation.id,
        sender: 'system',
        content:
          msg.channelType === 'wecom_mock'
            ? '会话已接入 · 企业微信模拟连接'
            : '会话已接入 · 企业微信',
        createdAt: clock,
      });
    } else {
      conversation.externalContactId = externalContact.id;
      conversation.contactPolicy = externalContact.policy;
      conversation.contactPolicyReason = externalContact.policyReason;
      conversation.contactPolicyActorId = externalContact.policyActorId;
      conversation.contactPolicyUpdatedAt = externalContact.policyUpdatedAt;
      if (!conversation.externalConversationId) {
        conversation.externalConversationId = msg.externalConversationId;
      }
      if (msg.senderType === 'customer') {
        conversation.status = statusAfterCustomerInbound(conversation.status, {
          requestHuman: wantHuman,
        });
        if (wantHuman) conversation.handlingMode = 'human';
      } else if (msg.senderType === 'agent') {
        conversation.status = statusAfterAgentReply(conversation.status);
        conversation.handlingMode = 'human';
      }
    }
    const message = {
      id: this.memory.newId('m'),
      tenantId: msg.tenantId,
      conversationId: conversation.id,
      externalMessageId: msg.externalMessageId,
      sender: msg.senderType,
      content: msg.content,
      createdAt: clock,
      createdAtMs: Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now(),
    };
    this.memory.messages.push(message);
    conversation.preview = msg.content;
    if (msg.senderType === 'customer') conversation.unread = true;
    if (msg.senderType === 'agent') conversation.unread = false;
    conversation.updatedAt = clock;
    externalContact.lastMessageAt = clock;
    externalContact.conversationCount = this.memory.conversations.filter((item) => item.externalContactId === externalContact!.id && item.tenantId === msg.tenantId).length;
    connection.lastEventAt = `今天 ${clock}`;
    return {
      duplicated: false,
      conversationId: conversation.id,
      message: {
        id: message.id,
        conversationId: conversation.id,
        sender: message.sender,
        content: message.content,
        createdAt: message.createdAt,
      },
    };
  }

  enqueueAutoDraftJob(_input: { id: string; tenantId: string; conversationId: string; customerMessageId: string }) { return false; }

  claimAutoDraftJobs(_limit: number, _leaseMs: number) { return []; }

  completeAutoDraftJob(_id: string, _attemptId: string) {}

  retryAutoDraftJob(_id: string, _attemptId: string, _attempts: number, _error: string) {}

  listDeadAutoDraftJobs(_tenantId: string, _limit: number) { return []; }

  requeueDeadAutoDraftJob(_tenantId: string, _id: string) { return false; }

  autoDraftJobMetrics(_tenantId: string) {
    return {
      queued: 0,
      running: 0,
      dead: 0,
      retrying: 0,
      oldestQueuedAt: null,
      oldestWaitingSeconds: 0,
      failedLast24Hours: 0,
      completedLast24Hours: 0,
      attemptsLast24Hours: 0,
      failureRateLast24Hours: 0,
    };
  }

  prepareOutboundReply(
    tenantId: string,
    conversationId: string,
    content: string,
    autoSendGuard?: Message['autoSendGuard'],
  ) {
    const conversation = this.memory.conversations.find(
      (c) => c.id === conversationId && c.tenantId === tenantId,
    );
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (autoSendGuard) {
      const previousAttempt = [...this.memory.messages].reverse().find(
        (message) =>
          message.tenantId === tenantId &&
          message.conversationId === conversationId &&
          message.sender === 'agent' &&
          message.autoSendGuard?.draftId === autoSendGuard.draftId,
      );
      if (previousAttempt && previousAttempt.deliveryStatus !== 'queued') {
        throw new BadRequestException(
          previousAttempt.deliveryStatus === 'unknown'
            ? '此前发送结果不确定，请先核实渠道记录，系统不会自动重发'
            : '该草稿已有出站记录，不能再次自动发送',
        );
      }
    }
    const reusable = [...this.memory.messages]
      .reverse()
      .find(
        (m) =>
          m.tenantId === tenantId &&
          m.conversationId === conversationId &&
          m.sender === 'agent' &&
          m.content === content &&
          (m.deliveryStatus === 'queued' || m.deliveryStatus === 'dispatching'),
      );
    if (reusable?.deliveryStatus === 'dispatching') {
      throw new BadRequestException('相同回复正在发送中');
    }
    if (reusable?.deliveryStatus === 'queued') {
      return {
        messageId: reusable.id,
        idempotencyKey: reusable.externalMessageId ?? reusable.id,
        connectionId: conversation.connectionId || null,
        externalConversationId: conversation.externalConversationId,
        autoSendGuard: reusable.autoSendGuard,
        message: {
          id: reusable.id,
          tenantId: reusable.tenantId,
          conversationId: reusable.conversationId,
          sender: 'agent' as const,
          content: reusable.content,
          createdAt: reusable.createdAt,
          deliveryStatus: reusable.deliveryStatus,
        },
      };
    }
    const idempotencyKey = this.memory.newId('ext');
    const message = {
      id: this.memory.newId('m'),
      tenantId,
      conversationId,
      externalMessageId: idempotencyKey,
      sender: 'agent' as const,
      content,
      createdAt: this.memory.nowClock(),
      createdAtMs: Date.now(),
      deliveryStatus: 'queued',
      outboxAt: new Date().toISOString(),
      autoSendGuard,
    };
    this.memory.messages.push(message);
    conversation.preview = content;
    conversation.unread = false;
    conversation.status = statusAfterAgentReply(conversation.status);
    conversation.updatedAt = message.createdAt;
    const connection = this.memory.wecomConnections.find(
      (c) => c.id === conversation.connectionId,
    );
    if (connection) connection.lastEventAt = `今天 ${conversation.updatedAt}`;
    return {
      messageId: message.id,
      idempotencyKey,
      connectionId: conversation.connectionId || null,
      externalConversationId: conversation.externalConversationId,
      autoSendGuard,
      message,
    };
  }

  markOutboundDispatching(messageId: string) {
    const message = this.memory.messages.find((m) => m.id === messageId);
    if (!message) throw new NotFoundException('Message not found');
    if (message.deliveryStatus !== 'queued') return false;
    message.deliveryStatus = 'dispatching';
    message.outboxAt = new Date().toISOString();
    return true;
  }

  listQueuedOutbound(olderThanIso: string) {
    const cutoff = Date.parse(olderThanIso);
    return this.memory.messages
      .filter((m) => {
        if (m.deliveryStatus !== 'queued' || m.sender !== 'agent') return false;
        const at = Date.parse(m.outboxAt ?? '');
        return Number.isFinite(at) && at <= cutoff;
      })
      .map((m) => {
        const conversation = this.memory.conversations.find(
          (c) => c.id === m.conversationId,
        );
        return {
          messageId: m.id,
          tenantId: m.tenantId,
          conversationId: m.conversationId,
          content: m.content,
          idempotencyKey: m.externalMessageId ?? m.id,
          connectionId: conversation?.connectionId || null,
          externalConversationId: conversation?.externalConversationId,
          autoSendGuard: m.autoSendGuard,
        };
      });
  }

  failStaleDispatching(olderThanIso: string) {
    const cutoff = Date.parse(olderThanIso);
    const failed: { messageId: string; tenantId: string; conversationId: string }[] =
      [];
    for (const message of this.memory.messages) {
      if (message.deliveryStatus !== 'dispatching') continue;
      const at = Date.parse(message.outboxAt ?? '');
      if (!Number.isFinite(at) || at > cutoff) continue;
      message.deliveryStatus = 'unknown';
      failed.push({
        messageId: message.id,
        tenantId: message.tenantId,
        conversationId: message.conversationId,
      });
    }
    return failed;
  }

  finalizeOutboundReply(
    messageId: string,
    result: { status: string; externalMessageId?: string },
  ) {
    const message = this.memory.messages.find((m) => m.id === messageId);
    if (!message) throw new NotFoundException('Message not found');
    message.deliveryStatus = result.status;
    if (result.externalMessageId) message.externalMessageId = result.externalMessageId;
    if (result.status === 'superseded' && message.autoSendGuard) {
      const draft = this.memory.drafts.find(
        (item) => item.id === message.autoSendGuard?.draftId && item.tenantId === message.tenantId,
      );
      if (draft?.reviewStatus === 'sending') draft.reviewStatus = 'superseded';
    }
    return {
      id: message.id,
      tenantId: message.tenantId,
      conversationId: message.conversationId,
      sender: 'agent' as const,
      content: message.content,
      createdAt: message.createdAt,
      deliveryStatus: message.deliveryStatus,
    };
  }

  supportAnalytics(tenantId: string, period: AnalyticsPeriod = 'day') {
    const tenantMessages = this.memory.messages.filter(
      (m) => m.tenantId === tenantId,
    );
    const earliestByConv = new Map<string, Date>();
    for (const msg of tenantMessages) {
      const at = parseDemoInstant(msg.createdAt);
      const prev = earliestByConv.get(msg.conversationId);
      if (!prev || at.getTime() < prev.getTime()) {
        earliestByConv.set(msg.conversationId, at);
      }
    }

    const conversations = this.memory.conversations
      .filter((c) => c.tenantId === tenantId)
      .map((c) => {
        const updatedAt = parseDemoInstant(c.updatedAt);
        const createdAt = earliestByConv.get(c.id) ?? updatedAt;
        return {
          id: c.id,
          status: c.status,
          unread: c.unread,
          createdAt,
          updatedAt,
        };
      });
    const messages = tenantMessages.map((m) => ({
      conversationId: m.conversationId,
      senderType: m.sender,
      createdAt: parseDemoInstant(m.createdAt),
    }));
    const drafts = this.memory.drafts
      .filter((d) => d.tenantId === tenantId)
      .map((d) => {
        const convUpdated =
          conversations.find((c) => c.id === d.conversationId)?.updatedAt ??
          new Date();
        return {
          reviewStatus: d.reviewStatus,
          citations: d.citations,
          createdAt: convUpdated,
        };
      });

    return buildSupportAnalytics({
      period,
      conversations,
      messages,
      drafts,
      notes:
        '演示数据按时段聚合；实时队列为当前快照，趋势与对比基于内存会话/消息。',
    });
  }

  listAiProviders(tenantId: string): AiProviderRecord[] {
    return this.memory.aiProviders
      .filter((row) => row.tenantId === tenantId)
      .map(({ tenantId: _t, ...rest }) => rest);
  }

  upsertAiProvider(tenantId: string, row: AiProviderRecord) {
    const items = this.memory.aiProviders;
    const index = items.findIndex((item) => item.id === row.id && item.tenantId === tenantId);
    const next = { ...row, tenantId };
    if (index >= 0) items[index] = next;
    else items.unshift(next);
  }

  activateAiProvider(tenantId: string, id: string) {
    const items = this.memory.aiProviders.filter((row) => row.tenantId === tenantId);
    if (!items.some((item) => item.id === id)) {
      throw new NotFoundException('模型配置不存在');
    }
    for (const item of items) item.active = item.id === id;
  }

  deleteAiProvider(tenantId: string, id: string) {
    const current = this.memory.aiProviders.find(
      (row) => row.id === id && row.tenantId === tenantId,
    );
    if (!current) throw new NotFoundException('模型配置不存在');
    this.memory.aiProviders = this.memory.aiProviders.filter(
      (row) => !(row.id === id && row.tenantId === tenantId),
    );
    if (current.active) {
      const next = this.memory.aiProviders.find((row) => row.tenantId === tenantId);
      if (next) next.active = true;
    }
  }

  findAccountByEmail(email: string): AuthAccount | null {
    const account = this.memory.accounts.find(
      (row) => row.email.toLowerCase() === email.toLowerCase(),
    );
    if (!account?.passwordHash) return null;
    const memberships = this.listMemberships(account.id);
    const current = memberships[0];
    if (!current) return null;
    return {
      passwordHash: account.passwordHash,
      tenant: current.tenant,
      memberships,
      user: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        role: current.role,
        tenantId: current.tenant.id,
      },
    };
  }

  listMemberships(userId: string): TenantMembership[] {
    return this.memory.members
      .filter((row) => row.userId === userId && row.status === 'active')
      .map((row) => ({
        role: row.role,
        tenant: { ...this.memory.tenant },
      }))
      .filter((row) => row.tenant.id === DEMO_TENANT.id);
  }

  listTenantMembers(tenantId: string): TenantMemberRow[] {
    return this.memory.members
      .filter((row) => row.tenantId === tenantId && row.status === 'active')
      .map((row) => {
        const account = this.memory.accounts.find((item) => item.id === row.userId);
        return {
          userId: row.userId,
          email: account?.email ?? '',
          displayName: account?.displayName ?? row.userId,
          role: row.role,
          status: row.status,
        };
      });
  }

  inviteTenantMember(
    tenantId: string,
    input: {
      email: string;
      displayName: string;
      role: string;
      passwordHash: string;
    },
  ): TenantMemberRow {
    if (tenantId !== DEMO_TENANT.id) {
      throw new NotFoundException('Tenant not found');
    }
    const email = input.email.trim().toLowerCase();
    let account = this.memory.accounts.find(
      (row) => row.email.toLowerCase() === email,
    );
    if (!account) {
      account = {
        id: this.memory.newId('user'),
        email,
        displayName: input.displayName.trim() || email,
        passwordHash: input.passwordHash,
      };
      this.memory.accounts.push(account);
    }
    const existing = this.memory.members.find(
      (row) => row.tenantId === tenantId && row.userId === account!.id,
    );
    if (existing && existing.status === 'active') {
      throw new BadRequestException('该成员已在当前工作区中');
    }
    if (existing) {
      existing.status = 'active';
      existing.role = input.role;
    } else {
      this.memory.members.push({
        tenantId,
        userId: account.id,
        role: input.role,
        status: 'active',
      });
    }
    return {
      userId: account.id,
      email: account.email,
      displayName: account.displayName,
      role: input.role,
      status: 'active',
    };
  }

  updateTenantMemberRole(
    tenantId: string,
    userId: string,
    role: string,
  ): TenantMemberRow {
    const member = this.memory.members.find(
      (row) =>
        row.tenantId === tenantId &&
        row.userId === userId &&
        row.status === 'active',
    );
    if (!member) throw new NotFoundException('成员不存在');
    if (member.role === 'admin' && role !== 'admin') {
      const admins = this.memory.members.filter(
        (row) =>
          row.tenantId === tenantId &&
          row.status === 'active' &&
          row.role === 'admin',
      );
      if (admins.length <= 1) {
        throw new BadRequestException('至少保留一名管理员');
      }
    }
    member.role = role;
    const account = this.memory.accounts.find((row) => row.id === userId);
    return {
      userId,
      email: account?.email ?? '',
      displayName: account?.displayName ?? userId,
      role,
      status: member.status,
    };
  }

  getTenant(tenantId: string): Tenant | null {
    if (this.memory.tenant.id !== tenantId) return null;
    return {
      ...this.memory.tenant,
    };
  }

  setTenantAutoSendEnabled(tenantId: string, enabled: boolean): Tenant {
    return this.setTenantAutoSendSetting(tenantId, { enabled });
  }

  setTenantAutoSendSetting(
    tenantId: string,
    input: {
      enabled?: boolean;
      windowStart?: string | null;
      windowEnd?: string | null;
      timezone?: string | null;
    },
  ): Tenant {
    if (this.memory.tenant.id !== tenantId) throw new NotFoundException('Tenant not found');
    if (input.enabled !== undefined) this.memory.tenant.autoSendEnabled = input.enabled;
    if (input.windowStart !== undefined) {
      this.memory.tenant.autoSendWindowStart = input.windowStart;
    }
    if (input.windowEnd !== undefined) {
      this.memory.tenant.autoSendWindowEnd = input.windowEnd;
    }
    if (input.timezone !== undefined) {
      this.memory.tenant.autoSendTimezone =
        input.timezone?.trim() || 'Asia/Shanghai';
    }
    return { ...this.memory.tenant };
  }

  setTenantAiReplyStyle(
    tenantId: string,
    input: {
      tone?: string;
      persona?: string;
      systemPrompt?: string;
      maxLength?: number;
    },
  ): Tenant {
    if (this.memory.tenant.id !== tenantId) throw new NotFoundException('Tenant not found');
    if (input.tone !== undefined) {
      this.memory.tenant.aiTone =
        input.tone === 'warm' || input.tone === 'formal' ? input.tone : 'direct';
    }
    if (input.persona !== undefined) {
      this.memory.tenant.aiPersona = input.persona.trim().slice(0, 120);
    }
    if (input.systemPrompt !== undefined) {
      this.memory.tenant.aiSystemPrompt = input.systemPrompt.trim().slice(0, 4000);
    }
    if (input.maxLength !== undefined) {
      const n = Math.floor(Number(input.maxLength));
      this.memory.tenant.aiMaxLength = Number.isFinite(n)
        ? Math.min(2000, Math.max(50, n))
        : 500;
    }
    return { ...this.memory.tenant };
  }

  ensureUserPasswordHash(userId: string, passwordHash: string) {
    const account = this.memory.accounts.find((row) => row.id === userId);
    if (!account) return;
    if (!account.passwordHash) account.passwordHash = passwordHash;
  }

  ensureDemoCustomer(passwordHash: string) {
    const demos = [DEMO_AGENT, ...DEMO_CUSTOMERS];
    for (const account of demos) {
      if (!this.memory.accounts.some((row) => row.id === account.id)) {
        this.memory.accounts.push({
          id: account.id,
          email: account.email,
          displayName: account.displayName,
          passwordHash,
        });
      } else {
        this.ensureUserPasswordHash(account.id, passwordHash);
        const member = this.memory.members.find(
          (row) =>
            row.userId === account.id && row.tenantId === DEMO_TENANT.id,
        );
        if (member) member.role = account.role;
      }
      if (
        !this.memory.members.some(
          (row) =>
            row.userId === account.id && row.tenantId === DEMO_TENANT.id,
        )
      ) {
        this.memory.members.push({
          tenantId: DEMO_TENANT.id,
          userId: account.id,
          role: account.role,
          status: 'active',
        });
      }
    }
    if (
      !this.memory.wecomConnections.some((row) => row.id === DEMO_CONNECTION_ID)
    ) {
      const mock = createSeedWecomConnections().find(
        (item) => item.id === DEMO_CONNECTION_ID,
      );
      if (mock) this.memory.wecomConnections.unshift(mock);
    }
  }
}
