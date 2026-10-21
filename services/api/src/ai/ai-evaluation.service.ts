import { Injectable } from '@nestjs/common';
import { evaluateReplyPolicy } from '../common/reply-policy.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { AiClientService } from './ai-client.service.js';
import { AiSettingsService } from './ai-settings.service.js';

type EvaluationCase = {
  id: string;
  title: string;
  customerMessage: string;
  expected: 'grounded_reply' | 'abstain' | 'human';
};

@Injectable()
export class AiEvaluationService {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly ai: AiClientService,
    private readonly settings: AiSettingsService,
  ) {}

  async run(tenantId: string, profileId?: string) {
    const docs = (await this.knowledge.list(tenantId)).items;
    const sample = docs.find((doc) => doc.status === 'ready');
    const cases: EvaluationCase[] = [
      ...(sample
        ? [{
            id: 'grounded',
            title: '知识可回答',
            customerMessage: `请根据知识库介绍“${sample.title}”的相关内容。`,
            expected: 'grounded_reply' as const,
          }]
        : []),
      {
        id: 'no-evidence',
        title: '无知识依据',
        customerMessage: '请告诉我星际量子云枢的专属保修年限和服务条款。',
        expected: 'abstain',
      },
      {
        id: 'sensitive',
        title: '敏感业务转人工',
        customerMessage: '我的订单要退款，请马上处理。',
        expected: 'human',
      },
      {
        id: 'human-request',
        title: '客户要求人工',
        customerMessage: '请转人工客服帮我处理。',
        expected: 'human',
      },
    ];

    const provider = await this.settings.credentials(tenantId, profileId);
    const results = [];
    for (const item of cases) {
      const started = Date.now();
      const policy = evaluateReplyPolicy([item.customerMessage]);
      const hits = policy.needsHuman
        ? []
        : await this.knowledge.retrieve(tenantId, item.customerMessage, 3);
      const response = policy.needsHuman
        ? {
            status: 'needs_human' as const,
            draft: null,
            citations: [],
            reason: policy.reason,
            model: { provider: 'policy', name: 'reply-policy-v1' },
          }
        : await this.ai.evaluateReply({
            tenantId,
            customerMessage: item.customerMessage,
            knowledgeHits: hits.map(({ documentId, title, excerpt }) => ({
              documentId,
              title,
              excerpt,
            })),
            provider,
          });
      const citations = response?.citations ?? [];
      const generatedByModel = Boolean(
        response?.model?.provider &&
          response.model.provider !== 'local-rule' &&
          response.model.provider !== 'policy',
      );
      const validCitations = citations.filter((citation) =>
        hits.some(
          (hit) =>
            hit.documentId === citation.documentId &&
            hit.excerpt.includes(citation.quote),
        ),
      ).length;
      const passed =
        item.expected === 'grounded_reply'
          ? Boolean(
              hits.length &&
                generatedByModel &&
                response?.status === 'draft_ready' &&
                citations.length > 0 &&
                validCitations === citations.length,
            )
          : item.expected === 'abstain'
            ? hits.length === 0 &&
              response !== null &&
              (response.status === 'needs_human' || response.status === 'failed')
            : response?.status === 'needs_human' && policy.needsHuman;
      results.push({
        id: item.id,
        title: item.title,
        expected: item.expected,
        passed,
        customerMessage: item.customerMessage,
        status: response?.status ?? 'unavailable',
        reason: response?.reason ?? null,
        draft: response?.draft ?? null,
        model: response?.model ?? null,
        retrievalHits: hits.map((hit) => ({
          documentId: hit.documentId,
          title: hit.title,
          score: hit.score,
          excerpt: hit.excerpt,
        })),
        citationCount: citations.length,
        validCitationCount: validCitations,
        durationMs: Date.now() - started,
      });
    }
    return {
      model: provider ? { name: provider.name, model: provider.model } : null,
      generatedAt: new Date().toISOString(),
      summary: {
        total: results.length,
        passed: results.filter((item) => item.passed).length,
        failed: results.filter((item) => !item.passed).length,
        note: '该评估检查流程行为、知识命中和引用对应关系，不等同于人工事实准确性验收。',
      },
      results,
    };
  }
}
