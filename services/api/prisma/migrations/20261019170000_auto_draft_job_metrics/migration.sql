ALTER TABLE "auto_draft_jobs"
ADD COLUMN "total_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_failed_at" TIMESTAMPTZ(6),
ADD COLUMN "completed_at" TIMESTAMPTZ(6);

UPDATE "auto_draft_jobs" SET "total_attempts" = "attempts";

CREATE TABLE "auto_draft_job_attempts" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "error" VARCHAR(500),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    CONSTRAINT "auto_draft_job_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auto_draft_job_attempts_started_at_status_idx" ON "auto_draft_job_attempts"("started_at", "status");
CREATE INDEX "auto_draft_job_attempts_job_id_started_at_idx" ON "auto_draft_job_attempts"("job_id", "started_at" DESC);
ALTER TABLE "auto_draft_job_attempts" ADD CONSTRAINT "auto_draft_job_attempts_job_id_fkey"
FOREIGN KEY ("job_id") REFERENCES "auto_draft_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
