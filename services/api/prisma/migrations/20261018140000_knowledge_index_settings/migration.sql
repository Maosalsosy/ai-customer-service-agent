-- CreateTable
CREATE TABLE "knowledge_index_settings" (
    "tenant_id" TEXT NOT NULL,
    "chunk_size" INTEGER NOT NULL DEFAULT 480,
    "chunk_overlap" INTEGER NOT NULL DEFAULT 80,
    "max_chunks_per_doc" INTEGER NOT NULL DEFAULT 40,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_index_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- AddForeignKey
ALTER TABLE "knowledge_index_settings" ADD CONSTRAINT "knowledge_index_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
