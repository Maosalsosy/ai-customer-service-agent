export type ConversationStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_human'
  | 'closed';

/** 会话处理模式：AI 自动回复，或人工接管。 */
export type HandlingMode = 'ai' | 'human';
export type ContactPolicy = 'ai' | 'human' | 'paused' | 'blocked';

export type MessageSender = 'customer' | 'agent' | 'system';

export interface AutoSendGuard {
  draftId: string;
  expectedCustomerMessageId: string;
}

export type DocStatus =
  | 'draft'
  | 'pending'
  | 'rejected'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'archived';

export type WecomStatus =
  | 'draft'
  | 'pending_auth'
  | 'connected'
  | 'error'
  | 'disabled';

/** Includes legacy values only so existing database records remain readable. */
export type WecomCapability =
  | 'internal_app'
  | 'customer_contact'
  | 'wechat_kf';

export type AiReplyTone = 'direct' | 'warm' | 'formal';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  autoSendEnabled: boolean;
  /** HH:mm，空表示不限制时段 */
  autoSendWindowStart: string | null;
  autoSendWindowEnd: string | null;
  autoSendTimezone: string;
  defaultContactPolicy: ContactPolicy;
  aiTone: AiReplyTone;
  aiPersona: string;
  aiSystemPrompt: string;
  aiMaxLength: number;
}

export interface ExternalContact {
  id: string;
  tenantId: string;
  connectionId: string;
  externalUserId: string;
  displayName: string;
  source: string;
  policy: ContactPolicy;
  policyReason?: string;
  policyActorId?: string;
  policyUpdatedAt: string;
  conversationCount: number;
  lastMessageAt: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  tenantId: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  connectionId: string;
  externalConversationId?: string;
  externalContactId?: string;
  contactName: string;
  contactMeta?: string;
  preview: string;
  status: ConversationStatus;
  handlingMode: HandlingMode;
  contactPolicy: ContactPolicy;
  contactPolicyReason?: string;
  contactPolicyActorId?: string;
  contactPolicyUpdatedAt?: string;
  assignee: string | null;
  updatedAt: string;
  unread: boolean;
}

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  externalMessageId?: string;
  sender: MessageSender;
  content: string;
  createdAt: string;
  /** Epoch timestamp for channel delivery windows; the UI uses createdAt. */
  createdAtMs?: number;
  deliveryStatus?: string;
  /** 出站排队/派发时间，用于 outbox 重试判断。 */
  outboxAt?: string;
  /** 自动出站恢复派发前的策略门禁；不会通过消息列表 API 返回。 */
  autoSendGuard?: AutoSendGuard;
}

export interface ReplyDraft {
  id: string;
  tenantId: string;
  conversationId: string;
  content: string;
  status: 'pending' | 'needs_human';
  reason?: string;
  citations: { documentTitle: string; quote: string; documentId?: string; documentVersion?: number }[];
  reviewStatus:
    | 'pending'
    | 'sending'
    | 'accepted'
    | 'edited'
    | 'rejected'
    | 'escalated'
    | 'superseded'
    | 'send_failed';
  model?: { provider: string; name: string };
  /** 内存模式记录进入 sending 的时间，用于超时回退。 */
  sendingStartedAt?: string;
}

export interface KnowledgeDoc {
  id: string;
  tenantId: string;
  categoryId?: string | null;
  knowledgeBaseId?: string;
  categoryName?: string | null;
  title: string;
  sourceType: 'faq' | 'markdown';
  status: DocStatus;
  updatedAt: string;
  excerpt: string;
  reviewNote?: string | null;
  version?: number;
  body: string;
}

export interface KnowledgeCategory {
  id: string;
  tenantId: string;
  knowledgeBaseId: string;
  name: string;
  sortOrder: number;
  documentCount?: number;
}

export interface KnowledgeBase {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
  documentCount?: number;
  connectionCount?: number;
}

export interface KnowledgeGap {
  id: string;
  tenantId: string;
  conversationId: string;
  customerMessageId: string;
  query: string;
  status: 'open' | 'in_progress' | 'resolved' | 'ignored';
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  contactName: string;
  knowledgeBaseId?: string;
}

export interface WecomConnection {
  id: string;
  tenantId: string;
  displayName: string;
  channelType: 'wecom' | 'wecom_mock' | 'wechat_kf';
  capability: WecomCapability;
  status: WecomStatus;
  lastEventAt: string | null;
  errorMessage?: string;
  /** 列表安全字段：不含 Secret / Token 明文 */
  corpId?: string | null;
  agentId?: string | null;
  knowledgeBaseId?: string | null;
  knowledgeBaseIds?: string[];
  externalAccountId?: string | null;
}
