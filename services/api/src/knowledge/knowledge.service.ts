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

function normalizeSupplementQuestion(question: string) {
  return question.trim().replace(/\s+/g, ' ').slice(0, 2000);
}

/** 过滤纯标点/表情等无意义「问题」，避免生成「待补充：？？？」类垃圾条目。 */
function isMeaningfulSupplementQuestion(question: string) {
  const meaningful = question.replace(/[\s\p{P}\p{S}]+/gu, '');
  return meaningful.length >= 2;
}

function pendingSupplementTitle(question: string) {
  return `待补充：${question.slice(0, 70)}`;
}

function pendingSupplementBody(question: string) {
  return `Q: ${question}\nA: 待知识负责人补充并核实。`;
}

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
  async list(
    tenantId: string,
    q?: string,
    _categoryId?: string,
    _knowledgeBaseId?: string,
    opts?: { limit?: number; offset?: number; status?: string },
  ) {
    const baseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
    const status =
      opts?.status === 'draft' ||
      opts?.status === 'pending' ||
      opts?.status === 'rejected' ||
      opts?.status === 'processing' ||
      opts?.status === 'ready' ||
      opts?.status === 'failed' ||
      opts?.status === 'archived'
        ? opts.status
        : undefined;
    return this.store.listKnowledge(tenantId, q, undefined, baseId, {
      limit: opts?.limit,
      offset: opts?.offset,
      status,
    });
  }

  async listCategories(_tenantId: string, _knowledgeBaseId?: string) { return []; }
  listGaps(tenantId: string) { return this.store.listKnowledgeGaps(tenantId); }
  updateGap(tenantId: string, id: string, status: 'open' | 'in_progress' | 'resolved' | 'ignored') { return this.store.updateKnowledgeGap(tenantId, id, status); }

  async convertGapToFaq(tenantId: string, id: string, actorId: string) {
    let gap;
    try {
      gap = await this.store.getKnowledgeGap(tenantId, id);
    } catch {
      throw new BadRequestException('未找到知识缺口');
    }
    if (gap.status === 'resolved' || gap.status === 'ignored') {
      throw new BadRequestException('该知识缺口已处理');
    }
    const question = normalizeSupplementQuestion(gap.query);
    if (!isMeaningfulSupplementQuestion(question)) {
      await this.store.updateKnowledgeGap(tenantId, id, 'ignored');
      throw new BadRequestException('该缺口问题无效（如纯标点），已自动忽略');
    }
    const existing = await this.findPendingSupplement(tenantId, question);
    if (existing) {
      await this.store.updateKnowledgeGap(tenantId, id, 'resolved');
      this.audit.record({
        tenantId,
        actorId,
        action: 'knowledge.gap.convert',
        targetType: 'knowledge_gap',
        targetId: id,
        detail: {
          documentId: existing.id,
          title: existing.title,
          reused: true,
        },
      });
      return existing;
    }
    const knowledgeBaseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
    const created = await this.store.createKnowledge(tenantId, {
      title: pendingSupplementTitle(question),
      sourceType: 'faq',
      body: pendingSupplementBody(question),
      knowledgeBaseId,
      status: 'pending',
    });
    await this.store.updateKnowledgeGap(tenantId, id, 'resolved');
    this.audit.record({
      tenantId,
      actorId,
      action: 'knowledge.gap.convert',
      targetType: 'knowledge_gap',
      targetId: id,
      detail: { documentId: created.id, title: created.title },
    });
    return created;
  }

  private async findPendingSupplement(tenantId: string, question: string) {
    const title = pendingSupplementTitle(question);
    const listed = await this.store.listKnowledge(tenantId, title, undefined, undefined, {
      status: 'pending',
      limit: 50,
    });
    const hit = listed.items.find((item) => item.title === title);
    if (!hit) return null;
    return this.store.getKnowledge(tenantId, hit.id);
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
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';
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
    const normalized = normalizeSupplementQuestion(question);
    if (!normalized) throw new BadRequestException('问题内容不能为空');
    if (!isMeaningfulSupplementQuestion(normalized)) {
      throw new BadRequestException('请提交有实际内容的客户问题，不要只用问号或标点');
    }
    const existing = await this.findPendingSupplement(tenantId, normalized);
    if (existing) {
      await this.resolveOpenGapsForQuery(tenantId, normalized);
      return existing;
    }
    const created = await this.store.createKnowledge(tenantId, {
      title: pendingSupplementTitle(normalized),
      sourceType: 'faq',
      body: pendingSupplementBody(normalized),
      status: 'pending',
    });
    await this.resolveOpenGapsForQuery(tenantId, normalized);
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

  private async resolveOpenGapsForQuery(tenantId: string, question: string) {
    const gaps = await this.store.listKnowledgeGaps(tenantId);
    const normalized = normalizeSupplementQuestion(question);
    await Promise.all(
      gaps
        .filter(
          (gap) =>
            (gap.status === 'open' || gap.status === 'in_progress') &&
            normalizeSupplementQuestion(gap.query) === normalized,
        )
        .map((gap) => this.store.updateKnowledgeGap(tenantId, gap.id, 'resolved')),
    );
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
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';
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
    // 索引仅在发布/补索引时写入；检索路径不再懒加载 embedding，避免拖慢回复。

    let queryVec: number[] | undefined;
    try {
      const embedded = await this.embed.embedBatch(tenantId, [query]);
      queryVec = embedded.vectors[0];
      if (embedded.source === 'hash') {
        this.logger.debug('retrieve using hash query vectors (dev fallback)');
      }
    } catch (error) {
      this.logger.warn(
        `embedding unavailable for retrieve, lexical only: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }

    if (queryVec?.length) {
      const vectorCandidates = await this.store.searchKnowledgeChunks(
        tenantId,
        baseIds,
        queryVec,
        Math.max(100, limit * 30),
      );
      const chunks = vectorCandidates.map((hit) => ({
        documentId: hit.documentId,
        title: hit.title,
        content: hit.content,
        embedding: [],
        vectorScore: hit.vectorScore,
      }));
      const hits = rankChunkHits(query, chunks, queryVec, cosine, limit);
      if (hits.length) return hits;
    }

    const docs = await this.store.readyKnowledgeForRetrieve(tenantId, baseIds);
    const ranked = rankKnowledgeHits(query, docs, limit);
    return isEvidenceSufficient(ranked)
      ? filterSufficientHits(ranked).slice(0, limit)
      : [];
  }

  /** 工作台试检索：返回命中与索引概览，不触发补索引。 */
  async probeRetrieve(
    tenantId: string,
    query: string,
    limit = 5,
  ): Promise<{
    query: string;
    hits: KnowledgeHit[];
    mode: 'vector' | 'lexical' | 'none';
    index: Awaited<ReturnType<KnowledgeService['getIndexHealth']>>;
  }> {
    const trimmed = query.trim();
    if (!trimmed) throw new BadRequestException('请输入试检索问题');
    const capped = Math.min(20, Math.max(1, Math.floor(limit) || 5));
    const index = await this.getIndexHealth(tenantId);
    const hits = await this.retrieve(tenantId, trimmed, capped);
    const mode =
      hits.length === 0
        ? 'none'
        : index.embedding === 'down'
          ? 'lexical'
          : index.indexedDocuments > 0
            ? 'vector'
            : 'lexical';
    return { query: trimmed, hits, mode, index };
  }

  async getIndexHealth(tenantId: string) {
    const baseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
    const readyDocs = await this.store.readyKnowledgeForRetrieve(tenantId, baseId);
    const indexedIds = await this.store.indexedKnowledgeDocumentIds(
      tenantId,
      baseId,
    );
    const indexedSet = new Set(indexedIds);
    const missingDocuments = readyDocs
      .filter((doc) => !indexedSet.has(doc.id))
      .map((doc) => ({ id: doc.id, title: doc.title }));

    let embedding: 'api' | 'hash' | 'down' = 'down';
    let embeddingModel: string | undefined;
    try {
      const creds = await this.embed.resolveEmbeddingCredentials(tenantId);
      if (creds) {
        embedding = 'api';
        embeddingModel = creds.model;
      } else if (process.env.NODE_ENV !== 'production') {
        embedding = 'hash';
        embeddingModel = 'hash-v1';
      }
    } catch {
      embedding = 'down';
    }

    return {
      readyDocuments: readyDocs.length,
      indexedDocuments: indexedIds.length,
      missingDocuments,
      embedding,
      embeddingModel: embeddingModel ?? null,
    };
  }

  async reindexMissing(tenantId: string, actorId?: string) {
    const baseId = (await this.store.getDefaultKnowledgeBase(tenantId)).id;
    const docs = await this.store.readyKnowledgeForRetrieve(tenantId, baseId);
    const indexed = new Set(
      await this.store.indexedKnowledgeDocumentIds(tenantId, baseId),
    );
    let indexedCount = 0;
    const errors: { documentId: string; message: string }[] = [];
    for (const doc of docs) {
      if (indexed.has(doc.id)) continue;
      try {
        await this.indexDocument(tenantId, doc);
        indexedCount += 1;
      } catch (error) {
        errors.push({
          documentId: doc.id,
          message: error instanceof Error ? error.message : '索引失败',
        });
      }
    }
    this.audit.record({
      tenantId,
      actorId,
      action: 'knowledge.reindex_missing',
      targetType: 'knowledge_base',
      targetId: baseId,
      detail: { indexedCount, errorCount: errors.length },
    });
    return {
      indexedCount,
      errors,
      index: await this.getIndexHealth(tenantId),
    };
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
