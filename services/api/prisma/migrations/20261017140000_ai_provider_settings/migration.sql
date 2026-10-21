CREATE TABLE "ai_provider_settings" (
    "tenant_id" TEXT NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'deepseek',
    "base_url" VARCHAR(255) NOT NULL DEFAULT 'https://api.deepseek.com',
    "model" VARCHAR(80) NOT NULL DEFAULT 'deepseek-chat',
    "api_key" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_provider_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "ai_provider_settings" ADD CONSTRAINT "ai_provider_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
