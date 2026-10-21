import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { chunkText, embedText } from '../knowledge/embed.js';
import {
  createSeedConversations,
  createSeedDrafts,
  createSeedKnowledge,
  createSeedMessages,
  createSeedWecomConnections,
  DEMO_AGENT,
  DEMO_CUSTOMERS,
  DEMO_PASSWORD_HASH,
  DEMO_TENANT,
  DEMO_USER,
} from './seed.js';
import type {
  Conversation,
  KnowledgeDoc,
  KnowledgeCategory,
  KnowledgeBase,
  KnowledgeGap,
  Message,
  ReplyDraft,
  Tenant,
  User,
  WecomConnection,
} from './types.js';

function buildSeedChunks(docs: KnowledgeDoc[]) {
  const chunks: {
    id: string;
    tenantId: string;
    documentId: string;
    title: string;
    ordinal: number;
    content: string;
    embedding: number[];
  }[] = [];
  for (const doc of docs) {
    if (doc.status !== 'ready') continue;
    const parts = chunkText(doc.body);
    parts.forEach((content, ordinal) => {
      chunks.push({
        id: `kc-seed-${doc.id}-${ordinal}`,
        tenantId: doc.tenantId,
        documentId: doc.id,
        title: doc.title,
        ordinal,
        content,
        embedding: embedText(`${doc.title}\n${content}`),
      });
    });
  }
  return chunks;
}

@Injectable()
export class MemoryStore {
  knowledgeBases: KnowledgeBase[] = [{ id: 'kb-demo-default', tenantId: DEMO_TENANT.id, name: '项目知识库', isDefault: true }];
  tenant: Tenant = { ...DEMO_TENANT };
  readonly user: User = DEMO_USER;
  conversations: Conversation[] = createSeedConversations().map((conversation) => ({
    ...conversation,
    contactPolicy: conversation.handlingMode,
    contactPolicyUpdatedAt: conversation.updatedAt,
    externalContactId: `demo-contact-${conversation.id}`,
  }));
  externalContacts: import('./types.js').ExternalContact[] = this.conversations.map((conversation) => ({
    id: conversation.externalContactId!,
    tenantId: conversation.tenantId,
    connectionId: conversation.connectionId,
    externalUserId: conversation.externalConversationId ?? `demo-user-${conversation.id}`,
    displayName: conversation.contactName,
    source: 'demo',
    policy: conversation.contactPolicy,
    policyReason: conversation.contactPolicyReason,
    policyActorId: conversation.contactPolicyActorId,
    policyUpdatedAt: conversation.contactPolicyUpdatedAt ?? new Date().toISOString(),
    conversationCount: 1,
    lastMessageAt: conversation.updatedAt,
  }));
  messages: Message[] = createSeedMessages();
  drafts: ReplyDraft[] = createSeedDrafts();
  knowledge: KnowledgeDoc[] = createSeedKnowledge().map((doc) => ({
    ...doc,
    knowledgeBaseId: 'kb-demo-default',
    categoryId: null,
  }));
  knowledgeCategories: KnowledgeCategory[] = [];
  knowledgeGaps: KnowledgeGap[] = [];
  knowledgeChunks: {
    id: string;
    tenantId: string;
    documentId: string;
    title: string;
    ordinal: number;
    content: string;
    embedding: number[];
  }[] = buildSeedChunks(this.knowledge);
  knowledgeIndexSettings = new Map<
    string,
    {
      chunkSize: number;
      chunkOverlap: number;
      maxChunksPerDoc: number;
    }
  >();
  wecomConnections: WecomConnection[] = createSeedWecomConnections().map((connection) => ({ ...connection, knowledgeBaseId: 'kb-demo-default' }));
  /** 内存模式保存真实连接的 CorpId / 凭证（列表不回传明文密钥）。 */
  wecomExtras = new Map<
    string,
    {
      corpId: string | null;
      agentId: string | null;
      externalAccountId: string | null;
      config: Record<string, unknown> | null;
    }
  >();
  auditLogs: {
    id: string;
    tenantId: string;
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    detail: Record<string, unknown>;
    createdAt: string;
  }[] = [];
  aiProviders: {
    id: string;
    tenantId: string;
    name: string;
    provider: string;
    baseUrl: string;
    model: string;
    apiKey: string;
    active: boolean;
  }[] = [];
  /** 内存模式下的账号与租户成员（演示可邀请）。 */
  accounts: {
    id: string;
    email: string;
    displayName: string;
    passwordHash: string;
  }[] = [
    {
      id: DEMO_USER.id,
      email: DEMO_USER.email,
      displayName: DEMO_USER.displayName,
      passwordHash: DEMO_PASSWORD_HASH,
    },
    {
      id: DEMO_AGENT.id,
      email: DEMO_AGENT.email,
      displayName: DEMO_AGENT.displayName,
      passwordHash: DEMO_PASSWORD_HASH,
    },
    ...DEMO_CUSTOMERS.map((customer) => ({
      id: customer.id,
      email: customer.email,
      displayName: customer.displayName,
      passwordHash: DEMO_PASSWORD_HASH,
    })),
  ];
  members: {
    tenantId: string;
    userId: string;
    role: string;
    status: string;
  }[] = [
    {
      tenantId: DEMO_TENANT.id,
      userId: DEMO_USER.id,
      role: DEMO_USER.role,
      status: 'active',
    },
    {
      tenantId: DEMO_TENANT.id,
      userId: DEMO_AGENT.id,
      role: DEMO_AGENT.role,
      status: 'active',
    },
    ...DEMO_CUSTOMERS.map((customer) => ({
      tenantId: DEMO_TENANT.id,
      userId: customer.id,
      role: customer.role,
      status: 'active',
    })),
  ];

  newId(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 8)}`;
  }

  nowClock(): string {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}
