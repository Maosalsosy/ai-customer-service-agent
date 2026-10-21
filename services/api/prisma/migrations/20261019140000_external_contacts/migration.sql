CREATE TABLE "external_contacts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "external_user_id" VARCHAR(255) NOT NULL,
  "display_name" VARCHAR(120) NOT NULL,
  "source" VARCHAR(50) NOT NULL,
  "policy" VARCHAR(16) NOT NULL DEFAULT 'ai',
  "policy_reason" VARCHAR(500),
  "policy_actor_id" TEXT,
  "policy_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_contacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_contacts_policy_check" CHECK ("policy" IN ('ai', 'human', 'paused', 'blocked')),
  CONSTRAINT "external_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "external_contacts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "wecom_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "tenants"
  ADD COLUMN "default_contact_policy" VARCHAR(16) NOT NULL DEFAULT 'ai',
  ADD CONSTRAINT "tenants_default_contact_policy_check"
  CHECK ("default_contact_policy" IN ('ai', 'human', 'paused', 'blocked'));

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_contact_policy_valid_check"
  CHECK ("contact_policy" IN ('ai', 'human', 'paused', 'blocked'));

CREATE UNIQUE INDEX "external_contacts_tenant_id_connection_id_external_user_id_key"
  ON "external_contacts"("tenant_id", "connection_id", "external_user_id");
CREATE INDEX "external_contacts_tenant_id_policy_updated_at_idx"
  ON "external_contacts"("tenant_id", "policy", "updated_at" DESC);

ALTER TABLE "conversations" ADD COLUMN "external_contact_id" TEXT;

INSERT INTO "external_contacts" ("id", "tenant_id", "connection_id", "external_user_id", "display_name", "source", "policy", "policy_reason", "policy_actor_id", "policy_updated_at")
SELECT DISTINCT ON (c."tenant_id", c."connection_id", c."external_conversation_id")
  'ec-migrated-' || md5(c."tenant_id" || ':' || c."connection_id" || ':' || c."external_conversation_id"),
  c."tenant_id", c."connection_id", c."external_conversation_id", c."contact_name",
  COALESCE(w."capability", 'unknown'), c."contact_policy", c."contact_policy_reason", c."contact_policy_actor_id", c."contact_policy_updated_at"
FROM "conversations" c
LEFT JOIN "wecom_connections" w ON w."id" = c."connection_id"
WHERE c."connection_id" IS NOT NULL AND c."external_conversation_id" IS NOT NULL
ORDER BY c."tenant_id", c."connection_id", c."external_conversation_id", c."contact_policy_updated_at" DESC;

UPDATE "conversations" c
SET "external_contact_id" = ec."id"
FROM "external_contacts" ec
WHERE ec."tenant_id" = c."tenant_id"
  AND ec."connection_id" = c."connection_id"
  AND ec."external_user_id" = c."external_conversation_id";

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_external_contact_id_fkey"
  FOREIGN KEY ("external_contact_id") REFERENCES "external_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "conversations_external_contact_id_idx" ON "conversations"("external_contact_id");
