import { describe, expect, it } from 'vitest';
import { normalizeKnowledgeIndexSettings } from './knowledge-index-settings.js';

describe('knowledge index settings', () => {
  it('keeps defaults for empty input', () => {
    expect(normalizeKnowledgeIndexSettings({})).toEqual({
      chunkSize: 480,
      chunkOverlap: 80,
      maxChunksPerDoc: 40,
    });
  });

  it('clamps values into safe ranges', () => {
    expect(
      normalizeKnowledgeIndexSettings({
        chunkSize: 80,
        chunkOverlap: 999,
        maxChunksPerDoc: 1000,
      }),
    ).toEqual({
      chunkSize: 200,
      chunkOverlap: 100,
      maxChunksPerDoc: 200,
    });
  });
});
