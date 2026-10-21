import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { normalizeRole } from '../auth/roles.js';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import { chunkText, cosine } from './embed.js';
import { EmbedClient } from './embed-client.js';
import { extractUpload, MAX_IMPORT_FILES } from './document-import.js';
import {
  normalizeKnowledgeIndexSettings,
  type KnowledgeIndexSettings,
} from './knowledge-index-settings.js';
import {
  filterSufficientHits,
  isEvidenceSufficient,
  rankChunkHits,
  rankKnowledgeHits,
  type KnowledgeHit,
  type RetrieveDoc,
} from './knowledge-retrieve.js';

const AGENT_MUTABLE_STATUSES = new Set(['draft', 'pending', 'rejected']);

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    @Inject(APP_STORE) private readonly store: AppStore,
    private readonly audit: AuditService,
    private readonly embed: EmbedClient,
  ) {}

  listBases(tenantId: string) { return this.store.listKnowledgeBases(tenantId); }
  async createBase(_tenantId: string, _name: string) { throw new BadRequestException('本项目仅使用一个默认知识库'); }
  async updateBase(tenantId: string, id: string, name: string) {
    const base = await this.store.getDefaultKnowledgeBase(tenantId);
    if (id !== base.id || name.trim() !== base.name) throw new BadRequestException('项目知识库名称固定，不支持创建或重命名');
    return base;
  }
  async deleteBase(tenantId: string, id: string) {
    const base = await this.store.getDefaultKnowledgeBase(tenantId);
    if (id === base.id) throw new BadRequestException('项目默认知识库不能删除');
    throw new BadRequestException('本项目仅使用一个默认知识库');
  }
  async list(tenantId: string, q?: string, _categoryId?: string, _knowledgeBaseId?: string) {
    const baseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
    return this.store.listKnowledge(tenantId, q, undefined, baseId);
  }

  async listCategories(_tenantId: string, _knowledgeBaseId?: string) { return []; }
  listGaps(tenantId: string) { return this.store.listKnowledgeGaps(tenantId); }
  updateGap(tenantId: string, id: string, status: 'open' | 'in_progress' | 'resolved' | 'ignored') { return this.store.updateKnowledgeGap(tenantId, id, status); }

  async convertGapToFaq(tenantId: string, id: string, actorId: string) {
    const gap = (await this.store.listKnowledgeGaps(tenantId)).find((item) => item.id === id);
    if (!gap) throw new BadRequestException('未找到知识缺口');
    const knowledgeBaseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
    const created = await this.store.createKnowledge(tenantId, { title: `待补充：${gap.query.slice(0, 70)}`, sourceType: 'faq', body: `Q: ${gap.query}\nA: 待知识负责人补充并核实。`, knowledgeBaseId, status: 'pending' });
    this.audit.record({ tenantId, actorId, action: 'knowledge.gap.convert', targetType: 'knowledge_gap', targetId: id, detail: { documentId: created.id } });
    return created;
  }

  get(tenantId: string, id: string) {
    return this.store.getKnowledge(tenantId, id);
  }

  async getIndexSettings(tenantId: string): Promise<KnowledgeIndexSettings> {
    const current = await this.store.getKnowledgeIndexSettings(tenantId);
    return normalizeKnowledgeIndexSettings(current);
  }

  async updateIndexSettings(
    tenantId: string,
    input: Partial<KnowledgeIndexSettings>,
    actorId?: string,
  ): Promise<KnowledgeIndexSettings> {
    const next = normalizeKnowledgeIndexSettings({
      ...(await this.getIndexSettings(tenantId)),
      ...input,
    });
    const saved = await this.store.saveKnowledgeIndexSettings(tenantId, next);
    this.audit.record({
      tenantId,
      actorId,
      action: 'knowledge.index_settings.update',
      targetType: 'tenant',
      targetId: tenantId,
      detail: { ...saved },
    });
    return saved;
  }

  async create(
    tenantId: string,
    input: {
      title: string;
      sourceType: 'faq' | 'markdown';
      body: string;
      categoryId?: string | null;
      knowledgeBaseId?: string;
    },
    actor?: { id: string; role: string },
  ) {
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body) {
      throw new BadRequestException('请填写标题和正文');
    }
    const knowledgeBaseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
    const isAdmin = normalizeRole(actor?.role) === 'admin';
    const status = isAdmin ? 'draft' : 'pending';
    const created = await this.store.createKnowledge(tenantId, {
      title,
      sourceType: input.sourceType,
      body,
      categoryId: null,
      knowledgeBaseId,
      status,
    });
    this.audit.record({
      tenantId,
      actorId: actor?.id,
      action: 'knowledge.create',
      targetType: 'knowledge_document',
      targetId: created.id,
      detail: { title: created.title, status },
    });
    return created;
  }

  async submitQuestion(tenantId: string, question: string, actorId: string) {
    const normalized = question.trim().slice(0, 2000);
    if (!normalized) throw new BadRequestException('问题内容不能为空');
    const title = `待补充：${normalized.slice(0, 70)}`;
    const created = await this.store.createKnowledge(tenantId, {
      title,
      sourceType: 'faq',
      body: `Q: ${normalized}\nA: 待知识负责人补充并核实。`,
      status: 'pending',
    });
    this.audit.record({
      tenantId,
      actorId,
      action: 'knowledge.question_submitted',
      targetType: 'knowledge_document',
      targetId: created.id,
      detail: { title: created.title, source: 'conversation' },
    });
    return created;
  }

  async importUploads(
    tenantId: string,
    files: { originalname: string; buffer: Buffer; size: number }[],
    actor?: { id: string; role: string },
    categoryId?: string | null,
    knowledgeBaseId?: string,
  ) {
    if (!files.length) throw new BadRequestException('请选择文件');
    if (files.length > MAX_IMPORT_FILES) {
      throw new BadRequestException(`一次最多上传 ${MAX_IMPORT_FILES} 个文件`);
    }
    const items = [];
    const errors: { filename: string; message: string }[] = [];
    for (const file of files) {
      const filename = file.originalname || '未命名文档';
      try {
        const parsed = await extractUpload(filename, file.buffer);
        items.push(await this.create(tenantId, { ...parsed, categoryId, knowledgeBaseId }, actor));
      } catch (error) {
        errors.push({
          filename,
          message: error instanceof Error ? error.message : '解析失败',
        });
      }
    }
    if (!items.length) {
      throw new BadRequestException(errors[0]?.message ?? '没有导入成功的文件');
    }
    return { items, errors };
  }

  async publish(tenantId: string, id: string, actorId?: string) {
    const current = await this.store.getKnowledge(tenantId, id);
    if (!current.title.trim() || !current.body.trim()) {
      throw new BadRequestException('请填写标题和正文后再发布');
    }
    const published = await this.store.publishKnowledge(tenantId, id);
    try {
      const full = await this.store.getKnowledge(tenantId, id);
      await this.indexDocument(tenantId, full);
    } catch (error) {
      await this.store.updateKnowledge(tenantId, id, {
        title: current.title,
        sourceType: current.sourceType,
        body: current.body,
      });
      await this.store.replaceKnowledgeChunks(tenantId, id, []);
      this.logger.warn(
        `index failed for ${id}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      throw new BadRequestException(
        error instanceof Error
          ? `发布失败：${error.message}`
          : '发布失败：索引未完成',
      );
    }
    this.audit.record({
      tenantId,
      actorId,
      action: 'knowledge.publish',
      targetType: 'knowledge_document',
      targetId: id,
      detail: { title: published.title },
    });
    return published;
  }

  async update(
    tenantId: string,
    id: string,
    input: {
      title: string;
      sourceType: 'faq' | 'markdown';
      body: string;
      categoryId?: string | null;
      knowledgeBaseId?: string;
    },
    actor?: { id: string; role: string },
  ) {
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body) {
      throw new BadRequestException('请填写标题和正文');
    }
    const current = await this.store.getKnowledge(tenantId, id);
    const knowledgeBaseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
    const isAdmin = normalizeRole(actor?.role) === 'admin';
    if (!isAdmin && !AGENT_MUTABLE_STATUSES.has(current.status)) {
      throw new ForbiddenException('已发布或已下线的文档仅管理员可修改');
    }
    const nextStatus = isAdmin ? 'draft' : 'pending';
    const updated = await this.store.updateKnowledge(tenantId, id, {
      title,
      sourceType: input.sourceType,
      body,
      categoryId: null,
      knowledgeBaseId,
      status: nextStatus,
      reviewNote: isAdmin ? undefined : null,
    });
    await this.store.replaceKnowledgeChunks(tenantId, id, []);
    this.audit.record({
      tenantId,
      actorId: actor?.id,
      action: 'knowledge.update',
      targetType: 'knowledge_document',
      targetId: id,
      detail: { title, status: nextStatus },
    });
    return updated;
  }

  async reject(
    tenantId: string,
    id: string,
    reviewNote: string | undefined,
    actorId?: string,
  ) {
    const current = await this.store.getKnowledge(tenantId, id);
    if (current.status !== 'pending') {
      throw new BadRequestException('仅待审批的文档可以驳回');
    }
    const rejected = await this.store.rejectKnowledge(
      tenantId,
      id,
      reviewNote,
    );
    this.audit.record({
      tenantId,
      actorId,
      action: 'knowledge.reject',
      targetType: 'knowledge_document',
      targetId: id,
      detail: {
        title: rejected.title,
        reviewNote: rejected.reviewNote ?? null,
      },
    });
    return rejected;
  }

  async archive(tenantId: string, id: string, actorId?: string) {
    const archived = await this.store.archiveKnowledge(tenantId, id);
    await this.store.replaceKnowledgeChunks(tenantId, id, []);
    this.audit.record({
      tenantId,
      actorId,
      action: 'knowledge.archive',
      targetType: 'knowledge_document',
      targetId: id,
      detail: { title: archived.title },
    });
    return archived;
  }

  async remove(
    tenantId: string,
    id: string,
    actor?: { id: string; role: string },
  ) {
    const current = await this.store.getKnowledge(tenantId, id);
    if (
      normalizeRole(actor?.role) !== 'admin' &&
      !AGENT_MUTABLE_STATUSES.has(current.status)
    ) {
      throw new ForbiddenException('已发布或已下线的文档仅管理员可删除');
    }
    await this.store.deleteKnowledge(tenantId, id);
    this.audit.record({
      tenantId,
      actorId: actor?.id,
      action: 'knowledge.delete',
      targetType: 'knowledge_document',
      targetId: id,
      detail: { title: current.title },
    });
  }

  async retrieve(
    tenantId: string,
    query: string,
    limit = 3,
  ): Promise<KnowledgeHit[]> {
    const baseIds = [(await this.store.getDefaultKnowledgeBase(tenantId)).id];
    await Promise.all(baseIds.map((id) => this.ensureIndexed(tenantId, id)));
    const embedded = await this.embed.embedBatch(tenantId, [query]);
    const queryVec = embedded.vectors[0];
    const vectorCandidates = queryVec?.length
      ? await this.store.searchKnowledgeChunks(tenantId, baseIds, queryVec, Math.max(100, limit * 30))
      : [];
    const chunks = vectorCandidates.map((hit) => ({
      documentId: hit.documentId,
      title: hit.title,
      content: hit.content,
      embedding: [],
      vectorScore: hit.vectorScore,
    }));
    const hits = rankChunkHits(query, chunks, queryVec, cosine, limit);
    if (hits.length) return hits;

    const docs = await this.store.readyKnowledgeForRetrieve(tenantId, baseIds);
    const ranked = rankKnowledgeHits(query, docs, limit);
    return isEvidenceSufficient(ranked)
      ? filterSufficientHits(ranked).slice(0, limit)
      : [];
  }

  private async ensureIndexed(tenantId: string, knowledgeBaseId: string) {
    const docs = await this.store.readyKnowledgeForRetrieve(tenantId, knowledgeBaseId);
    const indexed = new Set(
      await this.store.indexedKnowledgeDocumentIds(tenantId, knowledgeBaseId),
    );
    for (const doc of docs) {
      if (!indexed.has(doc.id)) {
        await this.indexDocument(tenantId, doc);
      }
    }
  }

  private async indexDocument(tenantId: string, doc: RetrieveDoc) {
    const settings = await this.getIndexSettings(tenantId);
    const pieces = chunkText(
      doc.body ?? doc.excerpt,
      settings.chunkSize,
      settings.chunkOverlap,
      settings.maxChunksPerDoc,
    );
    const texts = pieces.map((content) => `${doc.title}\n${content}`);
    const embedded = await this.embed.embedBatch(tenantId, texts);
    const rows = pieces.map((content, ordinal) => ({
      id: this.store.newId('kc'),
      ordinal,
      title: doc.title,
      content,
      embedding: embedded.vectors[ordinal] ?? [],
    }));
    await this.store.replaceKnowledgeChunks(tenantId, doc.id, rows);
    this.logger.debug(
      `indexed ${doc.id} with ${embedded.source}${
        embedded.model ? `:${embedded.model}` : ''
      } (${rows.length} chunks; size=${settings.chunkSize}/overlap=${settings.chunkOverlap})`,
    );
  }
}
