-- Retry/backoff support for the PostgreSQL-backed job queue.
-- Reconstructed from the live database so migration history matches deployed schema.

ALTER TABLE "generation_jobs"
    ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN "next_run_at" TIMESTAMPTZ(6);

CREATE INDEX "idx_generation_jobs_org_status_next_run"
    ON "generation_jobs"("organization_id", "status", "next_run_at", "created_at");
