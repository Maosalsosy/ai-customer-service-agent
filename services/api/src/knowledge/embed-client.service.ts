import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AiSettingsService } from '../ai/ai-settings.service.js';
import { embedText } from './embed.js';

export type EmbedBatchResult = {
  vectors: number[][];
  source: 'api' | 'hash';
  model?: string;
};

@Injectable()
export class EmbedClientService {
  private readonly logger = new Logger(EmbedClientService.name);

  constructor(private readonly aiSettings: AiSettingsService) {}

  async embedBatch(tenantId: string, texts: string[]): Promise<EmbedBatchResult> {
    const inputs = texts.map((text) => text.trim() || ' ');
    if (!inputs.length) return { vectors: [], source: 'hash' };
    const production = process.env.NODE_ENV === 'production';

    const creds = await this.aiSettings.credentials(tenantId);
    if (creds?.apiKey && creds.baseUrl) {
      const model = resolveEmbeddingModel(creds.baseUrl, creds.name);
      try {
        const vectors = await this.callEmbeddingsApi({
          apiKey: creds.apiKey,
          baseUrl: creds.baseUrl,
          model,
          inputs,
        });
        if (vectors.length === inputs.length) {
          return { vectors: vectors.map(l2Normalize), source: 'api', model };
        }
      } catch (error) {
        if (production) {
          throw new ServiceUnavailableException('生产环境 embedding 服务不可用，已停止向量索引');
        }
        this.logger.warn(
          `embedding API failed, fallback to hash: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }

    if (production) {
      throw new ServiceUnavailableException('生产环境必须配置可用的 embedding 服务');
    }

    return {
      vectors: inputs.map((text) => embedText(text)),
      source: 'hash',
      model: 'hash-v1',
    };
  }

  private async callEmbeddingsApi(input: {
    apiKey: string;
    baseUrl: string;
    model: string;
    inputs: string[];
  }): Promise<number[][]> {
    const base = input.baseUrl.replace(/\/$/, '');
    const url = `${base}/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        input: input.inputs.length === 1 ? input.inputs[0] : input.inputs,
      }),
    });
    const body = (await res.json()) as {
      data?: { embedding?: number[]; index?: number }[];
      error?: { message?: string };
      message?: string;
    };
    if (!res.ok) {
      throw new Error(
        body.error?.message ?? body.message ?? `embeddings HTTP ${res.status}`,
      );
    }
    const rows = [...(body.data ?? [])].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    const vectors = rows.map((row) => row.embedding ?? []);
    if (vectors.some((vec) => !vec.length)) {
      throw new Error('embeddings response missing vectors');
    }
    return vectors;
  }
}

export function resolveEmbeddingModel(baseUrl: string, providerLabel?: string) {
  const fromEnv = process.env.EMBEDDING_MODEL?.trim();
  if (fromEnv) return fromEnv;
  const hay = `${baseUrl} ${providerLabel ?? ''}`.toLowerCase();
  if (hay.includes('deepseek')) return 'deepseek-embedding';
  return 'text-embedding-3-small';
}

function l2Normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (!norm) return vec;
  return vec.map((v) => v / norm);
}
