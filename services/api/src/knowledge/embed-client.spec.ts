import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  EmbedClient,
  resolveEmbeddingModel,
  supportsEmbeddingsApi,
} from './embed-client.js';

describe('resolveEmbeddingModel', () => {
  it('prefers EMBEDDING_MODEL env', () => {
    const prev = process.env.EMBEDDING_MODEL;
    process.env.EMBEDDING_MODEL = 'custom-embed';
    expect(resolveEmbeddingModel('https://api.openai.com/v1', 'gpt-4o-mini')).toBe(
      'custom-embed',
    );
    if (prev === undefined) delete process.env.EMBEDDING_MODEL;
    else process.env.EMBEDDING_MODEL = prev;
  });

  it('defaults siliconflow to BAAI/bge-m3', () => {
    const prev = process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_MODEL;
    expect(
      resolveEmbeddingModel('https://api.siliconflow.cn/v1', 'deepseek-ai/DeepSeek-V3'),
    ).toBe('BAAI/bge-m3');
    if (prev !== undefined) process.env.EMBEDDING_MODEL = prev;
  });

  it('defaults other hosts to text-embedding-3-small', () => {
    const prev = process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_MODEL;
    expect(
      resolveEmbeddingModel('https://api.openai.com', 'gpt-4o-mini'),
    ).toBe('text-embedding-3-small');
    if (prev !== undefined) process.env.EMBEDDING_MODEL = prev;
  });
});

describe('supportsEmbeddingsApi', () => {
  it('returns false for DeepSeek public API hosts', () => {
    expect(supportsEmbeddingsApi('https://api.deepseek.com')).toBe(false);
    expect(supportsEmbeddingsApi('https://api.deepseek.com/v1')).toBe(false);
  });

  it('returns true for OpenAI-compatible embedding providers', () => {
    expect(supportsEmbeddingsApi('https://api.openai.com/v1')).toBe(true);
    expect(supportsEmbeddingsApi('https://api.siliconflow.cn/v1')).toBe(true);
  });
});

describe('EmbedClient', () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      'NODE_ENV',
      'EMBEDDING_API_KEY',
      'EMBEDDING_BASE_URL',
      'EMBEDDING_MODEL',
    ]) {
      prevEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function client(profile: {
    apiKey: string;
    baseUrl: string;
    model: string;
    name: string;
  } | null) {
    return new EmbedClient({
      credentials: async () => profile,
    } as never);
  }

  it('prefers EMBEDDING_* env over chat profile', async () => {
    process.env.EMBEDDING_API_KEY = 'env-key-xxxxxxxx';
    process.env.EMBEDDING_BASE_URL = 'https://api.siliconflow.cn/v1';
    process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [{ index: 0, embedding: [1, 0, 0] }],
          }),
      })),
    );

    const embed = client({
      apiKey: 'profile-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      name: 'OpenAI',
    });
    const result = await embed.embedBatch('tenant-1', ['hello']);
    expect(result.source).toBe('api');
    expect(result.model).toBe('BAAI/bge-m3');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.siliconflow.cn/v1/embeddings',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer env-key-xxxxxxxx',
        }),
      }),
    );
  });

  it('uses OpenAI-compatible chat profile when env is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [{ index: 0, embedding: [0, 1, 0] }],
          }),
      })),
    );

    const embed = client({
      apiKey: 'profile-key-xxxxxxxx',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      name: 'OpenAI',
    });
    const result = await embed.embedBatch('tenant-1', ['hello']);
    expect(result.source).toBe('api');
    expect(result.model).toBe('text-embedding-3-small');
  });

  it('falls back to hash in non-production when only DeepSeek chat is configured', async () => {
    const embed = client({
      apiKey: 'deepseek-key-xxxxxxxx',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      name: 'DeepSeek',
    });
    const result = await embed.embedBatch('tenant-1', ['陶瓷杯起订']);
    expect(result.source).toBe('hash');
    expect(result.model).toBe('hash-v1');
    expect(result.vectors[0]?.length).toBeGreaterThan(0);
  });

  it('throws in production when embedding is unavailable', async () => {
    process.env.NODE_ENV = 'production';
    const embed = client({
      apiKey: 'deepseek-key-xxxxxxxx',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      name: 'DeepSeek',
    });
    await expect(embed.embedBatch('tenant-1', ['hello'])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('throws in production when embedding API fails', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EMBEDDING_API_KEY = 'env-key-xxxxxxxx';
    process.env.EMBEDDING_BASE_URL = 'https://api.openai.com/v1';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: { message: 'boom' } }),
      })),
    );
    const embed = client(null);
    await expect(embed.embedBatch('tenant-1', ['hello'])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
