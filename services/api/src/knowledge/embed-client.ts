import { Injectable, Logger } from '@nestjs/common';
import { AiSettingsService } from '../ai/ai-settings.service.js';
import { embedText } from './embed.js';

export type EmbedBatchResult = {
  vectors: number[][];
  source: 'api' | 'hash';
  model?: string;
};

@Injectable()
export class EmbedClient {
  private readonly logger = new Logger(EmbedClient.name);

  constructor(private readonly aiSettings: AiSettingsService) {}

  async embedBatch(tenantId: string, texts: string[]): Promise<EmbedBatchResult> {
    if (!texts.length) return { vectors: [], source: 'hash' };

    const creds = await this.aiSettings.credentials(tenantId);
    if (creds?.apiKey && creds.baseUrl) {
      try {
        const model = resolveEmbeddingModel(creds.baseUrl, creds.model);
        const vectors = await fetchEmbeddings({
          baseUrl: creds.baseUrl,
          apiKey: creds.apiKey,
          model,
          texts,
        });
        if (vectors.length === texts.length) {
          return { vectors, source: 'api', model };
        }
      } catch (error) {
        this.logger.warn(
          `embedding api failed, fallback to hash: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }

    return {
      vectors: texts.map((text) => embedText(text)),
      source: 'hash',
    };
  }
}

export function resolveEmbeddingModel(baseUrl: string, chatModel: string): string {
  const fromEnv = process.env.EMBEDDING_MODEL?.trim();
  if (fromEnv) return fromEnv;
  const host = baseUrl.toLowerCase();
  if (host.includes('deepseek')) return 'deepseek-embedding';
  if (chatModel.toLowerCase().includes('embed')) return chatModel;
  return 'text-embedding-3-small';
}

export async function fetchEmbeddings(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  texts: string[];
}): Promise<number[][]> {
  const base = input.baseUrl.replace(/\/$/, '');
  const url = base.endsWith('/v1')
    ? `${base}/embeddings`
    : `${base}/v1/embeddings`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      input: input.texts,
    }),
  });
  const body = (await res.json()) as {
    data?: { embedding?: number[]; index?: number }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(body.error?.message ?? `embeddings HTTP ${res.status}`);
  }
  const rows = body.data ?? [];
  if (!rows.length) throw new Error('embeddings 返回为空');
  return [...rows]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((row) => {
      const vec = row.embedding;
      if (!Array.isArray(vec) || !vec.length) {
        throw new Error('embeddings 向量无效');
      }
      return normalize(vec);
    });
}

function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}
