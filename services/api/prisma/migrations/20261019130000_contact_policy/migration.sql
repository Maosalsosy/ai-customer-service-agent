ALTER TABLE "conversations"
  ADD COLUMN "contact_policy" VARCHAR(16) NOT NULL DEFAULT 'ai',
  ADD COLUMN "contact_policy_reason" VARCHAR(500),
  ADD COLUMN "contact_policy_actor_id" TEXT,
  ADD COLUMN "contact_policy_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_contact_policy_check"
  CHECK ("contact_policy" IN ('ai', 'human', 'paused', 'blocked'));
