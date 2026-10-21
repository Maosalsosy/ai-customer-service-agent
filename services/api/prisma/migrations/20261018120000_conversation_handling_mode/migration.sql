-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "handling_mode" VARCHAR(16) NOT NULL DEFAULT 'ai';

-- Existing waiting_human rows are human-handled.
UPDATE "conversations" SET "handling_mode" = 'human' WHERE "status" = 'waiting_human';
