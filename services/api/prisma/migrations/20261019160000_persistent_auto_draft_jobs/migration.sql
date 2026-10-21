CREATE TABLE "auto_draft_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "customer_message_id" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auto_draft_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auto_draft_jobs_customer_message_id_key" ON "auto_draft_jobs"("customer_message_id");
CREATE INDEX "auto_draft_jobs_status_run_at_idx" ON "auto_draft_jobs"("status", "run_at");

ALTER TABLE "auto_draft_jobs" ADD CONSTRAINT "auto_draft_jobs_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auto_draft_jobs" ADD CONSTRAINT "auto_draft_jobs_customer_message_id_fkey"
FOREIGN KEY ("customer_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION enqueue_auto_draft_for_customer_message() RETURNS trigger AS $$
BEGIN
    IF NEW."direction" = 'inbound' AND NEW."sender_type" = 'customer' THEN
        INSERT INTO "auto_draft_jobs" (
            "id", "tenant_id", "conversation_id", "customer_message_id",
            "status", "attempts", "run_at", "created_at", "updated_at"
        ) VALUES (
            'autodraft-' || NEW."id", NEW."tenant_id", NEW."conversation_id", NEW."id",
            'queued', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ) ON CONFLICT ("customer_message_id") DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "messages_enqueue_auto_draft"
AFTER INSERT ON "messages"
FOR EACH ROW EXECUTE FUNCTION enqueue_auto_draft_for_customer_message();
