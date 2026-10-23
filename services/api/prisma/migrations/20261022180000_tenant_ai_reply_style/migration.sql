-- Tenant-level AI reply style (persona / tone / system prompt / max length)
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "ai_tone" VARCHAR(16) NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS "ai_persona" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "ai_system_prompt" TEXT,
  ADD COLUMN IF NOT EXISTS "ai_max_length" INTEGER NOT NULL DEFAULT 500;
