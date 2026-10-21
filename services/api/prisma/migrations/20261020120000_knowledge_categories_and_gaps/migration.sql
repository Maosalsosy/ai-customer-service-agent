CREATE TABLE "knowledge_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "knowledge_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_gaps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "customer_message_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'open',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "knowledge_gaps_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "knowledge_documents" ADD COLUMN "category_id" TEXT;

CREATE UNIQUE INDEX "knowledge_categories_tenant_id_name_key" ON "knowledge_categories"("tenant_id", "name");
CREATE INDEX "knowledge_categories_tenant_id_sort_order_name_idx" ON "knowledge_categories"("tenant_id", "sort_order", "name");
CREATE UNIQUE INDEX "knowledge_gaps_customer_message_id_key" ON "knowledge_gaps"("customer_message_id");
CREATE INDEX "knowledge_gaps_tenant_id_status_last_seen_at_idx" ON "knowledge_gaps"("tenant_id", "status", "last_seen_at" DESC);
CREATE INDEX "knowledge_documents_category_id_idx" ON "knowledge_documents"("category_id");

ALTER TABLE "knowledge_categories" ADD CONSTRAINT "knowledge_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "knowledge_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_customer_message_id_fkey" FOREIGN KEY ("customer_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "knowledge_categories" ("id", "tenant_id", "name", "sort_order", "updated_at")
SELECT 'kc-' || md5(t.id || ':products'), t.id, '产品与服务', 10, CURRENT_TIMESTAMP FROM "tenants" t
UNION ALL SELECT 'kc-' || md5(t.id || ':purchasing'), t.id, '采购与合同', 20, CURRENT_TIMESTAMP FROM "tenants" t
UNION ALL SELECT 'kc-' || md5(t.id || ':delivery'), t.id, '履约与售后', 30, CURRENT_TIMESTAMP FROM "tenants" t
UNION ALL SELECT 'kc-' || md5(t.id || ':finance'), t.id, '财务与开票', 40, CURRENT_TIMESTAMP FROM "tenants" t
UNION ALL SELECT 'kc-' || md5(t.id || ':other'), t.id, '其他', 50, CURRENT_TIMESTAMP FROM "tenants" t;

UPDATE "knowledge_documents" d SET "category_id" = CASE
    WHEN d.title LIKE '%产品%' OR d.title LIKE '%工艺%' OR d.title LIKE '%起订%' OR d.title LIKE '%定制%' OR d.title LIKE '%打样%' THEN 'kc-' || md5(d.tenant_id || ':products')
    WHEN d.title LIKE '%合同%' OR d.title LIKE '%采购%' OR d.title LIKE '%框架%' THEN 'kc-' || md5(d.tenant_id || ':purchasing')
    WHEN d.title LIKE '%交期%' OR d.title LIKE '%售后%' OR d.title LIKE '%色差%' THEN 'kc-' || md5(d.tenant_id || ':delivery')
    WHEN d.title LIKE '%开票%' OR d.title LIKE '%发票%' OR d.title LIKE '%付款%' THEN 'kc-' || md5(d.tenant_id || ':finance')
    ELSE 'kc-' || md5(d.tenant_id || ':other')
END;
