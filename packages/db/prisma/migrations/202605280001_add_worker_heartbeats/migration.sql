-- Worker heartbeat table used to detect stale/broken worker instances.
-- Reconstructed from the live database so migration history matches deployed schema.

CREATE TABLE "worker_heartbeats" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "lock_key" VARCHAR(160) NOT NULL,
    "pid" INTEGER,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "poll_interval_ms" INTEGER NOT NULL,
    "lease_duration_ms" INTEGER NOT NULL,
    "last_tick_status" VARCHAR(40),
    "last_tick_at" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "worker_heartbeats_lock_key_key" ON "worker_heartbeats"("lock_key");
CREATE INDEX "idx_worker_heartbeats_org_last_seen" ON "worker_heartbeats"("organization_id", "last_seen_at");

ALTER TABLE "worker_heartbeats"
    ADD CONSTRAINT "worker_heartbeats_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON UPDATE CASCADE ON DELETE CASCADE;
