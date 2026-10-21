import { Injectable, Logger } from '@nestjs/common';
import { currentRequestId } from '../common/request-context.js';

export type AiDraftResult = {
  status: 'draft_ready' | 'needs_human' | 'failed';
  draft: string | null;
  citations: { documentTitle: string; quote: string; documentId?: string }[];
  reason?: string;
  model?: { provider: string; name: string };
};

const AI_REQUEST_TIMEOUT_MS = 35_000;
const PROVIDER_TEST_TIMEOUT_MS = 25_000;

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);

  enabled(): boolean {
    return (process.env.AI_SERVICE_URL ?? '').trim().length > 0;
  }

  async testProvider(input: { apiKey: string; baseUrl: string; model: string }) {
    const base = process.env.AI_SERVICE_URL?.replace(/\/$/, '');
    if (!base) return { ok: false, message: '未配置 AI 服务地址' };
    const token = process.env.AI_SERVICE_TOKEN ?? 'dev-ai-token';
    try {
      const res = await fetch(`${base}/internal/v1/provider/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Token': token,
          ...(currentRequestId() ? { 'X-Request-ID': currentRequestId()! } : {}),
        },
        body: JSON.stringify({
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          model: input.model,
        }),
        signal: AbortSignal.timeout(PROVIDER_TEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { ok: false, message: `AI 服务返回 ${res.status}` };
      }
      return (await res.json()) as { ok: boolean; message: string };
    } catch {
      return { ok: false, message: 'AI 服务不可用' };
    }
  }

  async createReplyDraft(input: {
    tenantId: string;
    conversationId: string;
    customerMessage: string;
    conversationContext?: { role: 'customer' | 'agent' | 'system'; content: string }[];
    knowledgeHits: { documentId: string; title: string; excerpt: string }[];
    provider?: {
      apiKey: string;
      baseUrl: string;
      model: string;
      name?: string;
    } | null;
  }): Promise<AiDraftResult | null> {
    const base = process.env.AI_SERVICE_URL?.replace(/\/$/, '');
    if (!base) return null;

    const token = process.env.AI_SERVICE_TOKEN ?? 'dev-ai-token';
    try {
      const res = await fetch(`${base}/internal/v1/reply-drafts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Token': token,
          ...(currentRequestId() ? { 'X-Request-ID': currentRequestId()! } : {}),
        },
        body: JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          customerMessage: input.customerMessage,
          conversationContext: input.conversationContext ?? [],
          knowledgeHits: input.knowledgeHits,
          policy: {
            tone: 'direct',
            maxLength: 500,
            requireCitations: input.knowledgeHits.length > 0,
          },
          provider: input.provider
            ? {
                apiKey: input.provider.apiKey,
                baseUrl: input.provider.baseUrl,
                model: input.provider.model,
                name: input.provider.name,
              }
            : undefined,
        }),
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        this.logger.warn(`AI service responded ${res.status}`);
        return null;
      }

      const body = (await res.json()) as {
        status: AiDraftResult['status'];
        draft: string | null;
        citations?: { documentId: string; quote: string }[];
        reason?: string;
        model?: { provider: string; name: string };
      };

      return {
        status: body.status,
        draft: body.draft,
        reason: body.reason,
        model: body.model,
        citations: (body.citations ?? []).map((c) => ({
          documentId: c.documentId,
          documentTitle:
            input.knowledgeHits.find((h) => h.documentId === c.documentId)
              ?.title ?? '知识文档',
          quote: c.quote,
        })),
      };
    } catch (error) {
      this.logger.warn(
        `AI service unavailable: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
  }

  async evaluateReply(input: {
    tenantId: string;
    customerMessage: string;
    knowledgeHits: { documentId: string; title: string; excerpt: string }[];
    provider?: {
      apiKey: string;
      baseUrl: string;
      model: string;
      name?: string;
    } | null;
  }): Promise<AiDraftResult | null> {
    return this.createReplyDraft({
      tenantId: input.tenantId,
      conversationId: `evaluation-${Date.now()}`,
      customerMessage: input.customerMessage,
      knowledgeHits: input.knowledgeHits,
      provider: input.provider,
    });
  }
}
