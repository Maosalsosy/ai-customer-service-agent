export type KnowledgeIndexSettings = {
  chunkSize: number;
  chunkOverlap: number;
  maxChunksPerDoc: number;
};

export const DEFAULT_KNOWLEDGE_INDEX_SETTINGS: KnowledgeIndexSettings = {
  chunkSize: 480,
  chunkOverlap: 80,
  maxChunksPerDoc: 40,
};

export function normalizeKnowledgeIndexSettings(
  input: Partial<KnowledgeIndexSettings> | null | undefined,
): KnowledgeIndexSettings {
  const chunkSize = clampInt(
    input?.chunkSize,
    DEFAULT_KNOWLEDGE_INDEX_SETTINGS.chunkSize,
    200,
    2000,
  );
  const maxOverlap = Math.max(0, Math.floor(chunkSize / 2));
  const chunkOverlap = clampInt(
    input?.chunkOverlap,
    DEFAULT_KNOWLEDGE_INDEX_SETTINGS.chunkOverlap,
    0,
    maxOverlap,
  );
  const maxChunksPerDoc = clampInt(
    input?.maxChunksPerDoc,
    DEFAULT_KNOWLEDGE_INDEX_SETTINGS.maxChunksPerDoc,
    5,
    200,
  );
  return { chunkSize, chunkOverlap, maxChunksPerDoc };
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
