import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAppStore } from './memory-app.store.js';
import { MemoryStore } from './memory.store.js';
import { DEMO_CONNECTION_ID, DEMO_TENANT, DEMO_USER } from './seed.js';

describe('tenant isolation (AppStore)', () => {
  let store: MemoryAppStore;

  beforeEach(() => {
    store = new MemoryAppStore(new MemoryStore());
  });

  it('blocks reading another tenant conversation', () => {
    const other = 'tenant-other';
    expect(() => store.getConversation(other, 'c1')).toThrow(NotFoundException);
    expect(store.getConversation(DEMO_TENANT.id, 'c1').id).toBe('c1');
  });

  it('isolates conversation messages, drafts, contacts and connection lists', () => {
    const other = 'tenant-other';
    expect(store.listConversations(other).items).toEqual([]);
    expect(() => store.messages(other, 'c1')).toThrow(NotFoundException);
    expect(() => store.draft(other, 'c1')).toThrow(NotFoundException);
    expect(() => store.getDraft(other, 'd1')).toThrow(NotFoundException);
    expect(store.listExternalContacts(other).items).toEqual([]);
    expect(store.listWecom(other).items).toEqual([]);
    expect(store.listTenantMembers(other)).toEqual([]);

    expect(
      store.setExternalContactPolicies(
        other,
        ['demo-contact-c1'],
        'blocked',
        'cross-tenant probe',
        DEMO_USER.id,
      ),
    ).toEqual({ updated: 0 });
    expect(
      store.listExternalContacts(DEMO_TENANT.id).items.find(
        (contact) => contact.id === 'demo-contact-c1',
      )?.policy,
    ).not.toBe('blocked');
  });

  it('searches knowledge body text', () => {
    const hit = store.listKnowledge(DEMO_TENANT.id, '企业抬头');
    expect(hit.items.some((doc) => doc.id === 'k3')).toBe(true);
  });

  it('updates a knowledge doc back to draft and blocks other tenants', () => {
    const updated = store.updateKnowledge(DEMO_TENANT.id, 'k1', {
      title: '退换货政策 FAQ',
      sourceType: 'faq',
      body: 'Q: 签收后多久可退货？\nA: 签收后 7 日内。',
    });
    expect(updated.status).toBe('draft');
    expect(store.readyKnowledgeForRetrieve(DEMO_TENANT.id).map((d) => d.id)).not.toContain(
      'k1',
    );
    expect(() =>
      store.archiveKnowledge('tenant-other', 'k1'),
    ).toThrow(NotFoundException);
    const archived = store.archiveKnowledge(DEMO_TENANT.id, 'k2');
    expect(archived.status).toBe('archived');
    store.deleteKnowledge(DEMO_TENANT.id, 'k3');
    expect(() => store.getKnowledge(DEMO_TENANT.id, 'k3')).toThrow(
      NotFoundException,
    );
    expect(() => store.deleteKnowledge('tenant-other', 'k4')).toThrow(
      NotFoundException,
    );
  });

  it('blocks reading another tenant knowledge doc', () => {
    expect(() => store.getKnowledge('tenant-other', 'k1')).toThrow(
      NotFoundException,
    );
    expect(store.getKnowledge(DEMO_TENANT.id, 'k1').id).toBe('k1');
  });

  it('blocks activating another tenant AI provider', () => {
    store.upsertAiProvider(DEMO_TENANT.id, {
      id: 'ai-1',
      name: 'demo',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'enc:fake',
      active: true,
    });
    expect(() => store.activateAiProvider('tenant-other', 'ai-1')).toThrow(
      NotFoundException,
    );
    store.activateAiProvider(DEMO_TENANT.id, 'ai-1');
  });

  it('assign only uses demo tenant membership in memory mode', () => {
    const conversation = store.assign(DEMO_TENANT.id, 'c1', {
      userId: DEMO_USER.id,
      displayName: DEMO_USER.displayName,
    });
    expect(conversation.assignee).toBe(DEMO_USER.displayName);
    expect(conversation.handlingMode).toBe('human');
  });

  it('setHandlingMode switches between ai and human', () => {
    const ai = store.setHandlingMode(DEMO_TENANT.id, 'c3', 'ai');
    expect(ai.handlingMode).toBe('ai');
    expect(ai.assignee).toBeNull();
    const human = store.setHandlingMode(DEMO_TENANT.id, 'c3', 'human', {
      userId: DEMO_USER.id,
      displayName: DEMO_USER.displayName,
    });
    expect(human.handlingMode).toBe('human');
    expect(human.assignee).toBe(DEMO_USER.displayName);
  });

  it('findAccountByEmail only returns demo account', () => {
    const hit = store.findAccountByEmail(DEMO_USER.email);
    expect(hit?.user.id).toBe(DEMO_USER.id);
    expect(hit?.memberships).toHaveLength(1);
    expect(store.findAccountByEmail('nobody@example.com')).toBeNull();
  });

  it('listMemberships is empty for unknown users', () => {
    expect(store.listMemberships('user-other')).toEqual([]);
    expect(store.listMemberships(DEMO_USER.id)[0]?.tenant.id).toBe(
      DEMO_TENANT.id,
    );
  });

  it('invites a member and keeps at least one admin', () => {
    const invited = store.inviteTenantMember(DEMO_TENANT.id, {
      email: 'agent2@demo.aikefu.local',
      displayName: '新客服',
      role: 'agent',
      passwordHash: 'scrypt$x$y',
    });
    expect(invited.role).toBe('agent');
    expect(store.listTenantMembers(DEMO_TENANT.id).length).toBeGreaterThan(1);
    expect(() =>
      store.updateTenantMemberRole(DEMO_TENANT.id, DEMO_USER.id, 'agent'),
    ).toThrow(/至少保留一名管理员/);
  });

  it('getTenant rejects unknown tenant', () => {
    expect(store.getTenant(DEMO_TENANT.id)?.id).toBe(DEMO_TENANT.id);
    expect(store.getTenant('tenant-other')).toBeNull();
  });

  it('claimDraftForSend rejects concurrent second claim', () => {
    const draft = store.claimDraftForSend(DEMO_TENANT.id, 'd1');
    expect(draft.reviewStatus).toBe('sending');
    expect(() => store.claimDraftForSend(DEMO_TENANT.id, 'd1')).toThrow(
      /正在发送/,
    );
  });

  it('reuses a queued outbound instead of creating another', () => {
    const first = store.prepareOutboundReply(DEMO_TENANT.id, 'c1', '同一条回复');
    const second = store.prepareOutboundReply(DEMO_TENANT.id, 'c1', '同一条回复');
    expect(second.messageId).toBe(first.messageId);
  });

  it('does not retry a reply already marked dispatching', () => {
    const prepared = store.prepareOutboundReply(DEMO_TENANT.id, 'c1', '待发送');
    store.markOutboundDispatching(prepared.messageId);
    const queued = store.listQueuedOutbound(
      new Date(Date.now() + 1000).toISOString(),
    );
    expect(queued.some((row) => row.messageId === prepared.messageId)).toBe(
      false,
    );
    const failed = store.failStaleDispatching(
      new Date(Date.now() + 1000).toISOString(),
    );
    expect(failed.some((row) => row.messageId === prepared.messageId)).toBe(
      true,
    );
  });

  it('releases sending drafts older than the cutoff', () => {
    const draft = store.claimDraftForSend(DEMO_TENANT.id, 'd2');
    draft.sendingStartedAt = new Date(Date.now() - 120_000).toISOString();
    const released = store.releaseStaleSendingDrafts(
      new Date(Date.now() - 60_000).toISOString(),
    );
    expect(released.map((row) => row.id)).toContain('d2');
    expect(store.getDraft(DEMO_TENANT.id, 'd2').reviewStatus).toBe(
      'send_failed',
    );
  });

  it('creates a real connection without returning secrets', () => {
    const created = store.createWecom(DEMO_TENANT.id, {
      channelType: 'wecom',
      displayName: '织云企礼 · 内部应用',
      capability: 'internal_app',
      corpId: 'ww-demo',
      agentId: '1000002',
      config: {
        secret: 'corp-secret-value',
        token: 'callback-token',
        encodingAesKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
      },
    });
    expect(created.status).toBe('pending_auth');
    expect(JSON.stringify(created)).not.toContain('corp-secret-value');
    const snapshot = store.getWecomSnapshot(created.id);
    expect(snapshot.corpId).toBe('ww-demo');
    expect(snapshot.config?.secret).toBe('corp-secret-value');
  });

  it('deletes a connection and keeps its conversations', () => {
    const created = store.createWecom(DEMO_TENANT.id, {
      channelType: 'wecom_mock',
      displayName: '模拟连接 1',
    });
    const ingested = store.ingestNormalizedMessage({
      tenantId: DEMO_TENANT.id,
      connectionId: created.id,
      channelType: 'wecom_mock',
      capability: 'internal_app',
      externalConversationId: 'mock-conv-delete',
      externalMessageId: 'mock-msg-delete',
      contactName: '测试客户',
      senderType: 'customer',
      content: '删除连接后会话还在',
      occurredAt: new Date().toISOString(),
    });
    store.deleteWecom(DEMO_TENANT.id, created.id);
    expect(
      store.listWecom(DEMO_TENANT.id).items.some((item) => item.id === created.id),
    ).toBe(false);
    const conversation = store.getConversation(
      DEMO_TENANT.id,
      ingested.conversationId,
    );
    expect(conversation.contactName).toBe('测试客户');
    expect(conversation.connectionId).toBe('');

    const real = store.createWecom(DEMO_TENANT.id, {
      channelType: 'wecom',
      displayName: '真实连接',
      capability: 'customer_contact',
      corpId: 'ww-temp',
      config: {
        secret: 's',
        token: 't',
        encodingAesKey: 'k'.repeat(43),
      },
    });
    store.deleteWecom(DEMO_TENANT.id, real.id);
    expect(
      store.listWecom(DEMO_TENANT.id).items.some((item) => item.id === real.id),
    ).toBe(false);

    expect(() => store.deleteWecom(DEMO_TENANT.id, DEMO_CONNECTION_ID)).toThrow(
      BadRequestException,
    );
  });
});
