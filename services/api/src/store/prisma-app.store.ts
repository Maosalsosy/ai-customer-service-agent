import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { NormalizedIncomingMessage } from '../wecom/adapter/types.js';
import {
  createSeedConversations,
  createSeedDrafts,
  createSeedKnowledge,
  createSeedMessages,
  createSeedWecomConnections,
  DEMO_AGENT,
  DEMO_CONNECTION_ID,
  DEMO_CUSTOMERS,
  DEMO_TENANT,
  DEMO_PASSWORD_HASH,
  DEMO_USER,
} from './seed.js';
import { chunkText, embedText } from '../knowledge/embed.js';
import {
  statusAfterAgentReply,
  statusAfterCustomerInbound,
} from '../common/conversation-status.js';
import { evaluateReplyPolicy } from '../common/reply-policy.js';
import type { AnalyticsPeriod } from '../analytics/analytics-range.js';
import { resolveAnalyticsRange } from '../analytics/analytics-range.js';
import { buildSupportAnalytics } from '../analytics/build-support-analytics.js';
import { hashPassword } from '../auth/password.js';
import { isDemoSeedEnabled } from '../common/runtime-mode.js';
import type {
  AiProviderRecord,
  AppStore,
  AuditLogQuery,
  AuthAccount,
  TenantMemberRow,
  TenantMembership,
  KnowledgeVectorHit,
} from './app-store.js';
import type { Tenant } from './types.js';
import type {
  AutoSendGuard,
  ContactPolicy,
  ExternalContact,
  ConversationStatus,
  DocStatus,
  ReplyDraft,
  WecomCapability,
  WecomConnection,
  WecomStatus,
  KnowledgeCategory,
  KnowledgeGap,
} from './types.js';

function clock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function toPgVector(values: number[]): string {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error('embedding vector must contain finite values');
  }
  return `[${values.join(',')}]`;
}

@Injectable()
export class PrismaAppStore implements AppStore, OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.prisma.$connect();
    if (!isDemoSeedEnabled()) {
      await this.ensureProductionBootstrap();
      return;
    }
    await this.seedIfEmpty();
    await this.indexReadyDemoKnowledge();
  }

  private async ensureProductionBootstrap() {
    const mockConnections = await this.prisma.wecomConnection.count({
      where: { channelType: 'wecom_mock' },
    });
    if (mockConnections > 0) {
      throw new Error(
        'Production database contains simulated WeCom connections. Remove them before startup.',
      );
    }

    const demoTenant = await this.prisma.tenant.findUnique({
      where: { id: DEMO_TENANT.id },
      select: { id: true },
    });
    if (demoTenant) {
      throw new Error(
        'Demo tenant data exists while demo seeding is disabled. Review or migrate that database before production startup.',
      );
    }

    if ((await this.prisma.tenant.count()) > 0) return;

    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12) {
      throw new Error(
        'An empty production database requires BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (at least 12 characters)',
      );
    }

    const tenantId = newId('tenant');
    const userId = newId('user');
    const tenantName = process.env.BOOTSTRAP_TENANT_NAME?.trim() || '工作区';
    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.create({
        data: {
          id: tenantId,
          name: tenantName,
          slug: newId('workspace'),
          autoSendEnabled: false,
        },
      });
      const defaultBaseId = newId('kb');
      await tx.knowledgeBase.create({ data: { id: defaultBaseId, tenantId, name: '项目知识库', isDefault: true } });
      await tx.user.create({
        data: {
          id: userId,
          email,
          displayName: email.split('@')[0].slice(0, 120),
          passwordHash: hashPassword(password),
        },
      });
      await tx.tenantMember.create({
        data: { tenantId, userId, role: 'admin' },
      });
    });
  }

  /** 为已发布演示文档建立本地哈希向量分块，便于首问即可检索引用。 */
  private async indexReadyDemoKnowledge() {
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { tenantId: DEMO_TENANT.id, status: 'ready' },
    });
    for (const doc of docs) {
      const existing = await this.prisma.knowledgeChunk.count({
        where: { documentId: doc.id, tenantId: DEMO_TENANT.id },
      });
      if (existing > 0) continue;
      const parts = chunkText(doc.body);
      if (!parts.length) continue;
      await this.replaceKnowledgeChunks(DEMO_TENANT.id, doc.id, parts.map((content, ordinal) => ({
        id: newId('kc'),
        ordinal,
        title: doc.title,
        content,
        embedding: embedText(`${doc.title}\n${content}`),
      })));
    }
  }

  private async seedIfEmpty() {
    const count = await this.prisma.tenant.count();
    if (count > 0) return;

    await this.prisma.tenant.create({
      data: {
        id: DEMO_TENANT.id,
        name: DEMO_TENANT.name,
        slug: DEMO_TENANT.slug,
        autoSendEnabled: true,
      },
    });
    const defaultBase = await this.prisma.knowledgeBase.create({ data: { id: `kb-${DEMO_TENANT.id}`, tenantId: DEMO_TENANT.id, name: '项目知识库', isDefault: true } });
    await this.prisma.user.create({
      data: {
        id: DEMO_USER.id,
        email: DEMO_USER.email,
        displayName: DEMO_USER.displayName,
        passwordHash: DEMO_PASSWORD_HASH,
      },
    });
    await this.prisma.tenantMember.create({
      data: {
        tenantId: DEMO_TENANT.id,
        userId: DEMO_USER.id,
        role: DEMO_USER.role,
      },
    });
    for (const account of [DEMO_AGENT, ...DEMO_CUSTOMERS]) {
      await this.prisma.user.create({
        data: {
          id: account.id,
          email: account.email,
          displayName: account.displayName,
          passwordHash: DEMO_PASSWORD_HASH,
        },
      });
      await this.prisma.tenantMember.create({
        data: {
          tenantId: DEMO_TENANT.id,
          userId: account.id,
          role: account.role,
        },
      });
    }

    for (const conn of createSeedWecomConnections()) {
      await this.prisma.wecomConnection.create({
        data: {
          id: conn.id,
          tenantId: conn.tenantId,
          knowledgeBaseId: `kb-${DEMO_TENANT.id}`,
          channelType: conn.channelType,
          capability: conn.capability,
          displayName: conn.displayName,
          status: conn.status,
          corpId: conn.corpId ?? null,
          agentId: conn.agentId ?? null,
          errorMessage: conn.errorMessage,
          lastEventAt: conn.lastEventAt ? new Date() : null,
        },
      });
    }

    for (const c of createSeedConversations()) {
      const assignee =
        c.assignee === DEMO_USER.displayName ? DEMO_USER.id : null;
      await this.prisma.conversation.create({
        data: {
          id: c.id,
          tenantId: c.tenantId,
          connectionId: c.connectionId,
          contactName: c.contactName,
          contactMeta: c.contactMeta,
          preview: c.preview,
          status: c.status,
          handlingMode: c.handlingMode,
          contactPolicy: c.contactPolicy,
          assignedUserId: assignee,
          unread: c.unread,
        },
      });
    }

    for (const m of createSeedMessages()) {
      const conversation = createSeedConversations().find(
        (c) => c.id === m.conversationId,
      );
      await this.prisma.message.create({
        data: {
          id: m.id,
          tenantId: m.tenantId,
          conversationId: m.conversationId,
          connectionId: m.externalMessageId
            ? (conversation?.connectionId ?? null)
            : null,
          externalMessageId: m.externalMessageId,
          direction: m.sender === 'agent' ? 'outbound' : 'inbound',
          senderType: m.sender,
          content: m.content,
          deliveryStatus: m.deliveryStatus,
        },
      });
    }

    for (const k of createSeedKnowledge()) {
      const knowledgeBaseId = (await this.getDefaultKnowledgeBase(k.tenantId)).id;
      await this.prisma.knowledgeDocument.create({
        data: {
          id: k.id,
          tenantId: k.tenantId,
          knowledgeBaseId,
          categoryId: null,
          title: k.title,
          sourceType: k.sourceType,
          body: k.body,
          status: k.status,
          excerpt: k.excerpt,
        },
      });
    }

    for (const d of createSeedDrafts()) {
      await this.prisma.replyDraft.create({
        data: {
          id: d.id,
          tenantId: d.tenantId,
          conversationId: d.conversationId,
          content: d.content,
          citations: d.citations as Prisma.InputJsonValue,
          status: d.status,
          reason: d.reason,
          reviewStatus: d.reviewStatus,
        },
      });
    }
  }

  private mapConversation(row: {
    id: string;
    tenantId: string;
    connectionId: string | null;
    externalConversationId?: string | null;
    externalContactId?: string | null;
    contactName: string;
    contactMeta: string | null;
    preview: string;
    status: string;
    handlingMode?: string | null;
    contactPolicy?: string | null;
    contactPolicyReason?: string | null;
    contactPolicyActorId?: string | null;
    contactPolicyUpdatedAt?: Date | null;
    unread: boolean;
    lastMessageAt: Date;
    assignee: { displayName: string } | null;
  }) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      connectionId: row.connectionId ?? '',
      externalConversationId: row.externalConversationId ?? undefined,
      externalContactId: row.externalContactId ?? undefined,
      contactName: row.contactName,
      contactMeta: row.contactMeta ?? undefined,
      preview: row.preview,
      status: row.status as ConversationStatus,
      handlingMode:
        row.handlingMode === 'human' ? ('human' as const) : ('ai' as const),
      contactPolicy: (row.contactPolicy ?? row.handlingMode ?? 'ai') as ContactPolicy,
      contactPolicyReason: row.contactPolicyReason ?? undefined,
      contactPolicyActorId: row.contactPolicyActorId ?? undefined,
      contactPolicyUpdatedAt: row.contactPolicyUpdatedAt?.toISOString(),
      assignee: row.assignee?.displayName ?? null,
      updatedAt: clock(row.lastMessageAt),
      unread: row.unread,
    };
  }

  async listConversations(
    tenantId: string,
    status?: ConversationStatus,
    q?: string,
  ) {
    const rows = await this.prisma.conversation.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(q?.trim()
          ? {
              OR: [
                { contactName: { contains: q.trim() } },
                { preview: { contains: q.trim() } },
                { contactMeta: { contains: q.trim() } },
              ],
            }
          : {}),
      },
      include: { assignee: true },
      orderBy: { lastMessageAt: 'desc' },
    });
    return { items: rows.map((row) => this.mapConversation(row)) };
  }

  async getConversation(tenantId: string, id: string) {
    const row = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: { assignee: true },
    });
    if (!row) throw new NotFoundException('Conversation not found');
    return this.mapConversation(row);
  }

  async messages(tenantId: string, conversationId: string) {
    await this.getConversation(tenantId, conversationId);
    const rows = await this.prisma.message.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      items: rows.map((m) => ({
        id: m.id,
        tenantId: m.tenantId,
        conversationId: m.conversationId,
        externalMessageId: m.externalMessageId ?? undefined,
        sender: m.senderType as 'customer' | 'agent' | 'system',
        content: m.content,
        createdAt: clock(m.createdAt),
        createdAtMs: m.createdAt.getTime(),
        deliveryStatus: m.deliveryStatus ?? undefined,
      })),
    };
  }

  private mapDraft(row: {
    id: string;
    tenantId: string;
    conversationId: string;
    content: string;
    status: string;
    reason: string | null;
    citations: Prisma.JsonValue;
    reviewStatus: string;
    modelProvider?: string | null;
    modelName?: string | null;
  }): ReplyDraft {
    return {
      id: row.id,
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      content: row.content,
      status: row.status as 'pending' | 'needs_human',
      reason: row.reason ?? undefined,
      citations:
        (row.citations as { documentTitle: string; quote: string }[]) ?? [],
      reviewStatus: row.reviewStatus as ReplyDraft['reviewStatus'],
      model:
        row.modelProvider && row.modelName
          ? { provider: row.modelProvider, name: row.modelName }
          : undefined,
    };
  }

  async draft(tenantId: string, conversationId: string) {
    await this.getConversation(tenantId, conversationId);
    const row = await this.prisma.replyDraft.findFirst({
      where: {
        tenantId,
        conversationId,
        reviewStatus: { in: ['pending', 'send_failed', 'sending'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return this.mapDraft(row);
  }

  async getDraft(tenantId: string, id: string): Promise<ReplyDraft> {
    const row = await this.prisma.replyDraft.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Reply draft not found');
    return this.mapDraft(row);
  }

  async claimDraftForSend(tenantId: string, id: string): Promise<ReplyDraft> {
    const updated = await this.prisma.replyDraft.updateMany({
      where: {
        id,
        tenantId,
        reviewStatus: { in: ['pending', 'send_failed'] },
      },
      data: { reviewStatus: 'sending', reviewedAt: new Date() },
    });
    if (updated.count === 0) {
      const current = await this.prisma.replyDraft.findFirst({
        where: { id, tenantId },
      });
      if (!current) throw new NotFoundException('Reply draft not found');
      if (current.reviewStatus === 'sending') {
        throw new BadRequestException('草稿正在发送中，请勿重复操作');
      }
      if (current.reviewStatus === 'accepted') {
        throw new BadRequestException('草稿已发送，请勿重复操作');
      }
      throw new BadRequestException('草稿状态不可发送');
    }
    return this.getDraft(tenantId, id);
  }

  async releaseStaleSendingDrafts(olderThanIso: string) {
    const cutoff = new Date(olderThanIso);
    const rows = await this.prisma.replyDraft.findMany({
      where: {
        reviewStatus: 'sending',
        OR: [
          { reviewedAt: { lt: cutoff } },
          { reviewedAt: null, createdAt: { lt: cutoff } },
        ],
      },
      select: { id: true, tenantId: true, conversationId: true },
    });
    if (!rows.length) return [];
    await this.prisma.replyDraft.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { reviewStatus: 'send_failed', reviewedAt: null },
    });
    return rows;
  }

  async supersedePendingDrafts(tenantId: string, conversationId: string) {
    await this.prisma.replyDraft.updateMany({
      where: {
        tenantId,
        conversationId,
        reviewStatus: { in: ['pending', 'send_failed'] },
      },
      data: { reviewStatus: 'superseded' },
    });
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
  ) {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.conversation.findFirst({
        where: { id, tenantId },
        select: {
          status: true,
          handlingMode: true,
          assignedUserId: true,
        },
      });
      if (!current) throw new NotFoundException('Conversation not found');

      let assignedUserId = current.assignedUserId;
      if (mode === 'human' && assignee) {
        const user = await tx.user.findFirst({
          where: {
            id: assignee.userId,
            status: 'active',
            memberships: { some: { tenantId, status: 'active' } },
          },
          select: { id: true },
        });
        if (!user) {
          throw new NotFoundException('客服成员不存在、已停用或不属于当前企业');
        }
        assignedUserId = user.id;
      }

      let nextStatus = current.status;
      if (mode === 'human') {
        if (current.status === 'open' || current.status === 'waiting_human') {
          nextStatus = 'in_progress';
        }
      } else {
        assignedUserId = null;
        if (current.status === 'waiting_human') nextStatus = 'in_progress';
      }

      const updated = await tx.conversation.updateMany({
        where: {
          id,
          tenantId,
          handlingMode: current.handlingMode,
          assignedUserId: current.assignedUserId,
        },
        data: {
          handlingMode: mode,
          contactPolicy: mode,
          contactPolicyReason: null,
          contactPolicyUpdatedAt: new Date(),
          assignedUserId,
          status: nextStatus,
          lastMessageAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('会话已被其他客服更新，请刷新后重试');
      }

      if (current.handlingMode !== mode) {
        await tx.message.create({
          data: {
            id: newId('m'),
            tenantId,
            conversationId: id,
            direction: 'internal',
            senderType: 'system',
            content:
              mode === 'ai'
                ? '已切换为 AI 接管。未回复的客户消息会自动回复'
                : '已切换为人工接管',
            createdAt: new Date(),
          },
        });
      }
    });

    return this.getConversation(tenantId, id);
  }

  async setContactPolicy(
    tenantId: string,
    id: string,
    policy: ContactPolicy,
    reason: string,
    actorId: string,
  ) {
    await this.getConversation(tenantId, id);
    const current = await this.prisma.conversation.findFirst({
      where: { id, tenantId }, select: { externalContactId: true },
    });
    if (current?.externalContactId) {
      await this.setExternalContactPolicies(tenantId, [current.externalContactId], policy, reason, actorId);
      return this.getConversation(tenantId, id);
    }
    await this.prisma.conversation.updateMany({
      where: { id, tenantId },
      data: {
        contactPolicy: policy,
        contactPolicyReason: reason || null,
        contactPolicyActorId: actorId,
        contactPolicyUpdatedAt: new Date(),
        handlingMode: policy === 'ai' ? 'ai' : 'human',
        assignedUserId: policy === 'human' ? actorId : null,
      },
    });
    await this.prisma.message.create({
      data: {
        id: newId('m'),
        tenantId,
        conversationId: id,
        direction: 'internal',
        senderType: 'system',
        content: `接待策略已更新：${policy}${reason ? `；原因：${reason}` : ''}`,
      },
    });
    return this.getConversation(tenantId, id);
  }

  async listExternalContacts(
    tenantId: string,
    input?: { q?: string; policy?: ContactPolicy },
  ) {
    const q = input?.q?.trim();
    const rows = await this.prisma.externalContact.findMany({
      where: {
        tenantId,
        ...(input?.policy ? { policy: input.policy } : {}),
        ...(q ? { OR: [{ displayName: { contains: q, mode: 'insensitive' } }, { externalUserId: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      include: { _count: { select: { conversations: true } }, conversations: { orderBy: { lastMessageAt: 'desc' }, take: 1, select: { lastMessageAt: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return { items: rows.map((row): ExternalContact => ({
      id: row.id, tenantId: row.tenantId, connectionId: row.connectionId,
      externalUserId: row.externalUserId, displayName: row.displayName, source: row.source,
      policy: row.policy as ContactPolicy, policyReason: row.policyReason ?? undefined,
      policyActorId: row.policyActorId ?? undefined, policyUpdatedAt: row.policyUpdatedAt.toISOString(),
      conversationCount: row._count.conversations,
      lastMessageAt: row.conversations[0]?.lastMessageAt.toISOString() ?? row.updatedAt.toISOString(),
    })) };
  }

  async setDefaultContactPolicy(tenantId: string, policy: ContactPolicy): Promise<Tenant> {
    const row = await this.prisma.tenant.update({ where: { id: tenantId }, data: { defaultContactPolicy: policy } });
    return { id: row.id, name: row.name, slug: row.slug, autoSendEnabled: row.autoSendEnabled, defaultContactPolicy: row.defaultContactPolicy as ContactPolicy };
  }

  async setExternalContactPolicies(
    tenantId: string, ids: string[], policy: ContactPolicy, reason: string, actorId: string,
  ) {
    const contacts = await this.prisma.externalContact.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } });
    if (!contacts.length) return { updated: 0 };
    const contactIds = contacts.map((contact) => contact.id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.externalContact.updateMany({
        where: { tenantId, id: { in: contactIds } },
        data: { policy, policyReason: reason || null, policyActorId: actorId, policyUpdatedAt: now },
      });
      await tx.conversation.updateMany({
        where: { tenantId, externalContactId: { in: contactIds } },
        data: { contactPolicy: policy, contactPolicyReason: reason || null, contactPolicyActorId: actorId, contactPolicyUpdatedAt: now, handlingMode: policy === 'ai' ? 'ai' : 'human', assignedUserId: policy === 'human' ? actorId : null },
      });
      await tx.replyDraft.updateMany({
        where: { tenantId, conversation: { externalContactId: { in: contactIds } }, reviewStatus: { in: ['pending', 'send_failed'] } },
        data: { reviewStatus: 'superseded' },
      });
    });
    return { updated: contacts.length };
  }

  async escalate(tenantId: string, id: string, reason?: string) {
    const current = await this.getConversation(tenantId, id);
    const now = new Date();
    const alreadyWaiting = current.status === 'waiting_human';
    await this.prisma.conversation.update({
      where: { id },
      data: {
        status: 'waiting_human',
        handlingMode: 'human',
        contactPolicy: 'human',
        contactPolicyReason: reason ?? null,
        contactPolicyUpdatedAt: now,
        lastMessageAt: now,
      },
    });
    if (!alreadyWaiting) {
      await this.prisma.message.create({
        data: {
          id: newId('m'),
          tenantId,
          conversationId: id,
          direction: 'internal',
          senderType: 'system',
          content: `已转人工${reason ? `：${reason}` : ''}`,
          createdAt: now,
        },
      });
    }
    return this.getConversation(tenantId, id);
  }

  async close(tenantId: string, id: string): Promise<never> {
    await this.getConversation(tenantId, id);
    throw new BadRequestException(
      '企业微信会话由客户发消息维持，不能在工作台结束',
    );
  }

  async markRead(tenantId: string, id: string) {
    await this.getConversation(tenantId, id);
    await this.prisma.conversation.update({
      where: { id },
      data: { unread: false },
    });
    return this.getConversation(tenantId, id);
  }

  async prepareOutboundReply(
    tenantId: string,
    id: string,
    content: string,
    autoSendGuard?: AutoSendGuard,
  ) {
    const conversation = await this.getConversation(tenantId, id);
    if (autoSendGuard) {
      const previousAttempt = await this.prisma.message.findFirst({
        where: {
          tenantId,
          conversationId: id,
          direction: 'outbound',
          metadata: {
            path: ['autoSendGuard', 'draftId'],
            equals: autoSendGuard.draftId,
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (previousAttempt && previousAttempt.deliveryStatus !== 'queued') {
        throw new BadRequestException(
          previousAttempt.deliveryStatus === 'unknown'
            ? '此前发送结果不确定，请先核实渠道记录，系统不会自动重发'
            : '该草稿已有出站记录，不能再次自动发送',
        );
      }
    }
    const existing = await this.prisma.message.findFirst({
      where: {
        tenantId,
        conversationId: id,
        senderType: 'agent',
        direction: 'outbound',
        content,
        deliveryStatus: { in: ['queued', 'dispatching'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing?.deliveryStatus === 'dispatching') {
      throw new BadRequestException('相同回复正在发送中');
    }
    if (existing?.deliveryStatus === 'queued') {
      return {
        messageId: existing.id,
        idempotencyKey: existing.externalMessageId ?? existing.id,
        connectionId: conversation.connectionId || null,
        externalConversationId: conversation.externalConversationId,
        autoSendGuard: (existing.metadata as { autoSendGuard?: AutoSendGuard } | null)?.autoSendGuard,
        message: {
          id: existing.id,
          tenantId,
          conversationId: id,
          sender: 'agent' as const,
          content,
          createdAt: clock(existing.createdAt),
          deliveryStatus: 'queued',
        },
      };
    }
    const now = new Date();
    const nextStatus = statusAfterAgentReply(conversation.status);
    const idempotencyKey = newId('ext');
    const message = await this.prisma.message.create({
      data: {
        id: newId('m'),
        tenantId,
        conversationId: id,
        connectionId: conversation.connectionId || null,
        externalMessageId: idempotencyKey,
        direction: 'outbound',
        senderType: 'agent',
        content,
        deliveryStatus: 'queued',
        metadata: {
          outboxAt: now.toISOString(),
          ...(autoSendGuard
            ? {
                autoSendGuard: {
                  draftId: autoSendGuard.draftId,
                  expectedCustomerMessageId:
                    autoSendGuard.expectedCustomerMessageId,
                },
              }
            : {}),
        },
        createdAt: now,
      },
    });
    await this.prisma.conversation.update({
      where: { id },
      data: {
        preview: content,
        unread: false,
        status: nextStatus,
        lastMessageAt: now,
      },
    });
    if (conversation.connectionId) {
      await this.prisma.wecomConnection.update({
        where: { id: conversation.connectionId },
        data: { lastEventAt: now },
      });
    }
    return {
      messageId: message.id,
      idempotencyKey,
      connectionId: conversation.connectionId || null,
      externalConversationId: conversation.externalConversationId,
      autoSendGuard,
      message: {
        id: message.id,
        tenantId,
        conversationId: id,
        sender: 'agent' as const,
        content,
        createdAt: clock(now),
        deliveryStatus: 'queued',
      },
    };
  }

  async markOutboundDispatching(messageId: string) {
    const now = new Date().toISOString();
    const current = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { metadata: true },
    });
    if (!current) throw new NotFoundException('Message not found');
    const metadata = (current.metadata as Record<string, unknown> | null) ?? {};
    const updated = await this.prisma.message.updateMany({
      where: { id: messageId, deliveryStatus: 'queued' },
      data: {
        deliveryStatus: 'dispatching',
        metadata: { ...metadata, outboxAt: now },
      },
    });
    return updated.count === 1;
  }

  async listQueuedOutbound(olderThanIso: string) {
    const cutoff = Date.parse(olderThanIso);
    const rows = await this.prisma.message.findMany({
      where: {
        deliveryStatus: 'queued',
        senderType: 'agent',
        direction: 'outbound',
      },
      include: { conversation: true },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .filter((row) => {
        const meta = row.metadata as { outboxAt?: string } | null;
        const at = Date.parse(meta?.outboxAt ?? row.createdAt.toISOString());
        return Number.isFinite(at) && at <= cutoff;
      })
      .map((row) => ({
        messageId: row.id,
        tenantId: row.tenantId,
        conversationId: row.conversationId,
        content: row.content,
        idempotencyKey: row.externalMessageId ?? row.id,
        connectionId: row.connectionId,
        externalConversationId: row.conversation.externalConversationId ?? undefined,
        autoSendGuard: (row.metadata as { autoSendGuard?: AutoSendGuard } | null)?.autoSendGuard,
      }));
  }

  async failStaleDispatching(olderThanIso: string) {
    const cutoff = Date.parse(olderThanIso);
    const rows = await this.prisma.message.findMany({
      where: { deliveryStatus: 'dispatching', senderType: 'agent' },
      take: 50,
    });
    const stale = rows.filter((row) => {
      const meta = row.metadata as { outboxAt?: string } | null;
      const at = Date.parse(meta?.outboxAt ?? row.createdAt.toISOString());
      return Number.isFinite(at) && at <= cutoff;
    });
    if (!stale.length) return [];
    await this.prisma.message.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { deliveryStatus: 'unknown' },
    });
    return stale.map((row) => ({
      messageId: row.id,
      tenantId: row.tenantId,
      conversationId: row.conversationId,
    }));
  }

  async finalizeOutboundReply(
    messageId: string,
    result: { status: string; externalMessageId?: string },
  ) {
    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        deliveryStatus: result.status,
        ...(result.externalMessageId
          ? { externalMessageId: result.externalMessageId }
          : {}),
      },
    });
    if (result.status === 'superseded') {
      const metadata = message.metadata as { autoSendGuard?: AutoSendGuard } | null;
      const draftId = metadata?.autoSendGuard?.draftId;
      if (draftId) {
        await this.prisma.replyDraft.updateMany({
          where: { id: draftId, tenantId: message.tenantId, reviewStatus: 'sending' },
          data: { reviewStatus: 'superseded', reviewedAt: new Date() },
        });
      }
    }
    return {
      id: message.id,
      tenantId: message.tenantId,
      conversationId: message.conversationId,
      sender: 'agent' as const,
      content: message.content,
      createdAt: clock(message.createdAt),
      deliveryStatus: message.deliveryStatus ?? result.status,
    };
  }

  async saveAiDraft(
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
    const draft = await this.prisma.replyDraft.create({
      data: {
        id: newId('d'),
        tenantId,
        conversationId,
        status: input.status,
        reviewStatus: 'pending',
        reason: input.reason ?? null,
        content: input.content,
        citations: input.citations as Prisma.InputJsonValue,
        modelProvider: input.model?.provider,
        modelName: input.model?.name,
      },
    });
    return {
      id: draft.id,
      tenantId,
      conversationId,
      content: draft.content,
      status: draft.status as 'pending' | 'needs_human',
      reason: draft.reason ?? undefined,
      citations: draft.citations as { documentTitle: string; quote: string; documentId?: string; documentVersion?: number }[],
      reviewStatus: 'pending' as const,
      model: input.model,
    };
  }

  async createAiDraft(tenantId: string, conversationId: string) {
    await this.supersedePendingDrafts(tenantId, conversationId);
    const knowledge = await this.prisma.knowledgeDocument.findFirst({
      where: { tenantId, status: 'ready' },
    });
    return this.saveAiDraft(tenantId, conversationId, {
      status: knowledge ? 'pending' : 'needs_human',
      reason: knowledge
        ? '模型未生成回复，已保留知识摘要，需人工确认后发送'
        : '大模型暂不可用',
      content: knowledge
        ? (knowledge.excerpt ?? knowledge.title)
        : '大模型暂不可用，无法回答知识库以外的问题。',
      citations: knowledge
        ? [{ documentTitle: knowledge.title, quote: knowledge.excerpt ?? '' }]
        : [],
    });
  }

  async updateDraft(tenantId: string, id: string, content: string) {
    const draft = await this.prisma.replyDraft.findFirst({
      where: { id, tenantId },
    });
    if (!draft) throw new NotFoundException('Reply draft not found');
    return this.prisma.replyDraft.update({
      where: { id },
      data: { content, editedContent: content },
    });
  }

  async reviewDraft(
    tenantId: string,
    id: string,
    reviewStatus: 'accepted' | 'rejected' | 'superseded' | 'send_failed',
  ): Promise<ReplyDraft> {
    const draft = await this.prisma.replyDraft.findFirst({
      where: { id, tenantId },
    });
    if (!draft) throw new NotFoundException('Reply draft not found');
    const row = await this.prisma.replyDraft.update({
      where: { id },
      data: {
        reviewStatus,
        reviewedAt: reviewStatus === 'send_failed' ? null : new Date(),
      },
    });
    return this.mapDraft(row);
  }

  async listKnowledge(tenantId: string, q?: string, categoryId?: string, knowledgeBaseId?: string) {
    const keyword = q?.trim();
    const rows = await this.prisma.knowledgeDocument.findMany({
      where: {
        tenantId,
        ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(keyword
          ? {
              OR: [
                { title: { contains: keyword, mode: 'insensitive' } },
                { excerpt: { contains: keyword, mode: 'insensitive' } },
                { body: { contains: keyword, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      items: await Promise.all(rows.map(async (d) => ({ ...this.toKnowledgeListItem(d), categoryId: d.categoryId, categoryName: d.categoryId ? (await this.prisma.knowledgeCategory.findFirst({ where: { id: d.categoryId, tenantId }, select: { name: true } }))?.name ?? null : null }))),
    };
  }

  async getKnowledge(tenantId: string, id: string) {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return {
      id: doc.id,
      tenantId: doc.tenantId,
      title: doc.title,
      sourceType: doc.sourceType as 'faq' | 'markdown',
      status: doc.status as DocStatus,
      updatedAt: doc.updatedAt.toISOString().slice(0, 10),
      excerpt: doc.excerpt ?? '',
      reviewNote: doc.reviewNote ?? null,
      version: doc.version,
      knowledgeBaseId: doc.knowledgeBaseId,
      categoryId: doc.categoryId,
      categoryName: (await this.prisma.knowledgeCategory.findFirst({ where: { id: doc.categoryId ?? '', tenantId }, select: { name: true } }))?.name ?? null,
      body: doc.body,
    };
  }

  async readyKnowledgeForRetrieve(tenantId: string, knowledgeBaseSelection?: string | string[]) {
    const knowledgeBaseIds = Array.isArray(knowledgeBaseSelection)
      ? knowledgeBaseSelection
      : knowledgeBaseSelection
        ? [knowledgeBaseSelection]
        : undefined;
    const rows = await this.prisma.knowledgeDocument.findMany({
      where: { tenantId, status: 'ready', ...(knowledgeBaseIds ? { knowledgeBaseId: { in: knowledgeBaseIds } } : {}) },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((d) => ({
      id: d.id,
      title: d.title,
      excerpt: d.excerpt ?? '',
      body: d.body,
    }));
  }

  async indexedKnowledgeDocumentIds(tenantId: string, knowledgeBaseSelection?: string | string[]) {
    const knowledgeBaseIds = Array.isArray(knowledgeBaseSelection)
      ? knowledgeBaseSelection
      : knowledgeBaseSelection
        ? [knowledgeBaseSelection]
        : undefined;
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: { tenantId, ...(knowledgeBaseIds ? { document: { knowledgeBaseId: { in: knowledgeBaseIds } } } : {}) },
      select: { documentId: true },
      distinct: ['documentId'],
    });
    return rows.map((row) => row.documentId);
  }

  async replaceKnowledgeChunks(
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
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({ where: { tenantId, documentId } });
      for (const chunk of chunks) {
        const vector = toPgVector(chunk.embedding);
        await tx.$executeRaw`
          INSERT INTO knowledge_chunks (id, tenant_id, document_id, ordinal, content, embedding)
          VALUES (${chunk.id}, ${tenantId}, ${documentId}, ${chunk.ordinal}, ${chunk.content}, ${vector}::vector)
        `;
      }
    });
  }

  async searchKnowledgeChunks(
    tenantId: string,
    knowledgeBaseIds: string[],
    queryEmbedding: number[],
    limit: number,
  ): Promise<KnowledgeVectorHit[]> {
    if (!queryEmbedding.length) return [];
    const vector = toPgVector(queryEmbedding);
    return this.prisma.$queryRaw<KnowledgeVectorHit[]>`
      SELECT
        chunk.id,
        chunk.document_id AS "documentId",
        document.title,
        chunk.content,
        (1 - (chunk.embedding <=> ${vector}::vector))::float8 AS "vectorScore"
      FROM knowledge_chunks AS chunk
      INNER JOIN knowledge_documents AS document
        ON document.id = chunk.document_id
       AND document.tenant_id = ${tenantId}
      WHERE chunk.tenant_id = ${tenantId}
        AND document.knowledge_base_id = ANY(${knowledgeBaseIds}::text[])
        AND document.status = 'ready'
        AND vector_dims(chunk.embedding) = vector_dims(${vector}::vector)
      ORDER BY chunk.embedding <=> ${vector}::vector
      LIMIT ${Math.max(1, Math.min(Math.floor(limit) || 100, 500))}
    `;
  }

  async getKnowledgeIndexSettings(tenantId: string) {
    const row = await this.prisma.knowledgeIndexSetting.findUnique({
      where: { tenantId },
    });
    if (!row) {
      return {
        chunkSize: 480,
        chunkOverlap: 80,
        maxChunksPerDoc: 40,
      };
    }
    return {
      chunkSize: row.chunkSize,
      chunkOverlap: row.chunkOverlap,
      maxChunksPerDoc: row.maxChunksPerDoc,
    };
  }

  async saveKnowledgeIndexSettings(
    tenantId: string,
    input: {
      chunkSize: number;
      chunkOverlap: number;
      maxChunksPerDoc: number;
    },
  ) {
    const row = await this.prisma.knowledgeIndexSetting.upsert({
      where: { tenantId },
      create: {
        tenantId,
        chunkSize: input.chunkSize,
        chunkOverlap: input.chunkOverlap,
        maxChunksPerDoc: input.maxChunksPerDoc,
      },
      update: {
        chunkSize: input.chunkSize,
        chunkOverlap: input.chunkOverlap,
        maxChunksPerDoc: input.maxChunksPerDoc,
      },
    });
    return {
      chunkSize: row.chunkSize,
      chunkOverlap: row.chunkOverlap,
      maxChunksPerDoc: row.maxChunksPerDoc,
    };
  }

  async listKnowledgeBases(tenantId: string) {
    const rows = await this.prisma.knowledgeBase.findMany({ where: { tenantId }, include: { _count: { select: { documents: true, connections: true } } }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    const connections = await this.prisma.wecomConnection.findMany({ where: { tenantId }, select: { knowledgeBaseId: true, knowledgeBaseIds: true } });
    return rows.map((row) => ({ id: row.id, tenantId, name: row.name, isDefault: row.isDefault, documentCount: row._count.documents, connectionCount: connections.filter((connection) => connection.knowledgeBaseIds.includes(row.id) || connection.knowledgeBaseId === row.id).length }));
  }

  async getDefaultKnowledgeBase(tenantId: string) {
    let row = await this.prisma.knowledgeBase.findFirst({ where: { tenantId, isDefault: true } });
    if (!row) row = await this.prisma.knowledgeBase.create({ data: { id: newId('kb'), tenantId, name: '项目知识库', isDefault: true } });
    return { id: row.id, tenantId, name: row.name, isDefault: row.isDefault };
  }

  async createKnowledgeBase(tenantId: string, name: string) {
    const clean = name.trim();
    if (await this.prisma.knowledgeBase.findFirst({ where: { tenantId, name: { equals: clean, mode: 'insensitive' } } })) throw new BadRequestException('知识库名称已存在');
    const row = await this.prisma.knowledgeBase.create({ data: { id: newId('kb'), tenantId, name: clean } });
    return { id: row.id, tenantId, name: row.name, isDefault: row.isDefault };
  }

  async updateKnowledgeBase(tenantId: string, id: string, name: string) {
    const found = await this.prisma.knowledgeBase.findFirst({ where: { id, tenantId } });
    if (!found) throw new NotFoundException('Knowledge base not found');
    const clean = name.trim();
    if (await this.prisma.knowledgeBase.findFirst({ where: { tenantId, id: { not: id }, name: { equals: clean, mode: 'insensitive' } } })) throw new BadRequestException('知识库名称已存在');
    const row = await this.prisma.knowledgeBase.update({ where: { id }, data: { name: clean } });
    return { id: row.id, tenantId, name: row.name, isDefault: row.isDefault };
  }

  async deleteKnowledgeBase(tenantId: string, id: string) {
    const base = await this.prisma.knowledgeBase.findFirst({ where: { id, tenantId } });
    if (!base) throw new NotFoundException('Knowledge base not found');
    if (base.isDefault) throw new BadRequestException('默认知识库不能删除');
    if (await this.prisma.wecomConnection.findFirst({ where: { tenantId, OR: [{ knowledgeBaseId: id }, { knowledgeBaseIds: { has: id } }] } })) throw new BadRequestException('该知识库仍绑定企业微信连接，请先解除绑定');
    await this.prisma.knowledgeBase.delete({ where: { id } });
  }

  async listKnowledgeCategories(tenantId: string, knowledgeBaseId: string): Promise<KnowledgeCategory[]> {
    const rows = await this.prisma.knowledgeCategory.findMany({ where: { tenantId, knowledgeBaseId }, include: { _count: { select: { documents: true } } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return rows.map((row) => ({ id: row.id, tenantId, knowledgeBaseId, name: row.name, sortOrder: row.sortOrder, documentCount: row._count.documents }));
  }

  async recordKnowledgeGap(input: { tenantId: string; conversationId: string; customerMessageId: string; query: string; knowledgeBaseId?: string }) {
    const knowledgeBaseId = input.knowledgeBaseId ?? (await this.getDefaultKnowledgeBase(input.tenantId)).id;
    await this.prisma.knowledgeGap.upsert({ where: { customerMessageId: input.customerMessageId }, create: { id: newId('kg'), ...input, knowledgeBaseId }, update: { knowledgeBaseId, occurrences: { increment: 1 }, lastSeenAt: new Date(), status: 'open' } });
  }

  async listKnowledgeGaps(tenantId: string): Promise<KnowledgeGap[]> {
    const rows = await this.prisma.knowledgeGap.findMany({ where: { tenantId }, include: { conversation: { select: { contactName: true } } }, orderBy: { lastSeenAt: 'desc' } });
    return rows.map((row) => ({ id: row.id, tenantId: row.tenantId, conversationId: row.conversationId, customerMessageId: row.customerMessageId, query: row.query, knowledgeBaseId: row.knowledgeBaseId ?? undefined, status: row.status as KnowledgeGap['status'], occurrences: row.occurrences, firstSeenAt: row.firstSeenAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(), contactName: row.conversation.contactName }));
  }

  async updateKnowledgeGap(tenantId: string, id: string, status: KnowledgeGap['status']): Promise<KnowledgeGap> {
    const found = await this.prisma.knowledgeGap.findFirst({ where: { id, tenantId } });
    if (!found) throw new NotFoundException('Knowledge gap not found');
    const row = await this.prisma.knowledgeGap.update({ where: { id }, data: { status }, include: { conversation: { select: { contactName: true } } } });
    return { id: row.id, tenantId: row.tenantId, conversationId: row.conversationId, customerMessageId: row.customerMessageId, query: row.query, knowledgeBaseId: row.knowledgeBaseId ?? undefined, status: row.status as KnowledgeGap['status'], occurrences: row.occurrences, firstSeenAt: row.firstSeenAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(), contactName: row.conversation.contactName };
  }

  async publishKnowledge(tenantId: string, id: string) {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const updated = await this.prisma.knowledgeDocument.update({
      where: { id },
      data: { status: 'ready', reviewNote: null },
    });
    return this.toKnowledgeListItem(updated);
  }

  async updateKnowledge(
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
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (input.knowledgeBaseId && !(await this.prisma.knowledgeBase.findFirst({ where: { id: input.knowledgeBaseId, tenantId } }))) throw new BadRequestException('知识库不存在');
    const targetBaseId = input.knowledgeBaseId ?? doc.knowledgeBaseId;
    if (input.categoryId && !(await this.prisma.knowledgeCategory.findFirst({ where: { id: input.categoryId, tenantId, knowledgeBaseId: targetBaseId } }))) throw new BadRequestException('文件夹不属于当前知识库');
    const updated = await this.prisma.knowledgeDocument.update({
      where: { id },
      data: {
        title: input.title,
        sourceType: input.sourceType,
        body: input.body,
        categoryId: input.categoryId ?? null,
        knowledgeBaseId: targetBaseId,
        status: input.status ?? 'draft',
        ...(input.reviewNote !== undefined
          ? { reviewNote: input.reviewNote }
          : {}),
        version: { increment: 1 },
        excerpt:
          input.body.slice(0, 40) + (input.body.length > 40 ? '…' : ''),
      },
    });
    return this.toKnowledgeListItem(updated);
  }

  async rejectKnowledge(
    tenantId: string,
    id: string,
    reviewNote?: string | null,
  ) {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const updated = await this.prisma.knowledgeDocument.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewNote: reviewNote?.trim() || null,
      },
    });
    return this.toKnowledgeListItem(updated);
  }

  async archiveKnowledge(tenantId: string, id: string) {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const updated = await this.prisma.knowledgeDocument.update({
      where: { id },
      data: { status: 'archived' },
    });
    return this.toKnowledgeListItem(updated);
  }

  async deleteKnowledge(tenantId: string, id: string) {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    await this.prisma.knowledgeDocument.delete({ where: { id } });
  }

  private toKnowledgeListItem(doc: {
    id: string;
    title: string;
    sourceType: string;
    status: string;
    updatedAt: Date;
    excerpt: string | null;
    reviewNote?: string | null;
    version?: number;
    knowledgeBaseId?: string;
    categoryId?: string | null;
    category?: { name: string } | null;
  }) {
    return {
      id: doc.id,
      title: doc.title,
      sourceType: doc.sourceType as 'faq' | 'markdown',
      status: doc.status as DocStatus,
      updatedAt: doc.updatedAt.toISOString().slice(0, 10),
      excerpt: doc.excerpt ?? '',
      reviewNote: doc.reviewNote ?? null,
      version: doc.version ?? 1,
      knowledgeBaseId: doc.knowledgeBaseId,
      categoryId: doc.categoryId ?? null,
      categoryName: doc.category?.name ?? null,
    };
  }

  async createKnowledge(
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
    const knowledgeBaseId = input.knowledgeBaseId ?? (await this.getDefaultKnowledgeBase(tenantId)).id;
    if (!(await this.prisma.knowledgeBase.findFirst({ where: { id: knowledgeBaseId, tenantId } }))) throw new BadRequestException('知识库不存在');
    if (input.categoryId && !(await this.prisma.knowledgeCategory.findFirst({ where: { id: input.categoryId, tenantId, knowledgeBaseId } }))) throw new BadRequestException('文件夹不属于当前知识库');
    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        id: newId('k'),
        tenantId,
        knowledgeBaseId,
        title: input.title,
        sourceType: input.sourceType,
        body: input.body,
        categoryId: input.categoryId ?? null,
        status: input.status ?? 'draft',
        excerpt:
          input.body.slice(0, 40) + (input.body.length > 40 ? '…' : ''),
      },
    });
    return this.toKnowledgeListItem(doc);
  }

  async listWecom(tenantId: string) {
    const rows = await this.prisma.wecomConnection.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      items: rows.map((c) => this.toWecomListItem(c)),
    };
  }

  async createWecom(
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
  ): Promise<WecomConnection> {
    const channelType = input.channelType ?? 'wecom_mock';
    const mock = channelType === 'wecom_mock';
    const knowledgeBaseIds = [...new Set(input.knowledgeBaseIds?.length ? input.knowledgeBaseIds : input.knowledgeBaseId ? [input.knowledgeBaseId] : [(await this.getDefaultKnowledgeBase(tenantId)).id])];
    if (await this.prisma.knowledgeBase.count({ where: { tenantId, id: { in: knowledgeBaseIds } } }) !== knowledgeBaseIds.length) throw new BadRequestException('知识库不存在');
    const row = await this.prisma.wecomConnection.create({
      data: {
        id: newId('conn'),
        tenantId,
        displayName: input.displayName ?? (mock ? '开发模拟连接' : '企业微信连接'),
        channelType,
        capability: input.capability ?? (channelType === 'wechat_kf' ? 'wechat_kf' : 'internal_app'),
        status: mock ? 'connected' : 'pending_auth',
        corpId: input.corpId,
        agentId: input.agentId,
        externalAccountId: input.externalAccountId,
        knowledgeBaseId: knowledgeBaseIds[0] ?? null,
        knowledgeBaseIds,
        config: (input.config as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
    return this.toWecomListItem(row);
  }

  async updateWecom(
    tenantId: string,
    id: string,
    input: {
      displayName?: string;
      capability?: WecomCapability;
      corpId?: string | null;
      agentId?: string | null;
      externalAccountId?: string | null;
      knowledgeBaseId?: string | null;
      knowledgeBaseIds?: string[];
      config?: Record<string, unknown> | null;
      status?: WecomStatus;
      errorMessage?: string | null;
    },
  ): Promise<WecomConnection> {
    const connection = await this.prisma.wecomConnection.findFirst({
      where: { id, tenantId },
    });
    if (!connection) throw new NotFoundException('WeCom connection not found');
    const knowledgeBaseIds = input.knowledgeBaseIds === undefined
      ? input.knowledgeBaseId === undefined ? undefined : input.knowledgeBaseId ? [input.knowledgeBaseId] : []
      : [...new Set(input.knowledgeBaseIds)];
    if (knowledgeBaseIds && await this.prisma.knowledgeBase.count({ where: { tenantId, id: { in: knowledgeBaseIds } } }) !== knowledgeBaseIds.length) throw new BadRequestException('知识库不存在');
    if (input.knowledgeBaseIds === undefined && input.knowledgeBaseId && !(await this.prisma.knowledgeBase.findFirst({ where: { id: input.knowledgeBaseId, tenantId } }))) throw new BadRequestException('知识库不存在');
    const row = await this.prisma.wecomConnection.update({
      where: { id },
      data: {
        displayName: input.displayName ?? undefined,
        capability: input.capability ?? undefined,
        corpId: input.corpId === undefined ? undefined : input.corpId,
        agentId: input.agentId === undefined ? undefined : input.agentId,
        externalAccountId: input.externalAccountId === undefined ? undefined : input.externalAccountId,
        knowledgeBaseId: knowledgeBaseIds === undefined ? undefined : knowledgeBaseIds[0] ?? null,
        knowledgeBaseIds: knowledgeBaseIds === undefined ? undefined : knowledgeBaseIds,
        config:
          input.config === undefined
            ? undefined
            : ((input.config ?? Prisma.JsonNull) as Prisma.InputJsonValue),
        status: input.status ?? undefined,
        errorMessage:
          input.errorMessage === undefined ? undefined : input.errorMessage,
      },
    });
    return this.toWecomListItem(row);
  }

  private toWecomListItem(c: {
    id: string;
    tenantId: string;
    displayName: string;
    channelType: string;
    capability: string;
    status: string;
    lastEventAt: Date | null;
    errorMessage: string | null;
    corpId: string | null;
    agentId: string | null;
    externalAccountId: string | null;
    knowledgeBaseId: string | null;
    knowledgeBaseIds: string[];
    config: unknown;
  }): WecomConnection {
    return {
      id: c.id,
      tenantId: c.tenantId,
      displayName: c.displayName,
      channelType: c.channelType as 'wecom' | 'wecom_mock' | 'wechat_kf',
      capability: c.capability as WecomCapability,
      status: c.status as WecomStatus,
      lastEventAt: c.lastEventAt ? `今天 ${clock(c.lastEventAt)}` : null,
      errorMessage: c.errorMessage ?? undefined,
      corpId: c.corpId,
      agentId: c.agentId,
      externalAccountId: c.externalAccountId,
      knowledgeBaseId: c.knowledgeBaseId,
      knowledgeBaseIds: c.knowledgeBaseIds?.length ? c.knowledgeBaseIds : c.knowledgeBaseId ? [c.knowledgeBaseId] : [],
    };
  }

  async getWecomSnapshot(connectionId: string) {
    const connection = await this.prisma.wecomConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) throw new NotFoundException('WeCom connection not found');
    return {
      id: connection.id,
      tenantId: connection.tenantId,
      channelType: connection.channelType as 'wecom' | 'wecom_mock' | 'wechat_kf',
      capability: connection.capability as WecomCapability,
      status: connection.status,
      displayName: connection.displayName,
      corpId: connection.corpId,
      agentId: connection.agentId,
      externalAccountId: connection.externalAccountId,
      knowledgeBaseId: connection.knowledgeBaseId,
      knowledgeBaseIds: connection.knowledgeBaseIds?.length ? connection.knowledgeBaseIds : connection.knowledgeBaseId ? [connection.knowledgeBaseId] : [],
      config: (connection.config as Record<string, unknown> | null) ?? null,
      errorMessage: connection.errorMessage,
    };
  }

  async ingestNormalizedMessage(msg: NormalizedIncomingMessage) {
    const connection = await this.prisma.wecomConnection.findFirst({
      where: { id: msg.connectionId, tenantId: msg.tenantId },
    });
    if (!connection) throw new NotFoundException('WeCom connection not found');
    if (connection.status === 'disabled') {
      throw new BadRequestException('连接已停用');
    }

    const duplicate = await this.prisma.message.findFirst({
      where: {
        connectionId: msg.connectionId,
        externalMessageId: msg.externalMessageId,
        tenantId: msg.tenantId,
      },
    });
    if (duplicate) {
      return {
        duplicated: true,
        conversationId: duplicate.conversationId,
        message: {
          id: duplicate.id,
          conversationId: duplicate.conversationId,
          sender: duplicate.senderType,
          content: duplicate.content,
          createdAt: clock(duplicate.createdAt),
        },
      };
    }

    let conversation =
      (await this.prisma.conversation.findFirst({
        where: {
          tenantId: msg.tenantId,
          connectionId: msg.connectionId,
          externalConversationId: msg.externalConversationId,
          status: { not: 'closed' },
        },
      })) ??
      (await this.prisma.conversation.findFirst({
        where: {
          tenantId: msg.tenantId,
          connectionId: msg.connectionId,
          externalConversationId: msg.externalConversationId,
        },
        orderBy: { lastMessageAt: 'desc' },
      })) ??
      (await this.prisma.conversation.findFirst({
        where: {
          tenantId: msg.tenantId,
          connectionId: msg.connectionId,
          contactName: msg.contactName,
          status: { not: 'closed' },
        },
      }));

    const occurredAt = new Date(msg.occurredAt);
    const now = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
    const wantHuman =
      msg.senderType === 'customer' &&
      evaluateReplyPolicy([msg.content]).needsHuman;
    const tenant = await this.prisma.tenant.findUnique({ where: { id: msg.tenantId }, select: { defaultContactPolicy: true } });
    const externalUserId = msg.externalConversationId;
    const externalContact = await this.prisma.externalContact.upsert({
      where: { tenantId_connectionId_externalUserId: { tenantId: msg.tenantId, connectionId: msg.connectionId, externalUserId } },
      create: {
        id: newId('contact'), tenantId: msg.tenantId, connectionId: msg.connectionId,
        externalUserId, displayName: msg.contactName, source: connection.capability,
        policy: tenant?.defaultContactPolicy ?? 'ai',
      },
      update: { displayName: msg.contactName },
    });
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          id: newId('c'),
          tenantId: msg.tenantId,
          connectionId: msg.connectionId,
          externalConversationId: msg.externalConversationId,
          externalContactId: externalContact.id,
          contactName: msg.contactName,
          contactMeta: msg.contactMeta ?? '外部联系人',
          preview: msg.content,
          status: msg.senderType === 'agent'
            ? statusAfterAgentReply('open')
            : statusAfterCustomerInbound('open', { requestHuman: wantHuman }),
          handlingMode: wantHuman || msg.senderType === 'agent' ? 'human' : 'ai',
          contactPolicy: externalContact.policy,
          contactPolicyReason: externalContact.policyReason,
          contactPolicyActorId: externalContact.policyActorId,
          contactPolicyUpdatedAt: externalContact.policyUpdatedAt,
          unread: msg.senderType === 'customer',
          lastMessageAt: now,
        },
      });
      await this.prisma.message.create({
        data: {
          id: newId('m'),
          tenantId: msg.tenantId,
          conversationId: conversation.id,
          direction: 'internal',
          senderType: 'system',
          content:
            msg.channelType === 'wecom_mock'
              ? '会话已接入 · 企业微信模拟连接'
              : msg.channelType === 'wechat_kf'
                ? '会话已接入 · 微信客服'
                : '会话已接入 · 企业微信',
          createdAt: now,
        },
      });
    } else {
      const nextStatus = msg.senderType === 'customer'
        ? statusAfterCustomerInbound(conversation.status as ConversationStatus, { requestHuman: wantHuman })
        : msg.senderType === 'agent'
          ? statusAfterAgentReply(conversation.status as ConversationStatus)
          : conversation.status as ConversationStatus;
      const handlingMode = wantHuman || msg.senderType === 'agent' ? 'human' : conversation.handlingMode;
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          ...(conversation.externalConversationId
            ? {}
            : { externalConversationId: msg.externalConversationId }),
          externalContactId: externalContact.id,
          contactPolicy: externalContact.policy,
          contactPolicyReason: externalContact.policyReason,
          contactPolicyActorId: externalContact.policyActorId,
          contactPolicyUpdatedAt: externalContact.policyUpdatedAt,
          status: nextStatus,
          handlingMode,
          ...(msg.senderType === 'customer' ? { unread: true } : msg.senderType === 'agent' ? { unread: false } : {}),
          ...(wantHuman ? { contactPolicy: 'human' } : {}),
        },
      });
      conversation = {
        ...conversation,
        externalContactId: externalContact.id,
        contactPolicy: externalContact.policy,
        contactPolicyReason: externalContact.policyReason,
        contactPolicyActorId: externalContact.policyActorId,
        contactPolicyUpdatedAt: externalContact.policyUpdatedAt,
        status: nextStatus,
        handlingMode,
      };
    }

    if (!conversation) throw new NotFoundException('Conversation not found');

    let message;
    try {
      message = await this.prisma.message.create({
        data: {
          id: newId('m'),
          tenantId: msg.tenantId,
          conversationId: conversation.id,
          connectionId: msg.connectionId,
          externalMessageId: msg.externalMessageId,
          direction: 'inbound',
          senderType: msg.senderType,
          content: msg.content,
          createdAt: now,
        },
      });
    } catch (error) {
      // 并发双投下「先查再写」可能撞 unique，按已存在消息幂等返回
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.message.findFirst({
          where: {
            connectionId: msg.connectionId,
            externalMessageId: msg.externalMessageId,
            tenantId: msg.tenantId,
          },
        });
        if (existing) {
          return {
            duplicated: true,
            conversationId: existing.conversationId,
            message: {
              id: existing.id,
              conversationId: existing.conversationId,
              sender: existing.senderType,
              content: existing.content,
              createdAt: clock(existing.createdAt),
            },
          };
        }
      }
      throw error;
    }
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        preview: msg.content,
        ...(msg.senderType === 'customer' ? { unread: true } : msg.senderType === 'agent' ? { unread: false } : {}),
        lastMessageAt: now,
        status: conversation.status,
      },
    });
    await this.prisma.wecomConnection.update({
      where: { id: msg.connectionId },
      data: { lastEventAt: now },
    });

    return {
      duplicated: false,
      conversationId: conversation.id,
      message: {
        id: message.id,
        conversationId: conversation.id,
        sender: msg.senderType,
        content: msg.content,
        createdAt: clock(now),
      },
    };
  }

  async enqueueAutoDraftJob(input: { id: string; tenantId: string; conversationId: string; customerMessageId: string }) {
    await this.prisma.autoDraftJob.updateMany({
      where: { customerMessageId: input.customerMessageId, status: 'dead' },
      data: { status: 'queued', attempts: 0, runAt: new Date(), lastError: null },
    });
    await this.prisma.autoDraftJob.upsert({
      where: { customerMessageId: input.customerMessageId },
      create: { ...input },
      update: {},
    });
    return true;
  }

  async claimAutoDraftJobs(limit: number, leaseMs: number) {
    const rows = await this.prisma.$queryRaw<{
      id: string; tenant_id: string; conversation_id: string;
      customer_message_id: string; attempts: number; attempt_id: string;
    }[]>(Prisma.sql`
      WITH candidates AS (
        SELECT id FROM auto_draft_jobs
        WHERE (status = 'queued' AND run_at <= NOW())
           OR (status = 'running' AND locked_until < NOW())
        ORDER BY run_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      ), claimed AS (
      UPDATE auto_draft_jobs AS job
      SET status = 'running', attempts = job.attempts + 1,
          total_attempts = job.total_attempts + 1,
          locked_until = NOW() + (${leaseMs} * INTERVAL '1 millisecond'), updated_at = NOW()
      FROM candidates WHERE job.id = candidates.id
      RETURNING job.id, job.tenant_id, job.conversation_id, job.customer_message_id, job.attempts
      ), logged AS (
        INSERT INTO auto_draft_job_attempts (id, job_id, attempt_no, status, started_at)
        SELECT md5(random()::text || clock_timestamp()::text), id, attempts, 'running', NOW()
        FROM claimed
        RETURNING id, job_id
      )
      SELECT claimed.id, claimed.tenant_id, claimed.conversation_id,
             claimed.customer_message_id, claimed.attempts, logged.id AS attempt_id
      FROM claimed JOIN logged ON logged.job_id = claimed.id
    `);
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      conversationId: row.conversation_id,
      customerMessageId: row.customer_message_id,
      attempts: row.attempts,
      attemptId: row.attempt_id,
    }));
  }

  async completeAutoDraftJob(id: string, attemptId: string) {
    await this.prisma.$transaction([
      this.prisma.autoDraftJob.updateMany({
        where: { id, status: 'running' },
        data: { status: 'done', lockedUntil: null, lastError: null, completedAt: new Date() },
      }),
      this.prisma.autoDraftJobAttempt.updateMany({
        where: { id: attemptId, jobId: id, status: 'running' },
        data: { status: 'succeeded', finishedAt: new Date() },
      }),
    ]);
  }

  async retryAutoDraftJob(id: string, attemptId: string, attempts: number, error: string) {
    const terminal = attempts >= 8;
    const delayMs = Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 8));
    await this.prisma.$transaction([
      this.prisma.autoDraftJob.updateMany({
        where: { id, status: 'running' },
        data: {
          status: terminal ? 'dead' : 'queued',
          runAt: new Date(Date.now() + delayMs),
          lockedUntil: null,
          lastError: error.slice(0, 500),
          lastFailedAt: new Date(),
        },
      }),
      this.prisma.autoDraftJobAttempt.updateMany({
        where: { id: attemptId, jobId: id, status: 'running' },
        data: { status: 'failed', error: error.slice(0, 500), finishedAt: new Date() },
      }),
    ]);
  }

  async autoDraftJobMetrics(tenantId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [groups, oldest, finishedAttempts, failedAttempts, completedLast24Hours] = await Promise.all([
      this.prisma.autoDraftJob.groupBy({
        by: ['status'], where: { tenantId }, _count: { _all: true },
      }),
      this.prisma.autoDraftJob.findFirst({
        where: { tenantId, status: 'queued' },
        orderBy: { createdAt: 'asc' }, select: { createdAt: true },
      }),
      this.prisma.autoDraftJobAttempt.count({
        where: { startedAt: { gte: since }, status: { in: ['succeeded', 'failed'] }, job: { is: { tenantId } } },
      }),
      this.prisma.autoDraftJobAttempt.count({
        where: { startedAt: { gte: since }, status: 'failed', job: { is: { tenantId } } },
      }),
      this.prisma.autoDraftJob.count({
        where: { tenantId, completedAt: { gte: since } },
      }),
    ]);
    const count = (status: string) => groups.find((row) => row.status === status)?._count._all ?? 0;
    const oldestQueuedAt = oldest?.createdAt.toISOString() ?? null;
    return {
      queued: count('queued'),
      running: count('running'),
      dead: count('dead'),
      retrying: await this.prisma.autoDraftJob.count({ where: { tenantId, status: 'queued', attempts: { gt: 0 } } }),
      oldestQueuedAt,
      oldestWaitingSeconds: oldest
        ? Math.max(0, Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000))
        : 0,
      failedLast24Hours: failedAttempts,
      completedLast24Hours,
      attemptsLast24Hours: finishedAttempts,
      failureRateLast24Hours: finishedAttempts
        ? Math.round((failedAttempts / finishedAttempts) * 10_000) / 100
        : 0,
    };
  }

  async listDeadAutoDraftJobs(tenantId: string, limit: number) {
    const rows = await this.prisma.autoDraftJob.findMany({
      where: { tenantId, status: 'dead' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: { customerMessage: { select: { content: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      customerMessageId: row.customerMessageId,
      attempts: row.attempts,
      content: row.customerMessage.content,
      lastError: row.lastError,
      failedAt: row.updatedAt.toISOString(),
    }));
  }

  async requeueDeadAutoDraftJob(tenantId: string, id: string) {
    const result = await this.prisma.autoDraftJob.updateMany({
      where: { id, tenantId, status: 'dead' },
      data: {
        status: 'queued',
        attempts: 0,
        runAt: new Date(),
        lockedUntil: null,
        lastError: null,
        completedAt: null,
      },
    });
    return result.count === 1;
  }

  async disableWecom(tenantId: string, id: string): Promise<WecomConnection> {
    const connection = await this.prisma.wecomConnection.findFirst({
      where: { id, tenantId },
    });
    if (!connection) throw new NotFoundException('WeCom connection not found');
    const row = await this.prisma.wecomConnection.update({
      where: { id },
      data: { status: 'disabled' },
    });
    return this.toWecomListItem(row);
  }

  async deleteWecom(tenantId: string, id: string): Promise<void> {
    const connection = await this.prisma.wecomConnection.findFirst({
      where: { id, tenantId },
    });
    if (!connection) throw new NotFoundException('WeCom connection not found');
    if (connection.id === DEMO_CONNECTION_ID) {
      throw new BadRequestException('演示用模拟连接不可取消');
    }
    await this.prisma.$transaction([
      this.prisma.conversation.updateMany({
        where: { tenantId, connectionId: id },
        data: { connectionId: null },
      }),
      this.prisma.message.updateMany({
        where: { tenantId, connectionId: id },
        data: { connectionId: null },
      }),
      this.prisma.wecomConnection.delete({ where: { id } }),
    ]);
  }

  async injectMockMessage(
    tenantId: string,
    input: {
      connectionId?: string;
      contactName: string;
      content: string;
      externalMessageId?: string;
      conversationId?: string;
    },
  ) {
    const connectionId = input.connectionId ?? DEMO_CONNECTION_ID;
    const connection = await this.prisma.wecomConnection.findFirst({
      where: { id: connectionId, tenantId },
    });
    if (!connection) throw new NotFoundException('WeCom connection not found');
    if (connection.channelType !== 'wecom_mock') {
      throw new BadRequestException('仅模拟连接支持 inject');
    }
    if (connection.status === 'disabled') {
      throw new BadRequestException('连接已停用');
    }

    const externalMessageId = input.externalMessageId ?? newId('ext');
    const duplicate = await this.prisma.message.findFirst({
      where: { connectionId, externalMessageId, tenantId },
    });
    if (duplicate) {
      return {
        duplicated: true,
        conversationId: duplicate.conversationId,
        message: {
          id: duplicate.id,
          conversationId: duplicate.conversationId,
          sender: duplicate.senderType,
          content: duplicate.content,
          createdAt: clock(duplicate.createdAt),
        },
      };
    }

    let conversation = input.conversationId
      ? await this.prisma.conversation.findFirst({
          where: { id: input.conversationId, tenantId, connectionId },
        })
      : await this.prisma.conversation.findFirst({
          where: {
            tenantId,
            connectionId,
            contactName: input.contactName,
            status: { not: 'closed' },
          },
        });

    const now = new Date();
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          id: newId('c'),
          tenantId,
          connectionId,
          contactName: input.contactName,
          contactMeta: '外部联系人',
          preview: input.content,
          status: 'open',
          handlingMode: 'ai',
          unread: true,
          lastMessageAt: now,
        },
      });
      await this.prisma.message.create({
        data: {
          id: newId('m'),
          tenantId,
          conversationId: conversation.id,
          direction: 'internal',
          senderType: 'system',
          content: '会话已接入 · 企业微信模拟连接',
          createdAt: now,
        },
      });
    }

    const message = await this.prisma.message.create({
      data: {
        id: newId('m'),
        tenantId,
        conversationId: conversation.id,
        connectionId,
        externalMessageId,
        direction: 'inbound',
        senderType: 'customer',
        content: input.content,
        createdAt: now,
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        preview: input.content,
        unread: true,
        lastMessageAt: now,
        status: conversation.status === 'closed' ? 'open' : conversation.status,
      },
    });
    await this.prisma.wecomConnection.update({
      where: { id: connectionId },
      data: { lastEventAt: now },
    });

    return {
      duplicated: false,
      conversationId: conversation.id,
      message: {
        id: message.id,
        conversationId: conversation.id,
        sender: 'customer',
        content: input.content,
        createdAt: clock(now),
      },
    };
  }

  async createAuditLog(row: {
    id: string;
    tenantId: string;
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    detail: Record<string, unknown>;
    createdAt: string;
  }) {
    await this.prisma.auditLog.create({
      data: {
        id: row.id,
        tenantId: row.tenantId,
        actorId: row.actorId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        detail: row.detail as Prisma.InputJsonValue,
        createdAt: new Date(row.createdAt),
      },
    });
  }

  newId(prefix: string) {
    return newId(prefix);
  }

  async supportAnalytics(tenantId: string, period: AnalyticsPeriod = 'day') {
    const range = resolveAnalyticsRange(period);
    const since = range.prevStart;

    const [conversations, messages, drafts] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { tenantId },
        select: {
          id: true,
          status: true,
          unread: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.message.findMany({
        where: {
          tenantId,
          createdAt: { gte: since },
          senderType: { in: ['customer', 'agent', 'system'] },
        },
        select: {
          conversationId: true,
          senderType: true,
          createdAt: true,
        },
      }),
      this.prisma.replyDraft.findMany({
        where: { tenantId },
        select: {
          reviewStatus: true,
          citations: true,
          createdAt: true,
        },
      }),
    ]);

    return buildSupportAnalytics({
      period,
      conversations,
      messages,
      drafts,
      notes:
        '实时队列为当前快照；下方指标与趋势按所选时段统计，对比值为相对上一时段。首响取新建会话内客户首条消息到首条客服/系统回复。',
    });
  }

  async listAuditLogs(tenantId: string, query: AuditLogQuery) {
    const findActors = (term: string) => this.prisma.user.findMany({
          where: { OR: [
            { displayName: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
          ] },
          select: { id: true },
        });
    const [matchingActors, matchingQueryActors] = await Promise.all([
      query.actor ? findActors(query.actor) : Promise.resolve([]),
      query.q ? findActors(query.q) : Promise.resolve([]),
    ]);
    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to ? { createdAt: {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      } } : {}),
      ...(query.actor ? { actorId: { in: matchingActors.map((item) => item.id) } } : {}),
      ...(query.q ? { OR: [
        { action: { contains: query.q, mode: 'insensitive' } },
        { targetType: { contains: query.q, mode: 'insensitive' } },
        { targetId: { contains: query.q, mode: 'insensitive' } },
        { actorId: { in: matchingQueryActors.map((item) => item.id) } },
        ...['title', 'email', 'reason', 'reviewNote', 'policy', 'displayName', 'source'].map((key) => ({
          detail: { path: [key], string_contains: query.q, mode: 'insensitive' as const },
        })),
      ] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.actorId).filter((id): id is string => Boolean(id)))] } },
      select: { id: true, displayName: true },
    });
    const actorNames = new Map(actors.map((user) => [user.id, user.displayName]));
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        actorId: row.actorId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        detail: (row.detail as Record<string, unknown> | null) ?? {},
        createdAt: row.createdAt.toISOString(),
        actorName: row.actorId ? actorNames.get(row.actorId) ?? null : null,
      })),
    };
  }

  async listAiProviders(tenantId: string): Promise<AiProviderRecord[]> {
    const rows = await this.prisma.aiProviderSetting.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      baseUrl: row.baseUrl,
      model: row.model,
      apiKey: row.apiKey,
      active: row.active,
    }));
  }

  async upsertAiProvider(tenantId: string, row: AiProviderRecord) {
    await this.prisma.aiProviderSetting.upsert({
      where: { id: row.id },
      create: {
        id: row.id,
        tenantId,
        name: row.name,
        provider: row.provider,
        baseUrl: row.baseUrl,
        model: row.model,
        apiKey: row.apiKey,
        active: row.active,
      },
      update: {
        name: row.name,
        provider: row.provider,
        baseUrl: row.baseUrl,
        model: row.model,
        apiKey: row.apiKey,
        active: row.active,
      },
    });
  }

  async activateAiProvider(tenantId: string, id: string) {
    const found = await this.prisma.aiProviderSetting.findFirst({
      where: { id, tenantId },
    });
    if (!found) throw new NotFoundException('模型配置不存在');
    await this.prisma.$transaction([
      this.prisma.aiProviderSetting.updateMany({
        where: { tenantId },
        data: { active: false },
      }),
      this.prisma.aiProviderSetting.update({
        where: { id },
        data: { active: true },
      }),
    ]);
  }

  async deleteAiProvider(tenantId: string, id: string) {
    const current = await this.prisma.aiProviderSetting.findFirst({
      where: { id, tenantId },
    });
    if (!current) throw new NotFoundException('模型配置不存在');
    await this.prisma.aiProviderSetting.delete({ where: { id } });
    if (current.active) {
      const next = await this.prisma.aiProviderSetting.findFirst({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
      });
      if (next) {
        await this.prisma.aiProviderSetting.update({
          where: { id: next.id },
          data: { active: true },
        });
      }
    }
  }

  async findAccountByEmail(email: string): Promise<AuthAccount | null> {
    const row = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        status: 'active',
      },
    });
    if (!row?.passwordHash) return null;
    const memberships = await this.listMemberships(row.id);
    const current = memberships[0];
    if (!current) return null;
    return {
      passwordHash: row.passwordHash,
      tenant: current.tenant,
      memberships,
      user: {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        role: current.role,
        tenantId: current.tenant.id,
      },
    };
  }

  async listMemberships(userId: string): Promise<TenantMembership[]> {
    const rows = await this.prisma.tenantMember.findMany({
      where: { userId, status: 'active', tenant: { status: 'active' } },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      role: row.role,
      tenant: {
        id: row.tenant.id,
        name: row.tenant.name,
        slug: row.tenant.slug,
        autoSendEnabled: row.tenant.autoSendEnabled,
        defaultContactPolicy: row.tenant.defaultContactPolicy as ContactPolicy,
      },
    }));
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const row = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      autoSendEnabled: row.autoSendEnabled,
      defaultContactPolicy: row.defaultContactPolicy as ContactPolicy,
    };
  }

  async setTenantAutoSendEnabled(tenantId: string, enabled: boolean): Promise<Tenant> {
    const row = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { autoSendEnabled: enabled },
    });
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      autoSendEnabled: row.autoSendEnabled,
      defaultContactPolicy: row.defaultContactPolicy as ContactPolicy,
    };
  }

  async listTenantMembers(tenantId: string): Promise<TenantMemberRow[]> {
    const rows = await this.prisma.tenantMember.findMany({
      where: { tenantId, status: 'active' },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      userId: row.userId,
      email: row.user.email,
      displayName: row.user.displayName,
      role: row.role,
      status: row.status,
    }));
  }

  async inviteTenantMember(
    tenantId: string,
    input: {
      email: string;
      displayName: string;
      role: string;
      passwordHash: string;
    },
  ): Promise<TenantMemberRow> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const email = input.email.trim().toLowerCase();
    let user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          id: newId('user'),
          email,
          displayName: input.displayName.trim() || email,
          passwordHash: input.passwordHash,
          status: 'active',
        },
      });
    }
    const existing = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
    });
    if (existing?.status === 'active') {
      throw new BadRequestException('该成员已在当前租户中');
    }
    const member = existing
      ? await this.prisma.tenantMember.update({
          where: { tenantId_userId: { tenantId, userId: user.id } },
          data: { status: 'active', role: input.role },
        })
      : await this.prisma.tenantMember.create({
          data: {
            tenantId,
            userId: user.id,
            role: input.role,
            status: 'active',
          },
        });
    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      role: member.role,
      status: member.status,
    };
  }

  async updateTenantMemberRole(
    tenantId: string,
    userId: string,
    role: string,
  ): Promise<TenantMemberRow> {
    const member = await this.prisma.tenantMember.findFirst({
      where: { tenantId, userId, status: 'active' },
      include: { user: true },
    });
    if (!member) throw new NotFoundException('成员不存在');
    if (member.role === 'admin' && role !== 'admin') {
      const adminCount = await this.prisma.tenantMember.count({
        where: { tenantId, status: 'active', role: 'admin' },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('至少保留一名管理员');
      }
    }
    const updated = await this.prisma.tenantMember.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: { role },
      include: { user: true },
    });
    return {
      userId: updated.userId,
      email: updated.user.email,
      displayName: updated.user.displayName,
      role: updated.role,
      status: updated.status,
    };
  }

  async ensureUserPasswordHash(userId: string, passwordHash: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const data: { passwordHash?: string } = {};
    if (!user.passwordHash) data.passwordHash = passwordHash;
    if (Object.keys(data).length) {
      await this.prisma.user.update({ where: { id: userId }, data });
    }
    // 演示账号角色提升到 admin，避免旧种子「客服人员」无法改模型/渠道
    if (userId === DEMO_USER.id) {
      await this.prisma.tenantMember.updateMany({
        where: { userId: DEMO_USER.id, tenantId: DEMO_TENANT.id },
        data: { role: DEMO_USER.role },
      });
    }
  }

  async ensureDemoCustomer(passwordHash: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: DEMO_TENANT.id },
    });
    if (!tenant) return;

    for (const account of [DEMO_AGENT, ...DEMO_CUSTOMERS]) {
      await this.prisma.user.upsert({
        where: { id: account.id },
        create: {
          id: account.id,
          email: account.email,
          displayName: account.displayName,
          passwordHash,
          status: 'active',
        },
        update: {
          email: account.email,
          displayName: account.displayName,
          passwordHash,
          status: 'active',
        },
      });

      await this.prisma.tenantMember.upsert({
        where: {
          tenantId_userId: {
            tenantId: DEMO_TENANT.id,
            userId: account.id,
          },
        },
        create: {
          tenantId: DEMO_TENANT.id,
          userId: account.id,
          role: account.role,
          status: 'active',
        },
        update: {
          role: account.role,
          status: 'active',
        },
      });
    }

    const mock = createSeedWecomConnections().find(
      (item) => item.id === DEMO_CONNECTION_ID,
    );
    if (mock) {
      await this.prisma.wecomConnection.upsert({
        where: { id: DEMO_CONNECTION_ID },
        create: {
          id: mock.id,
          tenantId: mock.tenantId,
          channelType: mock.channelType,
          capability: mock.capability,
          displayName: mock.displayName,
          status: mock.status,
          corpId: null,
          agentId: null,
          config: {},
        },
        update: {
          status: 'connected',
          channelType: mock.channelType,
          capability: mock.capability,
          displayName: mock.displayName,
          errorMessage: null,
        },
      });
    }
  }
}
