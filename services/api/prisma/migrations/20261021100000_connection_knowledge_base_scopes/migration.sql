ALTER TABLE "wecom_connections"
ADD COLUMN "knowledge_base_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "wecom_connections"
SET "knowledge_base_ids" = ARRAY["knowledge_base_id"]::TEXT[]
WHERE "knowledge_base_id" IS NOT NULL
  AND cardinality("knowledge_base_ids") = 0;
