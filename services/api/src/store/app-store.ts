import type { NormalizedIncomingMessage, ConnectionSnapshot } from '../wecom/adapter/types.js';
import type {
  AutoSendGuard,
  Conversation,
  ConversationStatus,
  ContactPolicy,
  ExternalContact,
  DocStatus,
  KnowledgeDoc,
  KnowledgeCategory,
  KnowledgeBase,
  KnowledgeGap,
  Message,
  ReplyDraft,
  Tenant,
  User,
  WecomCapability,
  WecomConnection,
  WecomStatus,
} from './types.js';

export const APP_STORE = Symbol('APP_STORE');

export type AuditLogRow = {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  actorName?: string | null;
};

export type AuditLogQuery = {
  page: number;
  pageSize: number;
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
  q?: string;
};

export type KnowledgeVectorHit = {
  id: string;
  documentId: string;
  title: string;
  content: string;
  vectorScore: number;
};

export type AiProviderRecord = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  active: boolean;
};

export type TenantMembership = {
  tenant: Tenant;
  role: string;
};

export type TenantMemberRow = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
};

export type AuthAccount = {
  user: User;
  tenant: Tenant;
  passwordHash: string;
  memberships: TenantMembership[];
};

export type AutoDraftJob = {
  id: string;
  tenantId: string;
  conversationId: string;
  customerMessageId: string;
  attempts: number;
};

export type ClaimedAutoDraftJob = AutoDraftJob & { attemptId: string };

export type DeadAutoDraftJob = AutoDraftJob & {
  content: string;
  lastError: string | null;
  failedAt: string;
};

export type AutoDraftJobMetrics = {
  queued: number;
  running: number;
  dead: number;
  retrying: number;
  oldestQueuedAt: string | null;
  oldestWaitingSeconds: number;
  failedLast24Hours: number;
  completedLast24Hours: number;
  attemptsLast24Hours: number;
  failureRateLast24Hours: number;
};

/** 业务层统一存储契约；memory / prisma 各自实现，服务不再分叉。 */
export interface AppStore {
  listConversations(
    tenantId: string,
    status?: ConversationStatus,
    q?: string,
  ): Promise<{ items: Conversation[] }> | { items: Conversation[] };

  getConversation(
    tenantId: string,
    id: string,
  ): Promise<Conversation> | Conversation;

  messages(
    tenantId: string,
    conversationId: string,
  ): Promise<{ items: Message[] }> | { items: Message[] };

  draft(
    tenantId: string,
    conversationId: string,
  ): Promise<ReplyDraft | null> | ReplyDraft | null;

  getDraft(tenantId: string, id: string): Promise<ReplyDraft> | ReplyDraft;

  assign(
    tenantId: string,
    id: string,
    assignee: { userId: string; displayName: string },
  ): Promise<Conversation> | Conversation;

  setHandlingMode(
    tenantId: string,
    id: string,
    mode: 'ai' | 'human',
    assignee?: { userId: string; displayName: string },
  ): Promise<Conversation> | Conversation;

  setContactPolicy(
    tenantId: string,
    id: string,
    policy: ContactPolicy,
    reason: string,
    actorId: string,
  ): Promise<Conversation> | Conversation;

  setDefaultContactPolicy(
    tenantId: string,
    policy: ContactPolicy,
  ): Promise<Tenant> | Tenant;

  listExternalContacts(
    tenantId: string,
    input?: { q?: string; policy?: ContactPolicy },
  ): Promise<{ items: ExternalContact[] }> | { items: ExternalContact[] };

  setExternalContactPolicies(
    tenantId: string,
    ids: string[],
    policy: ContactPolicy,
    reason: string,
    actorId: string,
  ): Promise<{ updated: number }> | { updated: number };

  escalate(
    tenantId: string,
    id: string,
    reason?: string,
  ): Promise<Conversation> | Conversation;

  close(tenantId: string, id: string): Promise<Conversation> | Conversation;

  markRead(tenantId: string, id: string): Promise<Conversation> | Conversation;

  supersedePendingDrafts(
    tenantId: string,
    conversationId: string,
  ): Promise<void> | void;

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
  ): Promise<ReplyDraft> | ReplyDraft;

  updateDraft(
    tenantId: string,
    id: string,
    content: string,
  ): Promise<unknown> | unknown;

  /**
   * 原子抢占发送权：仅 pending / send_failed → sending。
   * 并发二次调用会失败，避免重复出站。
   */
  claimDraftForSend(
    tenantId: string,
    id: string,
  ): Promise<ReplyDraft> | ReplyDraft;

  /** 将超时仍处于 sending 的草稿回退为 send_failed，便于重试。 */
  releaseStaleSendingDrafts(
    olderThanIso: string,
  ):
    | Promise<{ id: string; tenantId: string; conversationId: string }[]>
    | { id: string; tenantId: string; conversationId: string }[];

  reviewDraft(
    tenantId: string,
    id: string,
    reviewStatus: 'accepted' | 'rejected' | 'superseded' | 'send_failed',
  ): Promise<ReplyDraft> | ReplyDraft;

  createAuditLog(row: AuditLogRow): Promise<void> | void;

  listAuditLogs(
    tenantId: string,
    query: AuditLogQuery,
  ): Promise<{ items: AuditLogRow[]; total: number }> | { items: AuditLogRow[]; total: number };

  newId(prefix: string): string;

  listKnowledge(
    tenantId: string,
    q?: string,
    categoryId?: string,
    knowledgeBaseId?: string,
  ): Promise<{ items: Omit<KnowledgeDoc, 'body' | 'tenantId'>[] }> | {
    items: Omit<KnowledgeDoc, 'body' | 'tenantId'>[];
  };

  getKnowledge(tenantId: string, id: string): Promise<KnowledgeDoc> | KnowledgeDoc;

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
  ): Promise<Omit<KnowledgeDoc, 'body' | 'tenantId'>> | Omit<
    KnowledgeDoc,
    'body' | 'tenantId'
  >;

  publishKnowledge(
    tenantId: string,
    id: string,
  ): Promise<Omit<KnowledgeDoc, 'body' | 'tenantId'>> | Omit<
    KnowledgeDoc,
    'body' | 'tenantId'
  >;

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
  ): Promise<Omit<KnowledgeDoc, 'body' | 'tenantId'>> | Omit<
    KnowledgeDoc,
    'body' | 'tenantId'
  >;

  rejectKnowledge(
    tenantId: string,
    id: string,
    reviewNote?: string | null,
  ): Promise<Omit<KnowledgeDoc, 'body' | 'tenantId'>> | Omit<
    KnowledgeDoc,
    'body' | 'tenantId'
  >;

  archiveKnowledge(
    tenantId: string,
    id: string,
  ): Promise<Omit<KnowledgeDoc, 'body' | 'tenantId'>> | Omit<
    KnowledgeDoc,
    'body' | 'tenantId'
  >;

  deleteKnowledge(tenantId: string, id: string): Promise<void> | void;

  listKnowledgeBases(tenantId: string): Promise<KnowledgeBase[]> | KnowledgeBase[];
  getDefaultKnowledgeBase(tenantId: string): Promise<KnowledgeBase> | KnowledgeBase;
  createKnowledgeBase(tenantId: string, name: string): Promise<KnowledgeBase> | KnowledgeBase;
  updateKnowledgeBase(tenantId: string, id: string, name: string): Promise<KnowledgeBase> | KnowledgeBase;
  deleteKnowledgeBase(tenantId: string, id: string): Promise<void> | void;
  listKnowledgeCategories(tenantId: string, knowledgeBaseId: string): Promise<KnowledgeCategory[]> | KnowledgeCategory[];
  recordKnowledgeGap(input: { tenantId: string; conversationId: string; customerMessageId: string; query: string; knowledgeBaseId?: string }): Promise<void> | void;
  listKnowledgeGaps(tenantId: string): Promise<KnowledgeGap[]> | KnowledgeGap[];
  updateKnowledgeGap(tenantId: string, id: string, status: KnowledgeGap['status']): Promise<KnowledgeGap> | KnowledgeGap;

  readyKnowledgeForRetrieve(tenantId: string, knowledgeBaseId?: string | string[]): Promise<
    { id: string; title: string; excerpt: string; body?: string }[]
  > | { id: string; title: string; excerpt: string; body?: string }[];

  indexedKnowledgeDocumentIds(tenantId: string, knowledgeBaseId?: string | string[]): Promise<string[]> | string[];

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
  ): Promise<void> | void;

  searchKnowledgeChunks(
    tenantId: string,
    knowledgeBaseIds: string[],
    queryEmbedding: number[],
    limit: number,
  ): Promise<KnowledgeVectorHit[]> | KnowledgeVectorHit[];

  getKnowledgeIndexSettings(tenantId: string): Promise<{
    chunkSize: number;
    chunkOverlap: number;
    maxChunksPerDoc: number;
  }> | {
    chunkSize: number;
    chunkOverlap: number;
    maxChunksPerDoc: number;
  };

  saveKnowledgeIndexSettings(
    tenantId: string,
    input: {
      chunkSize: number;
      chunkOverlap: number;
      maxChunksPerDoc: number;
    },
  ): Promise<{
    chunkSize: number;
    chunkOverlap: number;
    maxChunksPerDoc: number;
  }> | {
    chunkSize: number;
    chunkOverlap: number;
    maxChunksPerDoc: number;
  };

  listWecom(tenantId: string): Promise<{ items: WecomConnection[] }> | {
    items: WecomConnection[];
  };

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
  ): Promise<WecomConnection> | WecomConnection;

  disableWecom(
    tenantId: string,
    id: string,
  ): Promise<WecomConnection> | WecomConnection;

  updateWecom(
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
  ): Promise<WecomConnection> | WecomConnection;

  deleteWecom(tenantId: string, id: string): Promise<void> | void;

  getWecomSnapshot(connectionId: string): Promise<ConnectionSnapshot> | ConnectionSnapshot;

  ingestNormalizedMessage(
    msg: NormalizedIncomingMessage,
  ): Promise<{
    duplicated: boolean;
    conversationId: string;
    message: { id: string; conversationId: string; sender: string; content: string; createdAt: string };
  }> | {
    duplicated: boolean;
    conversationId: string;
    message: { id: string; conversationId: string; sender: string; content: string; createdAt: string };
  };

  enqueueAutoDraftJob(input: Omit<AutoDraftJob, 'attempts'>): Promise<boolean> | boolean;
  claimAutoDraftJobs(limit: number, leaseMs: number): Promise<ClaimedAutoDraftJob[]> | ClaimedAutoDraftJob[];
  completeAutoDraftJob(id: string, attemptId: string): Promise<void> | void;
  retryAutoDraftJob(id: string, attemptId: string, attempts: number, error: string): Promise<void> | void;
  listDeadAutoDraftJobs(tenantId: string, limit: number): Promise<DeadAutoDraftJob[]> | DeadAutoDraftJob[];
  requeueDeadAutoDraftJob(tenantId: string, id: string): Promise<boolean> | boolean;
  autoDraftJobMetrics(tenantId: string): Promise<AutoDraftJobMetrics> | AutoDraftJobMetrics;

  prepareOutboundReply(
    tenantId: string,
    conversationId: string,
    content: string,
    autoSendGuard?: AutoSendGuard,
  ): Promise<{
    messageId: string;
    idempotencyKey: string;
    connectionId: string | null;
    externalConversationId?: string;
    autoSendGuard?: AutoSendGuard;
    message: {
      id: string;
      tenantId?: string;
      conversationId: string;
      sender: 'agent';
      content: string;
      createdAt: string;
      deliveryStatus?: string;
    };
  }> | {
    messageId: string;
    idempotencyKey: string;
    connectionId: string | null;
    externalConversationId?: string;
    autoSendGuard?: AutoSendGuard;
    message: {
      id: string;
      tenantId?: string;
      conversationId: string;
      sender: 'agent';
      content: string;
      createdAt: string;
      deliveryStatus?: string;
    };
  };

  markOutboundDispatching(messageId: string): Promise<boolean> | boolean;

  listQueuedOutbound(olderThanIso: string): Promise<
    {
      messageId: string;
      tenantId: string;
      conversationId: string;
      content: string;
      idempotencyKey: string;
      connectionId: string | null;
      externalConversationId?: string;
      autoSendGuard?: AutoSendGuard;
    }[]
  > | {
    messageId: string;
    tenantId: string;
    conversationId: string;
    content: string;
    idempotencyKey: string;
    connectionId: string | null;
    externalConversationId?: string;
    autoSendGuard?: AutoSendGuard;
  }[];

  failStaleDispatching(olderThanIso: string): Promise<
    { messageId: string; tenantId: string; conversationId: string }[]
  > | { messageId: string; tenantId: string; conversationId: string }[];

  finalizeOutboundReply(
    messageId: string,
    result: { status: string; externalMessageId?: string },
  ): Promise<{
    id: string;
    tenantId?: string;
    conversationId: string;
    sender: 'agent';
    content: string;
    createdAt: string;
    deliveryStatus?: string;
  }> | {
    id: string;
    tenantId?: string;
    conversationId: string;
    sender: 'agent';
    content: string;
    createdAt: string;
    deliveryStatus?: string;
  };

  supportAnalytics(
    tenantId: string,
    period?: import('../analytics/analytics-range.js').AnalyticsPeriod,
  ):
    | Promise<import('../analytics/support-analytics.types.js').SupportAnalyticsResult>
    | import('../analytics/support-analytics.types.js').SupportAnalyticsResult;

  listAiProviders(
    tenantId: string,
  ): Promise<AiProviderRecord[]> | AiProviderRecord[];

  upsertAiProvider(
    tenantId: string,
    row: AiProviderRecord,
  ): Promise<void> | void;

  activateAiProvider(tenantId: string, id: string): Promise<void> | void;

  deleteAiProvider(tenantId: string, id: string): Promise<void> | void;

  findAccountByEmail(email: string): Promise<AuthAccount | null> | AuthAccount | null;

  listMemberships(
    userId: string,
  ): Promise<TenantMembership[]> | TenantMembership[];

  listTenantMembers(
    tenantId: string,
  ): Promise<TenantMemberRow[]> | TenantMemberRow[];

  inviteTenantMember(
    tenantId: string,
    input: {
      email: string;
      displayName: string;
      role: string;
      passwordHash: string;
    },
  ): Promise<TenantMemberRow> | TenantMemberRow;

  updateTenantMemberRole(
    tenantId: string,
    userId: string,
    role: string,
  ): Promise<TenantMemberRow> | TenantMemberRow;

  getTenant(tenantId: string): Promise<Tenant | null> | Tenant | null;

  setTenantAutoSendEnabled(tenantId: string, enabled: boolean): Promise<Tenant> | Tenant;

  ensureUserPasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> | void;

  /** 确保演示客服与客户账号存在（已有库也会补齐）。 */
  ensureDemoCustomer(
    passwordHash: string,
  ): Promise<void> | void;
}
