import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service.js';
import { MemoryAppStore } from '../store/memory-app.store.js';
import { MemoryStore } from '../store/memory.store.js';
import { DEMO_TENANT } from '../store/seed.js';
import { KnowledgeService } from './knowledge.service.js';

function makeService() {
  const store = new MemoryAppStore(new MemoryStore());
  const audit = {
    record: () => undefined,
  } as unknown as AuditService;
  const embed = {
    embedBatch: async () => ({ vectors: [] }),
  } as never;
  return {
    store,
    service: new KnowledgeService(store, audit, embed),
  };
}

describe('knowledge approval', () => {
  it('agent create goes pending; admin create stays draft', async () => {
    const { service } = makeService();
    const agentDoc = await service.create(
      DEMO_TENANT.id,
      {
        title: '客服提交',
        sourceType: 'faq',
        body: 'Q: 测试？\nA: 回答',
      },
      { id: 'user-agent-demo', role: 'agent' },
    );
    expect(agentDoc.status).toBe('pending');

    const adminDoc = await service.create(
      DEMO_TENANT.id,
      {
        title: '管理员草稿',
        sourceType: 'faq',
        body: 'Q: 管理？\nA: 草稿',
      },
      { id: 'user-admin', role: 'admin' },
    );
    expect(adminDoc.status).toBe('draft');
  });

  it('admin can reject pending; agent resubmit clears note', async () => {
    const { service, store } = makeService();
    const created = await service.create(
      DEMO_TENANT.id,
      {
        title: '待驳回',
        sourceType: 'faq',
        body: 'Q: a？\nA: b',
      },
      { id: 'user-agent-demo', role: 'agent' },
    );
    const rejected = await service.reject(
      DEMO_TENANT.id,
      created.id,
      '内容不完整',
      'user-admin',
    );
    expect(rejected.status).toBe('rejected');
    expect(rejected.reviewNote).toBe('内容不完整');

    const updated = await service.update(
      DEMO_TENANT.id,
      created.id,
      {
        title: '待驳回',
        sourceType: 'faq',
        body: 'Q: a？\nA: 已补全',
      },
      { id: 'user-agent-demo', role: 'agent' },
    );
    expect(updated.status).toBe('pending');
    expect(store.getKnowledge(DEMO_TENANT.id, created.id).reviewNote).toBeNull();
  });

  it('agent cannot edit ready docs', async () => {
    const { service, store } = makeService();
    const created = await service.create(
      DEMO_TENANT.id,
      {
        title: '已发布文',
        sourceType: 'faq',
        body: 'Q: x？\nA: y',
      },
      { id: 'user-admin', role: 'admin' },
    );
    store.publishKnowledge(DEMO_TENANT.id, created.id);
    await expect(
      service.update(
        DEMO_TENANT.id,
        created.id,
        {
          title: '已发布文',
          sourceType: 'faq',
          body: 'Q: x？\nA: 改了',
        },
        { id: 'user-agent-demo', role: 'agent' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
