ALTER TABLE "ai_provider_settings" ADD COLUMN "id" TEXT;
ALTER TABLE "ai_provider_settings" ADD COLUMN "name" VARCHAR(80) NOT NULL DEFAULT 'DeepSeek';
ALTER TABLE "ai_provider_settings" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "ai_provider_settings" SET "id" = "tenant_id" WHERE "id" IS NULL;

ALTER TABLE "ai_provider_settings" DROP CONSTRAINT "ai_provider_settings_pkey";
ALTER TABLE "ai_provider_settings" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "ai_provider_settings" ADD CONSTRAINT "ai_provider_settings_pkey" PRIMARY KEY ("id");
CREATE INDEX "ai_provider_settings_tenant_id_idx" ON "ai_provider_settings"("tenant_id");
