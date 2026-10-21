CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "knowledge_chunks"
  ALTER COLUMN "embedding" TYPE vector
  USING "embedding"::text::vector;
