import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiSettingsService } from '../ai/ai-settings.service.js';
import { embedText } from './embed.js';

export type EmbedBatchResult = {
  vectors: number[][];
  source: 'api' | 'hash';
  model?: string;
};

export type EmbeddingCredentials = {
  apiKey: string;
  baseUrl: string;
  model: string;
  source: 'env' | 'profile';
};

@Injectable()
export class EmbedClient {
  private readonly logger = new Logger(EmbedClient.name);

  constructor(private readonly aiSettings: AiSettingsService) {}

  async embedBatch(tenantId: string, texts: string[]): Promise<EmbedBatchResult> {
    if (!texts.length) return { vectors: [], source: 'api' };

    const production = process.env.NODE_ENV === 'production';
    const creds = await this.resolveEmbeddingCredentials(tenantId);

    if (creds) {
      try {
        const vectors = await fetchEmbeddings({
          baseUrl: creds.baseUrl,
          apiKey: creds.apiKey,
          model: creds.model,
          texts,
        });
        if (vectors.length === texts.length) {
          return { vectors, source: 'api', model: creds.model };
        }
        throw new Error(
          `embeddings 数量不匹配：期望 ${texts.length}，实际 ${vectors.length}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        if (production) {
          this.logger.error(`embedding api failed in production: ${message}`);
          throw new ServiceUnavailableException(
            '生产环境 embedding 服务不可用，已停止向量索引',
          );
        }
        this.logger.warn(`embedding api failed, fallback to hash: ${message}`);
      }
    } else if (production) {
      throw new ServiceUnavailableException(
        '生产环境必须配置可用的 embedding 服务（EMBEDDING_* 或支持 embeddings 的聊天模型）',
      );
    } else {
      this.logger.warn(
        'no embedding credentials; using local hash vectors (dev only)',
      );
    }

    return {
      vectors: texts.map((text) => embedText(text)),
      source: 'hash',
      model: 'hash-v1',
    };
  }

  /**
   * 1) EMBEDDING_API_KEY + EMBEDDING_BASE_URL
   * 2) 活跃聊天 Profile，且 baseUrl 支持 embeddings（排除 DeepSeek 公开站）
   */
  async resolveEmbeddingCredentials(
    tenantId: string,
  ): Promise<EmbeddingCredentials | null> {
    const envKey = process.env.EMBEDDING_API_KEY?.trim();
    const envBase = process.env.EMBEDDING_BASE_URL?.trim();
    if (envKey && envBase) {
      if (!supportsEmbeddingsApi(envBase)) {
        this.logger.warn(
          `EMBEDDING_BASE_URL ${envBase} has no embeddings API; ignoring env credentials`,
        );
      } else {
        return {
          apiKey: envKey,
          baseUrl: envBase,
          model: resolveEmbeddingModel(envBase, ''),
          source: 'env',
        };
      }
    }

    const profile = await this.aiSettings.credentials(tenantId);
    if (
      profile?.apiKey &&
      profile.baseUrl &&
      supportsEmbeddingsApi(profile.baseUrl)
    ) {
      return {
        apiKey: profile.apiKey,
        baseUrl: profile.baseUrl,
        model: resolveEmbeddingModel(profile.baseUrl, profile.model),
        source: 'profile',
      };
    }

    return null;
  }
}

/** DeepSeek 公开 API 仅提供聊天，无 embeddings；对其发起请求只会 404/空响应。 */
export function supportsEmbeddingsApi(baseUrl: string): boolean {
  const host = baseUrl.toLowerCase();
  if (host.includes('deepseek.com')) return false;
  // 裸 host / 代理名含 deepseek 且非兼容网关时同样跳过
  try {
    const hostname = new URL(
      host.startsWith('http') ? host : `https://${host}`,
    ).hostname;
    if (hostname === 'deepseek.com' || hostname.endsWith('.deepseek.com')) {
      return false;
    }
  } catch {
    if (host.includes('deepseek')) return false;
  }
  return true;
}

export function resolveEmbeddingModel(baseUrl: string, chatModel: string): string {
  const fromEnv = process.env.EMBEDDING_MODEL?.trim();
  if (fromEnv) return fromEnv;
  if (chatModel.toLowerCase().includes('embed')) return chatModel;
  const host = baseUrl.toLowerCase();
  if (host.includes('siliconflow')) return 'BAAI/bge-m3';
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
  const raw = await res.text();
  let body: {
    data?: { embedding?: number[]; index?: number }[];
    error?: { message?: string };
  } = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      throw new Error(
        `embeddings 返回非 JSON（HTTP ${res.status}）: ${raw.slice(0, 120)}`,
      );
    }
  }
  if (!res.ok) {
    throw new Error(
      body.error?.message ??
        `embeddings HTTP ${res.status}${raw ? `: ${raw.slice(0, 120)}` : ''}`,
    );
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
