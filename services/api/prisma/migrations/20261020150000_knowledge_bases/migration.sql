CREATE TABLE "knowledge_bases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

INSERT INTO "knowledge_bases" ("id", "tenant_id", "name", "is_default", "updated_at")
SELECT 'kb-' || md5(t.id || ':default'), t.id, '默认知识库', true, CURRENT_TIMESTAMP FROM "tenants" t;

ALTER TABLE "knowledge_documents" ADD COLUMN "knowledge_base_id" TEXT;
ALTER TABLE "knowledge_categories" ADD COLUMN "knowledge_base_id" TEXT;
ALTER TABLE "wecom_connections" ADD COLUMN "knowledge_base_id" TEXT;
ALTER TABLE "knowledge_gaps" ADD COLUMN "knowledge_base_id" TEXT;

UPDATE "knowledge_documents" d SET "knowledge_base_id" = 'kb-' || md5(d.tenant_id || ':default');
UPDATE "knowledge_categories" c SET "knowledge_base_id" = 'kb-' || md5(c.tenant_id || ':default');
UPDATE "wecom_connections" c SET "knowledge_base_id" = 'kb-' || md5(c.tenant_id || ':default');
UPDATE "knowledge_gaps" g SET "knowledge_base_id" = 'kb-' || md5(g.tenant_id || ':default');

ALTER TABLE "knowledge_documents" ALTER COLUMN "knowledge_base_id" SET NOT NULL;
ALTER TABLE "knowledge_categories" ALTER COLUMN "knowledge_base_id" SET NOT NULL;

DROP INDEX IF EXISTS "knowledge_categories_tenant_id_name_key";
DROP INDEX IF EXISTS "knowledge_categories_tenant_id_sort_order_name_idx";
CREATE UNIQUE INDEX "knowledge_categories_tenant_id_knowledge_base_id_name_key" ON "knowledge_categories"("tenant_id", "knowledge_base_id", "name");
CREATE INDEX "knowledge_categories_tenant_id_knowledge_base_id_sort_order_name_idx" ON "knowledge_categories"("tenant_id", "knowledge_base_id", "sort_order", "name");
CREATE UNIQUE INDEX "knowledge_bases_tenant_id_name_key" ON "knowledge_bases"("tenant_id", "name");
CREATE INDEX "knowledge_bases_tenant_id_is_default_idx" ON "knowledge_bases"("tenant_id", "is_default");
CREATE INDEX "knowledge_documents_tenant_id_knowledge_base_id_status_idx" ON "knowledge_documents"("tenant_id", "knowledge_base_id", "status");

ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_categories" ADD CONSTRAINT "knowledge_categories_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wecom_connections" ADD CONSTRAINT "wecom_connections_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
