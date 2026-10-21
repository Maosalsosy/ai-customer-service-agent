import { describe, expect, it } from 'vitest';
import { resolveEmbeddingModel } from './embed-client.js';

describe('resolveEmbeddingModel', () => {
  it('prefers EMBEDDING_MODEL env', () => {
    const prev = process.env.EMBEDDING_MODEL;
    process.env.EMBEDDING_MODEL = 'custom-embed';
    expect(resolveEmbeddingModel('https://api.deepseek.com', 'deepseek-chat')).toBe(
      'custom-embed',
    );
    if (prev === undefined) delete process.env.EMBEDDING_MODEL;
    else process.env.EMBEDDING_MODEL = prev;
  });

  it('defaults deepseek host to deepseek-embedding', () => {
    const prev = process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_MODEL;
    expect(resolveEmbeddingModel('https://api.deepseek.com', 'deepseek-chat')).toBe(
      'deepseek-embedding',
    );
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
